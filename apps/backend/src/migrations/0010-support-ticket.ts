// Support messages from organisers and from the public event pages, surfaced
// in the super-admin "Support" tab.
//
// org_id/user_id are nullable because the public form has no session behind
// it: a public submission carries only a free-text name/email (both optional)
// and, where we know it, the event it was sent from. ON DELETE SET NULL rather
// than CASCADE — deleting an organisation must not erase the support history.
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS support_ticket (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source text NOT NULL CHECK (source IN ('organization', 'public')),
      org_id uuid REFERENCES organization (id) ON DELETE SET NULL,
      user_id uuid REFERENCES "user" (id) ON DELETE SET NULL,
      event_id uuid REFERENCES event (id) ON DELETE SET NULL,
      name text,
      email text,
      message text NOT NULL,
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
      created_at timestamptz NOT NULL DEFAULT now(),
      resolved_at timestamptz
    )`.execute(db);

  // The admin list is "open first, newest first"; this covers both orderings.
  await sql`
    CREATE INDEX IF NOT EXISTS support_ticket_status_created_idx
    ON support_ticket (status, created_at DESC)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS support_ticket`.execute(db);
}
