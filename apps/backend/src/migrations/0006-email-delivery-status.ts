// Delivery tracking for outbound mail (Resend webhooks). `sent` only means
// the provider accepted the message; delivered/bounced/complained arrive
// later over the webhook and are matched back by provider message id.
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE email_log DROP CONSTRAINT IF EXISTS email_log_status_check`.execute(db);
  await sql`
    ALTER TABLE email_log ADD CONSTRAINT email_log_status_check
    CHECK (status IN ('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed'))`.execute(db);

  // Webhooks arrive keyed by the provider's id, so this is the lookup path.
  await sql`CREATE INDEX IF NOT EXISTS email_log_message_id_idx ON email_log (message_id)`.execute(db);

  // When the provider last told us something about this message — distinct
  // from sent_at, which is when we handed it over.
  await sql`ALTER TABLE email_log ADD COLUMN IF NOT EXISTS status_at timestamptz`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE email_log DROP COLUMN IF EXISTS status_at`.execute(db);
  await sql`DROP INDEX IF EXISTS email_log_message_id_idx`.execute(db);
  await sql`ALTER TABLE email_log DROP CONSTRAINT IF EXISTS email_log_status_check`.execute(db);
  await sql`
    ALTER TABLE email_log ADD CONSTRAINT email_log_status_check
    CHECK (status IN ('queued', 'sent', 'failed'))`.execute(db);
}
