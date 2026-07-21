// Subscription plan and quota overrides on the organisation.
//
// Starter and Pro limits live in code (PLAN_LIMITS) rather than here: they are
// the same for every org on that plan, and a per-row copy would drift the
// moment one is edited by hand. The override columns exist for Enterprise,
// which is negotiated per customer — nullable, so "no override" is the absence
// of a value rather than a sentinel that has to be kept in sync with the code
// default.
//
// A super admin may only set the overrides on an Enterprise org. That rule is
// enforced in the service rather than by a constraint, because it depends on
// the plan column and CHECK constraints that span columns make future plan
// changes needlessly painful.
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE organization
      ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'starter'
        CHECK (plan IN ('starter', 'pro', 'enterprise'))`.execute(db);

  // bigint: 50 GB in bytes already exceeds a 32-bit int, and Enterprise is
  // explicitly "whatever we agreed".
  await sql`
    ALTER TABLE organization
      ADD COLUMN IF NOT EXISTS storage_limit_bytes bigint`.execute(db);

  await sql`
    ALTER TABLE organization
      ADD COLUMN IF NOT EXISTS event_limit integer`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE organization DROP COLUMN IF EXISTS event_limit`.execute(db);
  await sql`ALTER TABLE organization DROP COLUMN IF EXISTS storage_limit_bytes`.execute(db);
  await sql`ALTER TABLE organization DROP COLUMN IF EXISTS plan`.execute(db);
}
