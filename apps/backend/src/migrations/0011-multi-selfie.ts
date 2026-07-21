// Multi-selfie matching: a participant may submit 1–3 selfies, all treated as
// the same person. One embedding per selfie lives in participant_selfie, and
// matching searches with every one of them, keeping the best distance per face.
//
// participant.selfie_key / selfie_embedding are deliberately kept: they now
// hold the *primary* (first) selfie and act as the "has been processed" flag
// that the sweep and re-match queries already key off, so nothing downstream
// had to change to stay correct.
import { Kysely, sql } from 'kysely';
import { VectorExtension } from 'src/enum';
import { vectorIndexQuery } from 'src/utils/database';

const vectorExtension =
  process.env.DB_VECTOR_EXTENSION === 'pgvector' ? VectorExtension.PgVector : VectorExtension.VectorChord;

export async function up(db: Kysely<unknown>): Promise<void> {
  // Collected alongside the selfies so an organiser can reach a guest whose
  // email bounces. Nullable — existing participants have none.
  await sql`ALTER TABLE participant ADD COLUMN IF NOT EXISTS phone text`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS participant_selfie (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      participant_id uuid NOT NULL REFERENCES participant (id) ON DELETE CASCADE,
      ordinal integer NOT NULL,
      storage_key text NOT NULL,
      -- NULL until the selfie job has embedded it, or permanently if no face
      -- was found in this particular photo.
      embedding vector(512),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (participant_id, ordinal)
    )`.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS participant_selfie_participant_idx
    ON participant_selfie (participant_id)`.execute(db);

  // Carry existing single selfies over as ordinal 0, so already-registered
  // participants keep matching without resubmitting.
  await sql`
    INSERT INTO participant_selfie (participant_id, ordinal, storage_key, embedding)
    SELECT id, 0, selfie_key, selfie_embedding
    FROM participant
    WHERE selfie_key IS NOT NULL AND deleted_at IS NULL
    ON CONFLICT DO NOTHING`.execute(db);

  await sql([
    vectorIndexQuery({ vectorExtension, table: 'participant_selfie', indexName: 'participant_selfie_index' }),
  ] as unknown as TemplateStringsArray).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS participant_selfie`.execute(db);
  await sql`ALTER TABLE participant DROP COLUMN IF EXISTS phone`.execute(db);
}
