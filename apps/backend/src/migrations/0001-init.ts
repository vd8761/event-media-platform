// Migration 0001 — full EventLens schema (docs/plan/03-database-schema.md).
// asset_face / face_search are column-identical to Immich; the face_index DDL
// comes from the ported vectorIndexQuery (VectorChord, pgvector fallback).
import { Kysely, sql } from 'kysely';
import { VectorExtension } from 'src/enum';
import { vectorIndexQuery } from 'src/utils/database';

const vectorExtension =
  process.env.DB_VECTOR_EXTENSION === 'pgvector' ? VectorExtension.PgVector : VectorExtension.VectorChord;

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS citext`.execute(db);
  if (vectorExtension === VectorExtension.VectorChord) {
    await sql`CREATE EXTENSION IF NOT EXISTS vchord CASCADE`.execute(db);
  } else {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`.execute(db);
  }

  // --- identity & tenancy ---

  await sql`
    CREATE TABLE "user" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email citext NOT NULL UNIQUE,
      password varchar NOT NULL,
      name varchar NOT NULL,
      is_super_admin boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    )`.execute(db);

  await sql`
    CREATE TABLE session (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
      token bytea NOT NULL,
      device_os varchar NOT NULL DEFAULT '',
      device_type varchar NOT NULL DEFAULT '',
      expires_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`CREATE INDEX session_token_idx ON session (token)`.execute(db);

  await sql`
    CREATE TABLE organization (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar NOT NULL,
      slug varchar NOT NULL UNIQUE,
      status varchar NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      created_by uuid REFERENCES "user" (id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    )`.execute(db);

  await sql`
    CREATE TABLE organization_user (
      org_id uuid NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
      role varchar NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (org_id, user_id)
    )`.execute(db);

  await sql`
    CREATE TABLE event (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
      name varchar NOT NULL,
      slug varchar NOT NULL UNIQUE,
      description text,
      starts_at timestamptz,
      ends_at timestamptz,
      status varchar NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
      participant_page_enabled boolean NOT NULL DEFAULT true,
      config jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    )`.execute(db);
  await sql`CREATE INDEX event_org_id_idx ON event (org_id)`.execute(db);

  // --- media ---

  await sql`
    CREATE TABLE asset (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id uuid NOT NULL REFERENCES event (id) ON DELETE CASCADE,
      org_id uuid NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
      type varchar NOT NULL CHECK (type IN ('image', 'video')),
      original_filename varchar NOT NULL,
      checksum bytea NOT NULL,
      file_size bigint NOT NULL,
      mime_type varchar NOT NULL,
      width integer,
      height integer,
      duration_seconds real,
      status varchar NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'stored', 'processed', 'failed')),
      source varchar NOT NULL CHECK (source IN ('upload', 'gdrive', 'onedrive')),
      storage_key text NOT NULL,
      thumbhash bytea,
      captured_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    )`.execute(db);
  // dedupe arbiter — violation is answered with status 'duplicate' (docs/plan/04 §3)
  await sql`CREATE UNIQUE INDEX asset_event_checksum ON asset (event_id, checksum) WHERE deleted_at IS NULL`.execute(db);
  await sql`CREATE INDEX asset_event_captured_idx ON asset (event_id, captured_at DESC)`.execute(db);
  await sql`CREATE INDEX asset_org_id_idx ON asset (org_id)`.execute(db);

  await sql`
    CREATE TABLE asset_file (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      asset_id uuid NOT NULL REFERENCES asset (id) ON DELETE CASCADE,
      type varchar NOT NULL CHECK (type IN ('preview', 'thumbnail', 'encoded_video')),
      storage_key text NOT NULL,
      width integer,
      height integer,
      format varchar,
      file_size bigint,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (asset_id, type)
    )`.execute(db);

  await sql`
    CREATE TABLE asset_exif (
      asset_id uuid PRIMARY KEY REFERENCES asset (id) ON DELETE CASCADE,
      captured_at timestamptz,
      make varchar,
      model varchar,
      orientation integer,
      lens varchar,
      latitude double precision,
      longitude double precision
    )`.execute(db);

  // --- faces (column-identical to Immich) ---

  await sql`
    CREATE TABLE person (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id uuid NOT NULL REFERENCES event (id) ON DELETE CASCADE,
      org_id uuid NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
      name varchar NOT NULL DEFAULT '',
      face_asset_face_id uuid,
      thumbnail_key text NOT NULL DEFAULT '',
      is_hidden boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`CREATE INDEX person_event_id_idx ON person (event_id)`.execute(db);

  await sql`
    CREATE TABLE asset_face (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      asset_id uuid NOT NULL REFERENCES asset (id) ON DELETE CASCADE,
      person_id uuid REFERENCES person (id) ON DELETE SET NULL,
      image_width integer NOT NULL DEFAULT 0,
      image_height integer NOT NULL DEFAULT 0,
      bounding_box_x1 integer NOT NULL DEFAULT 0,
      bounding_box_y1 integer NOT NULL DEFAULT 0,
      bounding_box_x2 integer NOT NULL DEFAULT 0,
      bounding_box_y2 integer NOT NULL DEFAULT 0,
      source_type varchar NOT NULL DEFAULT 'machine-learning',
      deleted_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`CREATE INDEX asset_face_asset_person_idx ON asset_face (asset_id, person_id)`.execute(db);
  await sql`CREATE INDEX asset_face_person_asset_idx ON asset_face (person_id, asset_id) WHERE deleted_at IS NULL`.execute(db);
  await sql`
    ALTER TABLE person
      ADD CONSTRAINT person_face_asset_face_fk
      FOREIGN KEY (face_asset_face_id) REFERENCES asset_face (id) ON DELETE SET NULL`.execute(db);

  await sql`
    CREATE TABLE face_search (
      face_id uuid PRIMARY KEY REFERENCES asset_face (id) ON DELETE CASCADE,
      embedding vector(512) NOT NULL
    )`.execute(db);
  await sql([vectorIndexQuery({ vectorExtension, table: 'face_search', indexName: 'face_index' })] as any).execute(db);

  // --- participants ---

  await sql`
    CREATE TABLE participant (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id uuid NOT NULL REFERENCES event (id) ON DELETE CASCADE,
      email citext NOT NULL,
      selfie_key text,
      selfie_embedding vector(512),
      gallery_token_hash bytea NOT NULL,
      status varchar NOT NULL DEFAULT 'processing'
        CHECK (status IN ('processing', 'no_face', 'pending_match', 'matched')),
      notified_first_at timestamptz,
      last_notified_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    )`.execute(db);
  await sql`CREATE UNIQUE INDEX participant_event_email ON participant (event_id, email) WHERE deleted_at IS NULL`.execute(db);
  await sql`CREATE INDEX participant_token_hash_idx ON participant (gallery_token_hash)`.execute(db);

  await sql`
    CREATE TABLE participant_match (
      participant_id uuid NOT NULL REFERENCES participant (id) ON DELETE CASCADE,
      asset_id uuid NOT NULL REFERENCES asset (id) ON DELETE CASCADE,
      via_face_id uuid REFERENCES asset_face (id) ON DELETE SET NULL,
      distance real NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (participant_id, asset_id)
    )`.execute(db);

  // --- imports ---

  await sql`
    CREATE TABLE cloud_account (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
      provider varchar NOT NULL CHECK (provider IN ('gdrive', 'onedrive')),
      account_email citext NOT NULL,
      refresh_token_enc bytea NOT NULL,
      access_token_enc bytea,
      token_expires_at timestamptz,
      scopes text[] NOT NULL DEFAULT '{}',
      created_by uuid REFERENCES "user" (id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      UNIQUE (org_id, provider, account_email)
    )`.execute(db);

  await sql`
    CREATE TABLE import_job (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id uuid NOT NULL REFERENCES event (id) ON DELETE CASCADE,
      org_id uuid NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
      cloud_account_id uuid NOT NULL REFERENCES cloud_account (id) ON DELETE CASCADE,
      provider varchar NOT NULL CHECK (provider IN ('gdrive', 'onedrive')),
      folder_remote_id varchar NOT NULL,
      folder_name varchar NOT NULL,
      recursive boolean NOT NULL DEFAULT true,
      status varchar NOT NULL DEFAULT 'listing'
        CHECK (status IN ('listing', 'importing', 'done', 'failed', 'cancelled')),
      total_files integer NOT NULL DEFAULT 0,
      done_files integer NOT NULL DEFAULT 0,
      skipped_files integer NOT NULL DEFAULT 0,
      failed_files integer NOT NULL DEFAULT 0,
      error text,
      created_by uuid REFERENCES "user" (id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz
    )`.execute(db);

  await sql`
    CREATE TABLE import_item (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      import_job_id uuid NOT NULL REFERENCES import_job (id) ON DELETE CASCADE,
      event_id uuid NOT NULL,
      provider varchar NOT NULL,
      remote_id varchar NOT NULL,
      remote_name varchar NOT NULL,
      remote_size bigint,
      remote_checksum varchar,
      status varchar NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'downloading', 'done', 'skipped_duplicate', 'failed')),
      asset_id uuid REFERENCES asset (id) ON DELETE SET NULL,
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (event_id, provider, remote_id)
    )`.execute(db);

  // --- operations ---

  await sql`
    CREATE TABLE email_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id uuid REFERENCES event (id) ON DELETE SET NULL,
      participant_id uuid REFERENCES participant (id) ON DELETE SET NULL,
      to_email citext NOT NULL,
      template varchar NOT NULL,
      subject varchar NOT NULL,
      status varchar NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
      message_id varchar,
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      sent_at timestamptz
    )`.execute(db);

  await sql`
    CREATE TABLE system_config (
      key text PRIMARY KEY,
      value jsonb NOT NULL
    )`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const table of [
    'system_config',
    'email_log',
    'import_item',
    'import_job',
    'cloud_account',
    'participant_match',
    'participant',
    'face_search',
    'asset_face',
    'person',
    'asset_exif',
    'asset_file',
    'asset',
    'event',
    'organization_user',
    'organization',
    'session',
    'user',
  ]) {
    await sql([`DROP TABLE IF EXISTS "${table}" CASCADE`] as any).execute(db);
  }
}
