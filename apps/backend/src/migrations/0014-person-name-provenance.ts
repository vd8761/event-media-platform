// When a person's name was set, and by whom.
//
// The rule is last-write-wins between the organiser and the guest who claims
// the face — whoever named them most recently is right. Without a timestamp
// that rule is unimplementable: naming from a guest claim fires again every
// time a new face joins the cluster, so an organiser's correction would be
// overwritten by the same old claim on the next photo uploaded. Comparing the
// claim's own time against when the name was last set makes "last" mean the
// actual order the two humans acted in, not the order the jobs happened to run.
//
// name_set_at is nullable: a cluster that has never been named has no such
// moment, and any claim beats it. Existing named rows get NULL too, which is
// the lenient reading — the first claim after this migration wins, which is
// what an organiser who has not touched a name in months would expect.
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE person
      ADD COLUMN IF NOT EXISTS name_set_at timestamptz`.execute(db);

  // 'organiser' | 'participant'. Kept as free text rather than a CHECK: it is
  // display provenance, and a bad value must never block a rename.
  await sql`
    ALTER TABLE person
      ADD COLUMN IF NOT EXISTS name_source varchar NOT NULL DEFAULT ''`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE person DROP COLUMN IF EXISTS name_source`.execute(db);
  await sql`ALTER TABLE person DROP COLUMN IF EXISTS name_set_at`.execute(db);
}
