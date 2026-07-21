// Smart-search embeddings for "view similar photos" (Immich's smart_search
// table + CLIP visual embedding). One 512-dim CLIP vector per asset, with a
// cosine vector index — the same shape as face_search, but keyed on the asset
// rather than a detected face. Kept in its own table (not a column on asset)
// so a missing/failed embedding is simply an absent row, and the vector index
// lives on a table that only holds vectors.
import { Kysely, sql } from 'kysely';
import { VectorExtension } from 'src/enum';
import { vectorIndexQuery } from 'src/utils/database';

const vectorExtension =
  process.env.DB_VECTOR_EXTENSION === 'pgvector' ? VectorExtension.PgVector : VectorExtension.VectorChord;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS smart_search (
      asset_id uuid PRIMARY KEY REFERENCES asset (id) ON DELETE CASCADE,
      embedding vector(512) NOT NULL
    )`.execute(db);
  await sql([vectorIndexQuery({ vectorExtension, table: 'smart_search', indexName: 'clip_index' })] as unknown as TemplateStringsArray).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS smart_search`.execute(db);
}
