// Migration 0004 — participant-facing sharing controls, the shared event cover
// photo, and the bookkeeping the new selfie email flow needs.
//
//   event.feature_asset_id            one cover photo per event; participants
//                                     and organisers both set it (a shared
//                                     pick, not per-viewer)
//   event.participants_see_all_photos organiser opens the whole event gallery
//                                     to participants
//   event.participants_can_download_all  and, separately, whether they may
//                                     download those other photos (their own
//                                     are always downloadable)
//   participant.gallery_opened_at     first time the tokenized link was opened
//   participant.awaiting_result_notice set when someone opens the link while
//                                     their selfie is still processing — the
//                                     only case where a second "we're done"
//                                     email is warranted
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE event
      ADD COLUMN feature_asset_id uuid REFERENCES asset (id) ON DELETE SET NULL,
      ADD COLUMN participants_see_all_photos boolean NOT NULL DEFAULT false,
      ADD COLUMN participants_can_download_all boolean NOT NULL DEFAULT false
  `.execute(db);

  await sql`
    ALTER TABLE participant
      ADD COLUMN gallery_opened_at timestamptz,
      ADD COLUMN awaiting_result_notice boolean NOT NULL DEFAULT false
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE participant
      DROP COLUMN awaiting_result_notice,
      DROP COLUMN gallery_opened_at
  `.execute(db);

  await sql`
    ALTER TABLE event
      DROP COLUMN participants_can_download_all,
      DROP COLUMN participants_see_all_photos,
      DROP COLUMN feature_asset_id
  `.execute(db);
}
