// Kysely DB interface for the EventLens schema (docs/plan/03-database-schema.md).
// Columns are snake_case in Postgres; CamelCasePlugin maps them to the
// camelCase names below. asset_face / face_search stay column-identical to
// Immich so ported face SQL runs unchanged.
import { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';
import {
  AssetFileType,
  AssetSource,
  AssetStatus,
  AssetType,
  CloudProvider,
  EmailStatus,
  EmailTemplate,
  EventStatus,
  FaceSourceType,
  ImportItemStatus,
  ImportJobStatus,
  OrgRole,
  OrgStatus,
  ParticipantStatus,
} from 'src/enum';

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type CreatedAt = ColumnType<Date, never, never>;
// NOTE: kysely's Generated<S> does not unwrap a nested ColumnType, so
// DB-defaulted timestamps need this alias rather than wrapping Timestamp.
type GeneratedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface UserTable {
  id: Generated<string>;
  email: string;
  password: string;
  name: string;
  isSuperAdmin: Generated<boolean>;
  createdAt: CreatedAt;
  updatedAt: GeneratedTimestamp;
  deletedAt: Timestamp | null;
}

export interface SessionTable {
  id: Generated<string>;
  userId: string;
  token: Buffer;
  deviceOs: Generated<string>;
  deviceType: Generated<string>;
  expiresAt: Timestamp | null;
  createdAt: CreatedAt;
  updatedAt: GeneratedTimestamp;
}

export interface OrganizationTable {
  id: Generated<string>;
  name: string;
  slug: string;
  status: Generated<OrgStatus>;
  createdBy: string | null;
  createdAt: CreatedAt;
  updatedAt: GeneratedTimestamp;
  deletedAt: Timestamp | null;
}

export interface OrganizationUserTable {
  orgId: string;
  userId: string;
  role: OrgRole;
  createdAt: CreatedAt;
}

export interface EventTable {
  id: Generated<string>;
  orgId: string;
  name: string;
  slug: string;
  description: string | null;
  startsAt: Timestamp | null;
  endsAt: Timestamp | null;
  status: Generated<EventStatus>;
  participantPageEnabled: Generated<boolean>;
  config: Generated<EventConfig>;
  participantsSeeAllPhotos: Generated<boolean>;
  participantsCanDownloadAll: Generated<boolean>;
  // Expiration (migration 0007). expiresAt closes the participant links;
  // purgeAfter is when the media actually leaves R2. Everything between the
  // two is the organizer's window to extend or purge early.
  // Sidebar thumbnail. Nulled automatically if the chosen photo is deleted
  // (migration 0008).
  coverAssetId: string | null;
  expiresAt: Timestamp | null;
  expiryNotifiedAt: Timestamp | null;
  expiryAcknowledgedAt: Timestamp | null;
  purgeAfter: Timestamp | null;
  purgedAt: Timestamp | null;
  createdAt: CreatedAt;
  updatedAt: GeneratedTimestamp;
  deletedAt: Timestamp | null;
}

// Per-event overrides of the facial-recognition defaults (docs/plan/06 §2).
export interface EventConfig {
  matchMaxDistance?: number;
  minScore?: number;
  // How many similar faces are needed before a cluster becomes a person.
  // Defaults to 1 so nobody is missed; raise it on large events where
  // single-photo people become noise.
  minFaces?: number;
}

export interface AssetTable {
  id: Generated<string>;
  eventId: string;
  orgId: string;
  type: AssetType;
  originalFilename: string;
  checksum: Buffer;
  fileSize: number;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  status: Generated<AssetStatus>;
  source: AssetSource;
  storageKey: string;
  thumbhash: Buffer | null;
  capturedAt: Timestamp | null;
  createdAt: CreatedAt;
  deletedAt: Timestamp | null;
  // NULL until face detection has run — distinguishes "not processed yet"
  // from "processed, no faces found" (migration 0003).
  facesDetectedAt: Timestamp | null;
  faceCount: Generated<number>;
}

export interface AssetFileTable {
  id: Generated<string>;
  assetId: string;
  type: AssetFileType;
  storageKey: string;
  width: number | null;
  height: number | null;
  format: string | null;
  fileSize: number | null;
  createdAt: CreatedAt;
}

export interface AssetExifTable {
  assetId: string;
  capturedAt: Timestamp | null;
  make: string | null;
  model: string | null;
  orientation: number | null;
  lens: string | null;
  latitude: number | null;
  longitude: number | null;
}

// Column-identical to immich:server/src/schema/tables/asset-face.table.ts.
export interface AssetFaceTable {
  id: Generated<string>;
  assetId: string;
  personId: string | null;
  imageWidth: Generated<number>;
  imageHeight: Generated<number>;
  boundingBoxX1: Generated<number>;
  boundingBoxY1: Generated<number>;
  boundingBoxX2: Generated<number>;
  boundingBoxY2: Generated<number>;
  sourceType: Generated<FaceSourceType>;
  deletedAt: Timestamp | null;
  updatedAt: GeneratedTimestamp;
}

// Column-identical to immich:server/src/schema/tables/face-search.table.ts.
export interface FaceSearchTable {
  faceId: string;
  embedding: string;
}

// One CLIP visual embedding per asset — backs "view similar photos"
// (immich smart_search).
export interface SmartSearchTable {
  assetId: string;
  embedding: string;
}

export interface PersonTable {
  id: Generated<string>;
  eventId: string;
  orgId: string;
  name: Generated<string>;
  faceAssetFaceId: string | null;
  thumbnailKey: Generated<string>;
  isHidden: Generated<boolean>;
  createdAt: CreatedAt;
  updatedAt: GeneratedTimestamp;
}

export interface ParticipantTable {
  id: Generated<string>;
  eventId: string;
  email: string;
  // Collected with the selfie; labels their face in the viewer (migration 0005).
  name: Generated<string>;
  selfieKey: string | null;
  selfieEmbedding: string | null;
  galleryTokenHash: Buffer;
  // AES-256-GCM(raw token) — digest emails need the raw token for the link
  galleryTokenEnc: Buffer | null;
  status: Generated<ParticipantStatus>;
  notifiedFirstAt: Timestamp | null;
  lastNotifiedAt: Timestamp | null;
  // First time the tokenized link was opened (migration 0004).
  galleryOpenedAt: Timestamp | null;
  // True once someone has seen the "still processing" page — the only case
  // where a follow-up "your photos are ready" email is worth sending.
  awaitingResultNotice: Generated<boolean>;
  createdAt: CreatedAt;
  updatedAt: GeneratedTimestamp;
  deletedAt: Timestamp | null;
}

export interface ParticipantMatchTable {
  participantId: string;
  assetId: string;
  viaFaceId: string | null;
  distance: number;
  createdAt: CreatedAt;
}

export interface CloudAccountTable {
  id: Generated<string>;
  orgId: string;
  provider: CloudProvider;
  accountEmail: string;
  refreshTokenEnc: Buffer;
  accessTokenEnc: Buffer | null;
  tokenExpiresAt: Timestamp | null;
  scopes: string[];
  createdBy: string | null;
  createdAt: CreatedAt;
  revokedAt: Timestamp | null;
}

export interface ImportJobTable {
  id: Generated<string>;
  eventId: string;
  orgId: string;
  cloudAccountId: string;
  provider: CloudProvider;
  folderRemoteId: string;
  folderName: string;
  recursive: Generated<boolean>;
  status: Generated<ImportJobStatus>;
  totalFiles: Generated<number>;
  doneFiles: Generated<number>;
  skippedFiles: Generated<number>;
  failedFiles: Generated<number>;
  error: string | null;
  createdBy: string | null;
  createdAt: CreatedAt;
  finishedAt: Timestamp | null;
}

export interface ImportItemTable {
  id: Generated<string>;
  importJobId: string;
  eventId: string;
  provider: CloudProvider;
  remoteId: string;
  remoteName: string;
  remoteSize: number | null;
  remoteChecksum: string | null;
  status: Generated<ImportItemStatus>;
  assetId: string | null;
  error: string | null;
  createdAt: CreatedAt;
  updatedAt: GeneratedTimestamp;
}

export interface EmailLogTable {
  id: Generated<string>;
  eventId: string | null;
  participantId: string | null;
  toEmail: string;
  template: EmailTemplate;
  subject: string;
  status: Generated<EmailStatus>;
  messageId: string | null;
  error: string | null;
  createdAt: CreatedAt;
  sentAt: Timestamp | null;
  // When the provider last reported on this message (migration 0006).
  statusAt: Timestamp | null;
}

export interface SystemConfigTable {
  key: string;
  value: unknown;
}

export interface DB {
  user: UserTable;
  session: SessionTable;
  organization: OrganizationTable;
  organizationUser: OrganizationUserTable;
  event: EventTable;
  asset: AssetTable;
  assetFile: AssetFileTable;
  assetExif: AssetExifTable;
  assetFace: AssetFaceTable;
  faceSearch: FaceSearchTable;
  smartSearch: SmartSearchTable;
  person: PersonTable;
  participant: ParticipantTable;
  participantMatch: ParticipantMatchTable;
  cloudAccount: CloudAccountTable;
  importJob: ImportJobTable;
  importItem: ImportItemTable;
  emailLog: EmailLogTable;
  systemConfig: SystemConfigTable;
}

export type User = Selectable<UserTable>;
export type Session = Selectable<SessionTable>;
export type Organization = Selectable<OrganizationTable>;
export type OrganizationUser = Selectable<OrganizationUserTable>;
export type EventRow = Selectable<EventTable>;
export type Asset = Selectable<AssetTable>;
export type AssetFace = Selectable<AssetFaceTable>;
export type Person = Selectable<PersonTable>;
export type Participant = Selectable<ParticipantTable>;

export type NewUser = Insertable<UserTable>;
export type NewOrganization = Insertable<OrganizationTable>;
export type NewEvent = Insertable<EventTable>;
export type UserUpdate = Updateable<UserTable>;
export type EventUpdate = Updateable<EventTable>;
