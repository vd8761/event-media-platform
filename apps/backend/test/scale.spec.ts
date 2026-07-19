// M6 load test (docs/plan/12): a 10k-face event with 500 participants, run
// against real Postgres+VectorChord with synthetic embeddings (ML bypassed).
// Validates at target scale:
//   - face-level matching correctness: every participant matches exactly and
//     only their own identity's photos (risk R3)
//   - sequential clustering creates zero duplicate persons (risk R1) — run on
//     a 2k-face subset to keep runtime sane
//   - event-scoped KNN latency stays interactive at 10k rows
import { CamelCasePlugin, Kysely, Migrator, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { JobName, ParticipantStatus } from 'src/enum';
import { StaticMigrationProvider } from 'src/migrations';
import { ConfigRepository, clearEnvCache } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { FaceRepository } from 'src/repositories/face.repository';
import { FaceSearchRepository } from 'src/repositories/face-search.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { ParticipantRepository } from 'src/repositories/participant.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SystemConfigRepository } from 'src/repositories/system-config.repository';
import { DB } from 'src/schema';
import { FaceService } from 'src/services/face.service';
import { ParticipantService } from 'src/services/participant.service';
import { JobItem } from 'src/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DB_HOST = process.env.DB_HOSTNAME || 'localhost';
const DB_PORT = Number(process.env.DB_PORT || 5433);
const TEST_DB = 'eventlens_test_scale';

const IDENTITIES = 500;
const FACES_PER_IDENTITY = 20; // 500 × 20 = 10,000 faces
const CLUSTER_SUBSET = 100; // identities clustered for the R1 check (2k faces)

// orthogonal one-hot identities (500 ≤ 512 dims) with tiny within-identity noise
function embedding(identity: number, variant: number): string {
  const vector = new Array<number>(512).fill(0);
  vector[identity] = 1;
  vector[(identity + 7) % 512] = 0.004 * ((variant % 5) + 1);
  const norm = Math.hypot(...vector);
  return JSON.stringify(vector.map((value) => Math.round((value / norm) * 1e6) / 1e6));
}

class FakeJobRepository {
  items: JobItem[] = [];
  async queue(item: JobItem) {
    this.items.push(item);
  }
  async queueAll(items: JobItem[]) {
    this.items.push(...items);
  }
  async waitForQueueCompletion() {}
  take(name: JobName): JobItem[] {
    const matched = this.items.filter((item) => item.name === name);
    this.items = this.items.filter((item) => item.name !== name);
    return matched;
  }
}

describe('scale: 10k faces / 500 participants', () => {
  let db: Kysely<DB>;
  let faceSearchRepository: FaceSearchRepository;
  let participantService: ParticipantService;
  let faceService: FaceService;
  let jobs: FakeJobRepository;
  let orgId: string;
  let eventId: string;

  beforeAll(async () => {
    const admin = new pg.Client({ host: DB_HOST, port: DB_PORT, user: 'postgres', password: 'postgres', database: 'postgres' });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    await admin.end();

    process.env.DB_HOSTNAME = DB_HOST;
    process.env.DB_PORT = String(DB_PORT);
    process.env.DB_DATABASE_NAME = TEST_DB;
    process.env.EL_ENV = 'development';
    clearEnvCache();

    db = new Kysely<DB>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({ host: DB_HOST, port: DB_PORT, user: 'postgres', password: 'postgres', database: TEST_DB, max: 4 }),
      }),
      plugins: [new CamelCasePlugin()],
    });
    const migrator = new Migrator({ db: db as Kysely<unknown>, provider: new StaticMigrationProvider() });
    const { error } = await migrator.migrateToLatest();
    if (error) {
      throw error;
    }

    const configRepository = new ConfigRepository();
    const logger = new LoggingRepository(configRepository);
    const cryptoRepository = new CryptoRepository();
    const eventRepository = new EventRepository(db);
    const faceRepository = new FaceRepository(db);
    faceSearchRepository = new FaceSearchRepository(db, configRepository);
    const participantRepository = new ParticipantRepository(db);
    const personRepository = new PersonRepository(db);
    const systemConfigRepository = new SystemConfigRepository(db);
    jobs = new FakeJobRepository();

    participantService = new ParticipantService(
      configRepository,
      eventRepository,
      faceSearchRepository,
      jobs as any,
      logger,
      null as any, // ML — bypassed
      participantRepository,
      null as any, // storage — not used by matching
      systemConfigRepository,
    );

    faceService = new FaceService(
      null as any,
      configRepository,
      cryptoRepository,
      null as any, // databaseRepository — prewarm not in the recognize path
      eventRepository,
      faceRepository,
      faceSearchRepository,
      jobs as any,
      logger,
      null as any,
      null as any,
      personRepository,
      null as any,
      systemConfigRepository,
    );

    // --- seed 10k assets/faces/embeddings + 500 participants, in batches ---
    const org = await db.insertInto('organization').values({ name: 'Scale', slug: 'scale' }).returning('id').executeTakeFirstOrThrow();
    orgId = org.id;
    const event = await db
      .insertInto('event')
      .values({ orgId, name: 'Scale Event', slug: 'scale-event', status: 'active' as any })
      .returning('id')
      .executeTakeFirstOrThrow();
    eventId = event.id;

    const BATCH = 500;
    let assetRows: any[] = [];
    let faceRows: any[] = [];
    let searchRows: any[] = [];

    const flush = async () => {
      if (assetRows.length > 0) await db.insertInto('asset').values(assetRows).execute();
      if (faceRows.length > 0) await db.insertInto('assetFace').values(faceRows).execute();
      if (searchRows.length > 0) await db.insertInto('faceSearch').values(searchRows).execute();
      assetRows = [];
      faceRows = [];
      searchRows = [];
    };

    for (let identity = 0; identity < IDENTITIES; identity++) {
      for (let variant = 0; variant < FACES_PER_IDENTITY; variant++) {
        const assetId = crypto.randomUUID();
        const faceId = crypto.randomUUID();
        assetRows.push({
          id: assetId,
          eventId,
          orgId,
          type: 'image',
          originalFilename: `id-${identity}-v${variant}.jpg`,
          checksum: Buffer.from(`${identity}/${variant}`),
          fileSize: 1,
          mimeType: 'image/jpeg',
          source: 'upload',
          storageKey: `scale/${identity}/${variant}`,
          status: 'processed',
        });
        faceRows.push({ id: faceId, assetId, imageWidth: 1000, imageHeight: 1000 });
        searchRows.push({ faceId, embedding: embedding(identity, variant) });
        if (assetRows.length >= BATCH) {
          await flush();
        }
      }
    }
    await flush();

    const participantRows = Array.from({ length: IDENTITIES }, (_, identity) => ({
      eventId,
      email: `guest-${identity}@scale.test`,
      selfieKey: `scale/selfie/${identity}`,
      selfieEmbedding: embedding(identity, 999),
      galleryTokenHash: Buffer.from(`hash-${identity}`),
      status: ParticipantStatus.PendingMatch,
    }));
    for (let start = 0; start < participantRows.length; start += BATCH) {
      await db.insertInto('participant').values(participantRows.slice(start, start + BATCH)).execute();
    }

    // Settle the write burst before any measurement. Straight after inserting
    // 10k vectors the first queries are dominated by index maintenance and
    // stale statistics — measured at ~2.4 s here, against ~25 ms once settled
    // (same query, same data, plain client). Without this the latency test
    // reports the seed aftermath rather than the query it names.
    await sql`ANALYZE asset, asset_face, face_search, participant`.execute(db);
    await sql`SELECT vchordrq_prewarm('face_index')`.execute(db).catch(() => undefined);
    for (let i = 0; i < 3; i++) {
      await faceSearchRepository.searchFacesByEmbedding(eventId, embedding(1, 999), { maxDistance: 0.5 });
    }
  }, 300_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it('event-scoped KNN stays interactive at 10k faces', async () => {
    const started = Date.now();
    const results = await faceSearchRepository.searchFacesByEmbedding(eventId, embedding(42, 999), {
      maxDistance: 0.5,
    });
    const elapsed = Date.now() - started;

    console.log(`single KNN over 10k faces: ${elapsed} ms, ${results.length} hits`);
    expect(results.length).toBe(FACES_PER_IDENTITY);
    expect(elapsed).toBeLessThan(2000);
  });

  it('rematch sweep matches all 500 participants to exactly their own photos', { timeout: 240_000 }, async () => {
    const started = Date.now();
    await participantService.handleParticipantRematch({ eventId });
    const elapsed = Date.now() - started;
    console.log(`ParticipantRematch for 500 participants over 10k faces: ${(elapsed / 1000).toFixed(1)} s`);

    const [counts] = await sql<{ participants: number; matched: number; matches: number }>`
      SELECT count(*)::int AS participants,
             count(*) FILTER (WHERE status = 'matched')::int AS matched,
             (SELECT count(*)::int FROM participant_match) AS matches
      FROM participant
    `.execute(db).then((r) => r.rows);
    expect(counts.participants).toBe(IDENTITIES);
    expect(counts.matched).toBe(IDENTITIES);
    expect(counts.matches).toBe(IDENTITIES * FACES_PER_IDENTITY); // 10,000

    // zero cross-identity matches: participant email id must equal the id
    // encoded in every matched asset's filename (risk R3 correctness)
    // participant email guest-{i}@… must equal asset filename id-{i}-v{j}.jpg
    const [mismatch] = await sql<{ bad: number }>`
      SELECT count(*)::int AS bad
      FROM participant_match pm
      JOIN participant p ON p.id = pm.participant_id
      JOIN asset a ON a.id = pm.asset_id
      WHERE split_part(split_part(p.email, '@', 1), '-', 2)
            <> split_part(a.original_filename, '-', 2)
    `.execute(db).then((r) => r.rows);
    expect(mismatch.bad).toBe(0);

    // every participant got a notification job exactly once
    const emails = jobs.take(JobName.SendGalleryEmail);
    expect(emails).toHaveLength(IDENTITIES);
  });

  it('sequential clustering of a 2k-face subset creates zero duplicate persons (R1)', { timeout: 240_000 }, async () => {
    const subset = await db
      .selectFrom('assetFace')
      .innerJoin('asset', 'asset.id', 'assetFace.assetId')
      .select(['assetFace.id'])
      .where(sql<boolean>`split_part(asset.original_filename, '-', 2)::int < ${CLUSTER_SUBSET}`)
      .execute();
    expect(subset.length).toBe(CLUSTER_SUBSET * FACES_PER_IDENTITY);

    const started = Date.now();
    for (const face of subset) {
      await faceService.handleRecognizeFaces({ faceId: face.id });
    }
    // deferred second pass
    for (const item of jobs.take(JobName.FaceRecognize)) {
      await faceService.handleRecognizeFaces(item.data as any);
    }
    console.log(`clustered ${subset.length} faces in ${((Date.now() - started) / 1000).toFixed(1)} s`);

    const people = await db
      .selectFrom('person')
      .select(sql<number>`count(*)::int`.as('count'))
      .executeTakeFirstOrThrow();
    expect(people.count).toBe(CLUSTER_SUBSET); // one person per identity, no duplicates

    // every cluster holds exactly one identity's 20 faces
    const [wrong] = await sql<{ bad: number }>`
      SELECT count(*)::int AS bad FROM (
        SELECT af.person_id
        FROM asset_face af JOIN asset a ON a.id = af.asset_id
        WHERE af.person_id IS NOT NULL
        GROUP BY af.person_id
        HAVING count(DISTINCT split_part(a.original_filename, '-', 2)) > 1
            OR count(*) <> ${FACES_PER_IDENTITY}
      ) broken
    `.execute(db).then((r) => r.rows);
    expect(wrong.bad).toBe(0);
  });
});
