// When a guest claims their face, the organiser should see their name on the
// cluster — not an unnamed face the guest has already identified.
//
// The subtlety is ordering: matching (participant -> faces) and clustering
// (faces -> person) are separate queues and either can finish first. Naming
// only from the participant side missed every case where clustering ran later,
// which is the common one, and nothing ever retried it.
//
// Runs the real SQL against real Postgres — `nameFromParticipants` is a single
// UPDATE with a correlated scalar subquery, and that is exactly the kind of
// statement unit tests with fakes cannot tell you is valid.
//
// Requires the dev database container (docker/docker-compose.dev.yml, port 5433).
import { CamelCasePlugin, Kysely, Migrator, PostgresDialect } from 'kysely';
import pg from 'pg';
import { StaticMigrationProvider } from 'src/migrations';
import { PersonRepository } from 'src/repositories/person.repository';
import { DB } from 'src/schema';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminConnectionOptions, testDatabaseUrl } from './database-url';

const TEST_DB = 'eventlens_naming_test';

describe('naming a cluster from the guest who claimed it', () => {
  let db: Kysely<DB>;
  let personRepository: PersonRepository;
  let orgId: string;
  let eventId: string;
  let assetId: string;

  beforeAll(async () => {
    const admin = new pg.Client(adminConnectionOptions());
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    await admin.end();

    db = new Kysely<DB>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: testDatabaseUrl(TEST_DB) }) }),
      plugins: [new CamelCasePlugin()],
    });
    const { error } = await new Migrator({
      db: db as Kysely<unknown>,
      provider: new StaticMigrationProvider(),
    }).migrateToLatest();
    if (error) {
      throw error;
    }

    personRepository = new PersonRepository(db);

    const org = await db
      .insertInto('organization')
      .values({ name: 'Naming Org', slug: 'naming-org' })
      .returning('id')
      .executeTakeFirstOrThrow();
    orgId = org.id;
    const event = await db
      .insertInto('event')
      .values({ orgId, name: 'Naming Event', slug: 'naming-event' })
      .returning('id')
      .executeTakeFirstOrThrow();
    eventId = event.id;
    const asset = await db
      .insertInto('asset')
      .values({
        eventId,
        orgId,
        type: 'image',
        originalFilename: 'a.jpg',
        checksum: Buffer.from('naming-checksum'),
        fileSize: 1n as never,
        mimeType: 'image/jpeg',
        source: 'upload',
        storageKey: 'k/a.jpg',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    assetId = asset.id;
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  beforeEach(async () => {
    await db.deleteFrom('participantMatch').execute();
    await db.deleteFrom('participant').execute();
    await db.deleteFrom('assetFace').execute();
    await db.deleteFrom('person').execute();
  });

  const makePerson = async (name = '') => {
    const person = await db
      .insertInto('person')
      .values({ eventId, orgId, name })
      .returning('id')
      .executeTakeFirstOrThrow();
    return person.id;
  };

  // Each face gets its own asset: participant_match is keyed on
  // (participant_id, asset_id), so one photo can only ever carry one claim —
  // which is exactly how it works in production, one match row per photo.
  let faceSeq = 0;
  const makeFace = async (personId: string | null) => {
    const asset = await db
      .insertInto('asset')
      .values({
        eventId,
        orgId,
        type: 'image',
        originalFilename: `f${faceSeq}.jpg`,
        checksum: Buffer.from(`face-checksum-${faceSeq++}`),
        fileSize: 1n as never,
        mimeType: 'image/jpeg',
        source: 'upload',
        storageKey: `k/f${faceSeq}.jpg`,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const face = await db
      .insertInto('assetFace')
      .values({ assetId: asset.id, personId })
      .returning(['id', 'assetId'])
      .executeTakeFirstOrThrow();
    return face.id;
  };

  // A claim is a participant row plus a participantMatch pointing at the face
  // the selfie matched.
  // participant.name is NOT NULL DEFAULT '', so an unnamed guest is '', not null.
  const claim = async (email: string, name: string, faceIds: string[]) => {
    const participant = await db
      .insertInto('participant')
      .values({ eventId, email, name, galleryTokenHash: Buffer.from(email) } as never)
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const faceId of faceIds) {
      const face = await db
        .selectFrom('assetFace')
        .select('assetId')
        .where('id', '=', faceId)
        .executeTakeFirstOrThrow();
      await db
        .insertInto('participantMatch')
        .values({ participantId: participant.id, assetId: face.assetId, viaFaceId: faceId, distance: 0.2 })
        .execute();
    }
    return participant.id;
  };

  it('names an unnamed cluster with the claiming guest', async () => {
    const personId = await makePerson();
    const faceId = await makeFace(personId);
    await claim('priya@example.com', 'Priya', [faceId]);

    await expect(personRepository.nameFromParticipants(eventId, personId)).resolves.toBe('Priya');

    const person = await db.selectFrom('person').select('name').where('id', '=', personId).executeTakeFirst();
    expect(person?.name).toBe('Priya');
  });

  it('leaves a cluster the organiser already named alone', async () => {
    // A guest's self-reported name must never overwrite a deliberate one.
    const personId = await makePerson('Organiser Choice');
    const faceId = await makeFace(personId);
    await claim('priya@example.com', 'Priya', [faceId]);

    await expect(personRepository.nameFromParticipants(eventId, personId)).resolves.toBeNull();

    const person = await db.selectFrom('person').select('name').where('id', '=', personId).executeTakeFirst();
    expect(person?.name).toBe('Organiser Choice');
  });

  it('does nothing when nobody has claimed the cluster', async () => {
    // The dangerous version of this writes NULL into a NOT NULL column.
    const personId = await makePerson();
    await makeFace(personId);

    await expect(personRepository.nameFromParticipants(eventId, personId)).resolves.toBeNull();

    const person = await db.selectFrom('person').select('name').where('id', '=', personId).executeTakeFirst();
    expect(person?.name).toBe('');
  });

  it('ignores a claimant who never gave a name', async () => {
    // Name is optional on the selfie form; an empty one must not blank the
    // cluster or win the vote.
    const personId = await makePerson();
    const faceId = await makeFace(personId);
    await claim('anon@example.com', '', [faceId]);

    await expect(personRepository.nameFromParticipants(eventId, personId)).resolves.toBeNull();
    const person = await db.selectFrom('person').select('name').where('id', '=', personId).executeTakeFirst();
    expect(person?.name).toBe('');
  });

  it('picks the guest who claimed the most faces in the cluster', async () => {
    // Clustering is imperfect, so a stranger can match loosely on one face.
    // They must not out-vote the guest who owns the rest of the cluster.
    const personId = await makePerson();
    const faces = [await makeFace(personId), await makeFace(personId), await makeFace(personId)];
    await claim('priya@example.com', 'Priya', faces.slice(0, 2));
    await claim('stranger@example.com', 'Stranger', faces.slice(2));

    await expect(personRepository.nameFromParticipants(eventId, personId)).resolves.toBe('Priya');
  });

  it('ignores faces belonging to other clusters', async () => {
    // The whole point is per-cluster evidence: a claim on someone else's
    // cluster must not leak across.
    const mine = await makePerson();
    const theirs = await makePerson();
    await makeFace(mine);
    const theirFace = await makeFace(theirs);
    await claim('priya@example.com', 'Priya', [theirFace]);

    await expect(personRepository.nameFromParticipants(eventId, mine)).resolves.toBeNull();
  });

  it('ignores a deleted participant', async () => {
    const personId = await makePerson();
    const faceId = await makeFace(personId);
    const participantId = await claim('gone@example.com', 'Gone', [faceId]);
    await db
      .updateTable('participant')
      .set({ deletedAt: new Date() })
      .where('id', '=', participantId)
      .execute();

    await expect(personRepository.nameFromParticipants(eventId, personId)).resolves.toBeNull();
  });

  it('will not name a cluster belonging to another event', async () => {
    // Event scoping is risk R2: nothing about one event may reach another.
    const personId = await makePerson();
    const faceId = await makeFace(personId);
    await claim('priya@example.com', 'Priya', [faceId]);

    const other = await db
      .insertInto('event')
      .values({ orgId, name: 'Other', slug: 'other-event' })
      .returning('id')
      .executeTakeFirstOrThrow();

    await expect(personRepository.nameFromParticipants(other.id, personId)).resolves.toBeNull();
  });
});
