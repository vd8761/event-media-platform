// Event expiration (organizer-set) and the retention window that follows it.
//
// Two distinct moments, deliberately separated:
//   expires_at  — participant gallery links stop working. Nothing is deleted.
//   purge_after — the media is actually removed from R2.
//
// The gap between them is the grace period during which an organizer can
// extend, purge early, or do nothing. Deleting event media is irreversible, so
// it never happens on the same tick as the link going dark.
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE event
      ADD COLUMN IF NOT EXISTS expires_at timestamptz,
      ADD COLUMN IF NOT EXISTS expiry_notified_at timestamptz,
      ADD COLUMN IF NOT EXISTS expiry_acknowledged_at timestamptz,
      ADD COLUMN IF NOT EXISTS purge_after timestamptz,
      ADD COLUMN IF NOT EXISTS purged_at timestamptz`.execute(db);

  // The expiry sweep asks "which live events have passed expires_at and have
  // not been notified yet"; the purge sweep asks the same of purge_after.
  // Partial indexes keep both cheap as the table grows.
  await sql`
    CREATE INDEX IF NOT EXISTS event_expiry_pending_idx ON event (expires_at)
    WHERE expires_at IS NOT NULL AND expiry_notified_at IS NULL AND deleted_at IS NULL`.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS event_purge_pending_idx ON event (purge_after)
    WHERE purge_after IS NOT NULL AND purged_at IS NULL AND deleted_at IS NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS event_purge_pending_idx`.execute(db);
  await sql`DROP INDEX IF EXISTS event_expiry_pending_idx`.execute(db);
  await sql`
    ALTER TABLE event
      DROP COLUMN IF EXISTS purged_at,
      DROP COLUMN IF EXISTS purge_after,
      DROP COLUMN IF EXISTS expiry_acknowledged_at,
      DROP COLUMN IF EXISTS expiry_notified_at,
      DROP COLUMN IF EXISTS expires_at`.execute(db);
}
