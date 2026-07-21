// Audit trail for the super-admin Logs tab.
//
// The retention class is stored on the row rather than derived from the
// category at sweep time. Categories get reclassified as a product grows, and
// deriving would silently retro-apply a new policy to history already on disk —
// a row written under "never delete" must stay under it. It also keeps the
// sweep a plain indexed delete instead of a join against a mapping table.
//
// org_id/user_id are nullable and ON DELETE SET NULL: most entries are
// system-generated (the GPU box starting, a job failing) with no actor at all,
// and deleting an organisation must not erase the record that it happened.
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      category text NOT NULL,
      -- 'same_day' | 'thirty_days' | 'never'
      retention text NOT NULL CHECK (retention IN ('same_day', 'thirty_days', 'never')),
      level text NOT NULL CHECK (level IN ('info', 'warning', 'error')),
      -- Machine-readable event key, e.g. 'gpu.start' / 'gpu.stop.failed'.
      action text NOT NULL,
      -- Human sentence shown in the table. The "why", which is the entire
      -- point of this table for GPU lifecycle events.
      message text NOT NULL,
      -- Anything structured worth keeping: queue depths, instance ids, the
      -- provider's error body. Read-only detail, never queried on.
      detail jsonb,
      org_id uuid REFERENCES organization (id) ON DELETE SET NULL,
      user_id uuid REFERENCES "user" (id) ON DELETE SET NULL
    )`.execute(db);

  // The page is "newest first", optionally narrowed by category or level, and
  // polls for anything after a cursor. A DESC index on created_at serves the
  // list, the cursor lookup and the keyset pagination from one structure.
  await sql`
    CREATE INDEX IF NOT EXISTS audit_log_created_idx
    ON audit_log (created_at DESC)`.execute(db);

  // Filtered views ("show me GPU errors") stay indexed rather than degrading
  // into a full scan once the table has a few hundred thousand rows.
  await sql`
    CREATE INDEX IF NOT EXISTS audit_log_category_created_idx
    ON audit_log (category, created_at DESC)`.execute(db);

  // Drives the retention sweep. Without it, the daily delete scans everything.
  await sql`
    CREATE INDEX IF NOT EXISTS audit_log_retention_created_idx
    ON audit_log (retention, created_at)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS audit_log`.execute(db);
}
