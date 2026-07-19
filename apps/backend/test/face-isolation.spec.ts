// Mandated cross-event isolation test (M3 acceptance, risk R2 —
// docs/plan/06-face-pipeline.md §7, docs/plan/12-roadmap.md).
//
// The same human at two events must be two unrelated person rows, and no face
// query may ever cross events. Runs the REAL clustering code
// (FaceService.handleRecognizeFaces) and the REAL event-scoped searchFaces SQL
// against a real Postgres+VectorChord — only ML detection is bypassed by
// inserting deterministic embeddings directly.
//
// Requires the dev database container (docker/docker-compose.dev.yml, host
// port 5433).
import { CamelCasePlugin, Kysely, Migrator, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { JobName, JobStatus } from 'src/enum';
import { StaticMigrationProvider } from 'src/migrations';
import { ConfigRepository, clearEnvCache } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { FaceRepository } from 'src/repositories/face.repository';
import { FaceSearchRepository } from 'src/repositories/face-search.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SystemConfigRepository } from 'src/repositories/system-config.repository';
import { FaceService } from 'src/services/face.service';
import { DB } from 'src/schema';
import { JobItem } from 'src/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminConnectionOptions, testDatabaseUrl } from './database-url';

const TEST_DB = 'eventlens_test';

// 512-d unit vectors. Same identity = tiny angular perturbations of one base
// vector; the base is different per identity.
function embedding(identity: number, variant: number): string {
  const vector = new Array<number>(512).fill(0);
  vector[identity] = 1;
  vector[identity + 100] = 0.005 * variant; // small same-person variation
  const norm = Math.hypot(...vector);
  return JSON.stringify(vector.map((value) => value / norm));
}

// captures queued jobs instead of touching Redis
class FakeJobRepository {
  items: JobItem[] = [];
  async queue(item: JobItem) {
    this.items.push(item);
  }
  async queueAll(items: JobItem[]) {
    this.items.push(...items);
  }
  async waitForQueueCompletion() {}
  takeAll(): JobItem[] {
    const items = this.items;
    this.items = [];
    return items;
  }
}

describe('cross-event face isolation (risk R2)', () => {
  let db: Kysely<DB>;
  let faceService: FaceService;
  let faceSearchRepository: FaceSearchRepository;
  let personRepository: PersonRepository;
  let jobs: FakeJobRepository;

  let orgId: string;
  let eventA: string;
  let eventB: string;
  const faceIdsByEvent: Record<string, string[]> = {};

  beforeAll(async () => {
    // fresh test database
    const admin = new pg.Client(adminConnectionOptions());
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    await admin.end();

    process.env.DATABASE_URL = testDatabaseUrl(TEST_DB);
    process.env.EL_ENV = 'development';
    clearEnvCache();

    db = new Kysely<DB>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({ connectionString: testDatabaseUrl(TEST_DB) }),
      }),
      plugins: [new CamelCasePlugin()],
    });

    const migrator = new Migrator({ db: db as Kysely<unknown>, provider: new StaticMigrationProvider() });
    const { error } = await migrator.migrateToLatest();
    if (error) {
      throw error;
    }

    // real repositories on the test DB
    const configRepository = new ConfigRepository();
    const logger = new LoggingRepository(configRepository);
    const cryptoRepository = new CryptoRepository();
    const eventRepository = new EventRepository(db);
    const faceRepository = new FaceRepository(db);
    faceSearchRepository = new FaceSearchRepository(db, configRepository);
    personRepository = new PersonRepository(db);
    const systemConfigRepository = new SystemConfigRepository(db);
    jobs = new FakeJobRepository();

    faceService = new FaceService(
      null as any, // assetRepository — not used by recognition
      configRepository,
      cryptoRepository,
      null as any, // databaseRepository — prewarm not used in recognize path
      eventRepository,
      faceRepository,
      faceSearchRepository,
      jobs as any,
      logger,
      null as any, // machineLearningRepository — bypassed
      null as any, // mediaRepository — not used
      personRepository,
      null as any, // storageRepository — not used
      systemConfigRepository,
    );

    // --- seed: one org, two events, the SAME person's faces in both ---
    const org = await db
      .insertInto('organization')
      .values({ name: 'Test Org', slug: 'test-org' })
      .returning('id')
      .executeTakeFirstOrThrow();
    orgId = org.id;

    for (const [slug, setId] of [
      ['event-a', 'a'],
      ['event-b', 'b'],
    ] as const) {
      const event = await db
        .insertInto('event')
        .values({ orgId, name: slug, slug })
        .returning('id')
        .executeTakeFirstOrThrow();
      const eventId = event.id;
      if (setId === 'a') {
        eventA = eventId;
      } else {
        eventB = eventId;
      }
      faceIdsByEvent[eventId] = [];

      // 3 photos of identity #0 → minFaces(3) reached in each event
      for (let variant = 0; variant < 3; variant++) {
        const asset = await db
          .insertInto('asset')
          .values({
            eventId,
            orgId,
            type: 'image' as any,
            originalFilename: `${slug}-${variant}.jpg`,
            checksum: Buffer.from(`${slug}-${variant}`),
            fileSize: 1,
            mimeType: 'image/jpeg',
            source: 'upload' as any,
            storageKey: `test/${slug}/${variant}`,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        const face = await db
          .insertInto('assetFace')
          .values({ assetId: asset.id, imageWidth: 1000, imageHeight: 1000 })
          .returning('id')
          .executeTakeFirstOrThrow();
        await db.insertInto('faceSearch').values({ faceId: face.id, embedding: embedding(0, variant) }).execute();
        faceIdsByEvent[eventId].push(face.id);
      }
    }
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('runs the full clustering pass (core + deferred) in both events', async () => {
    const allFaceIds = [...faceIdsByEvent[eventA], ...faceIdsByEvent[eventB]];

    for (const faceId of allFaceIds) {
      await faceService.handleRecognizeFaces({ faceId });
    }
    // second pass for deferred faces requeued by the service
    for (const item of jobs.takeAll()) {
      if (item.name === JobName.FaceRecognize) {
        const status = await faceService.handleRecognizeFaces(item.data as any);
        expect(status).not.toBe(JobStatus.Failed);
      }
    }

    // every face ended up assigned
    const unassigned = await db
      .selectFrom('assetFace')
      .select('id')
      .where('personId', 'is', null)
      .execute();
    expect(unassigned).toHaveLength(0);
  });

  it('(a) creates two DISJOINT person rows — one per event, never shared', async () => {
    const people = await db.selectFrom('person').selectAll().execute();
    expect(people).toHaveLength(2);
    expect(new Set(people.map((person) => person.eventId))).toEqual(new Set([eventA, eventB]));

    // faces of event A all point at the event-A person, same for B
    for (const eventId of [eventA, eventB]) {
      const expected = people.find((person) => person.eventId === eventId)!;
      for (const faceId of faceIdsByEvent[eventId]) {
        const face = await db
          .selectFrom('assetFace')
          .select('personId')
          .where('id', '=', faceId)
          .executeTakeFirstOrThrow();
        expect(face.personId).toBe(expected.id);
      }
    }
  });

  it('(c) searchFaces scoped to event A NEVER returns event B faces', async () => {
    // identical embedding exists in both events — the CTE scope is the only
    // thing keeping them apart
    const results = await faceSearchRepository.searchFaces({
      eventId: eventA,
      embedding: embedding(0, 0),
      numResults: 100,
      maxDistance: 1,
    });

    expect(results.length).toBeGreaterThan(0);
    const eventBFaces = new Set(faceIdsByEvent[eventB]);
    for (const result of results) {
      expect(eventBFaces.has(result.id)).toBe(false);
      expect(faceIdsByEvent[eventA]).toContain(result.id);
    }
  });

  it('(b) selfie-style matching in event A yields zero event-B assets', async () => {
    const matches = await faceSearchRepository.searchFacesByEmbedding(eventA, embedding(0, 1), { maxDistance: 0.5 });

    expect(matches.length).toBeGreaterThan(0);
    const eventAAssets = new Set(
      (await db.selectFrom('asset').select('id').where('eventId', '=', eventA).execute()).map((row) => row.id),
    );
    for (const match of matches) {
      expect(eventAAssets.has(match.assetId)).toBe(true);
    }
  });

  it('different identities never merge into one person', async () => {
    // add a second identity (orthogonal embedding) to event A and cluster it
    const assets: string[] = [];
    const newFaces: string[] = [];
    for (let variant = 0; variant < 3; variant++) {
      const asset = await db
        .insertInto('asset')
        .values({
          eventId: eventA,
          orgId,
          type: 'image' as any,
          originalFilename: `id2-${variant}.jpg`,
          checksum: Buffer.from(`id2-${variant}`),
          fileSize: 1,
          mimeType: 'image/jpeg',
          source: 'upload' as any,
          storageKey: `test/id2/${variant}`,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      assets.push(asset.id);

      const face = await db
        .insertInto('assetFace')
        .values({ assetId: asset.id, imageWidth: 1000, imageHeight: 1000 })
        .returning('id')
        .executeTakeFirstOrThrow();
      // identity #7 — orthogonal to identity #0
      await db.insertInto('faceSearch').values({ faceId: face.id, embedding: embedding(7, variant) }).execute();
      newFaces.push(face.id);
    }

    for (const faceId of newFaces) {
      await faceService.handleRecognizeFaces({ faceId });
    }
    for (const item of jobs.takeAll()) {
      if (item.name === JobName.FaceRecognize) {
        await faceService.handleRecognizeFaces(item.data as any);
      }
    }

    const peopleInA = await db.selectFrom('person').selectAll().where('eventId', '=', eventA).execute();
    expect(peopleInA).toHaveLength(2); // identity 0 + identity 7, not merged
  });
});
