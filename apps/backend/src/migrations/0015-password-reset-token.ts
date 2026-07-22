// Single-use, expiring password reset tokens.
//
// Replaces mailing a generated password in plaintext. An emailed password sits
// in an inbox indefinitely, is valid the whole time, and is often still valid
// months later because nobody changes it — the email itself becomes the
// credential. A token here is one-shot, short-lived, and useless once redeemed.
//
// Only the SHA-256 hash is stored, exactly as `session.token` is: a leaked
// database dump must not yield working reset links. This is why the raw token
// cannot be re-sent — a second request issues a new one instead.
//
// used_at is kept rather than deleting the row on redemption. "When was this
// account's password last reset, and who asked for it" is a question that gets
// asked after an incident, and a deleted row answers it with silence.
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS password_reset_token (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
      token bytea NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      -- The super admin who triggered the reset. ON DELETE SET NULL so removing
      -- a staff account never erases the record of what they did.
      created_by uuid REFERENCES "user" (id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);

  // Redemption looks up by token hash; the sweep and the "invalidate this
  // user's outstanding tokens" path both filter by user.
  await sql`CREATE INDEX IF NOT EXISTS password_reset_token_user_idx ON password_reset_token (user_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS password_reset_token_expires_idx ON password_reset_token (expires_at)`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS password_reset_token`.execute(db);
}
