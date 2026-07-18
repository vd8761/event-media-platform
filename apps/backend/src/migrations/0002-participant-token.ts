// Migration 0002 — store the gallery token AES-256-GCM-encrypted alongside its
// hash. Deviation from docs/plan/03 (hash-only): digest emails are sent
// server-side hours after signup and must embed the raw token in the gallery
// link, so the raw value has to be recoverable. Lookups still use the hash;
// the encryption key is EL_TOKEN_ENCRYPTION_KEY (same key the plan mandates
// for cloud-import tokens).
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE participant ADD COLUMN gallery_token_enc bytea`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE participant DROP COLUMN gallery_token_enc`.execute(db);
}
