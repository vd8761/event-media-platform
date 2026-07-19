// Migration 0005 — participant names, and dropping the event cover photo.
//
// participant.name: collected with the email and selfie, so detected faces can
// be labelled with a real name instead of "Unnamed".
//
// event.feature_asset_id is removed: "feature photo" was meant to be a
// person's cover portrait (which face crop represents them), which is
// person.face_asset_face_id and already exists — not a cover for the event.
// Introduced and withdrawn in the same development cycle, so nothing depends
// on it.
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE participant ADD COLUMN name varchar(200) NOT NULL DEFAULT ''`.execute(db);
  await sql`ALTER TABLE event DROP COLUMN IF EXISTS feature_asset_id`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE event ADD COLUMN feature_asset_id uuid REFERENCES asset (id) ON DELETE SET NULL`.execute(db);
  await sql`ALTER TABLE participant DROP COLUMN name`.execute(db);
}
