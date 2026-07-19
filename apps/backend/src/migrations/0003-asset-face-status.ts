// Migration 0003 — per-asset face-detection bookkeeping.
//
// Without this there is no way to tell "detection has not run yet" from
// "detection ran and the photo genuinely has no faces": both look like zero
// asset_face rows. The People and Jobs pages need that distinction to report
// what is still pending, and Immich carries the same idea in its
// asset_job_status.facesRecognizedAt column.
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE asset ADD COLUMN faces_detected_at timestamptz`.execute(db);
  await sql`ALTER TABLE asset ADD COLUMN face_count integer NOT NULL DEFAULT 0`.execute(db);

  // Backfill: any asset that already has faces has clearly been through
  // detection. Assets with zero faces stay NULL and get re-queued, which is
  // the safe direction — a redundant detect is cheap, a missed one is not.
  await sql`
    UPDATE asset a
    SET faces_detected_at = now(),
        face_count = counted.total
    FROM (
      SELECT asset_id, count(*)::int AS total
      FROM asset_face
      WHERE deleted_at IS NULL
      GROUP BY asset_id
    ) AS counted
    WHERE counted.asset_id = a.id
  `.execute(db);

  // Drives the "pending detection" lookup on the event dashboard.
  await sql`
    CREATE INDEX asset_faces_pending_idx ON asset (event_id)
    WHERE faces_detected_at IS NULL AND deleted_at IS NULL
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS asset_faces_pending_idx`.execute(db);
  await sql`ALTER TABLE asset DROP COLUMN face_count`.execute(db);
  await sql`ALTER TABLE asset DROP COLUMN faces_detected_at`.execute(db);
}
