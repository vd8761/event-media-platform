// Event cover image — the thumbnail shown beside each event in the sidebar
// (the Immich albums pattern).
//
// Stored as a reference to an asset rather than a copied storage key so the
// cover always tracks that photo's generated thumbnail, and cannot outlive it:
// ON DELETE SET NULL means deleting the chosen photo clears the cover instead
// of leaving a dangling key that 404s in the sidebar.
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE event
      ADD COLUMN IF NOT EXISTS cover_asset_id uuid REFERENCES asset (id) ON DELETE SET NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE event DROP COLUMN IF EXISTS cover_asset_id`.execute(db);
}
