// Ported from immich:server/src/enum.ts — trimmed to the EventLens surface.
// Queue/job catalog is authoritative in docs/plan/05-job-orchestration.md.

export enum WorkerRole {
  Api = 'api',
  Ingest = 'ingest',
  Media = 'media',
}

export enum QueueName {
  // media role (GPU VM)
  MediaProcess = 'mediaProcess',
  VideoTranscode = 'videoTranscode',
  FaceDetection = 'faceDetection',
  FacialRecognition = 'facialRecognition',
  PersonThumbnail = 'personThumbnail',
  Selfie = 'selfie',
  // ingest role (main VM)
  Import = 'import',
  Match = 'match',
  Notification = 'notification',
  StorageCleanup = 'storageCleanup',
  Background = 'background',
}

export enum JobName {
  AssetProcess = 'AssetProcess',
  VideoTranscode = 'VideoTranscode',
  FaceDetect = 'FaceDetect',
  FaceRecognize = 'FaceRecognize',
  FaceRecognizeQueueAll = 'FaceRecognizeQueueAll',
  PersonThumbnail = 'PersonThumbnail',
  SelfieProcess = 'SelfieProcess',
  ImportFolder = 'ImportFolder',
  ImportFile = 'ImportFile',
  ParticipantRematch = 'ParticipantRematch',
  ParticipantMatchSweep = 'ParticipantMatchSweep',
  SendGalleryEmail = 'SendGalleryEmail',
  SendDigest = 'SendDigest',
  SendNoFaceEmail = 'SendNoFaceEmail',
  CleanupKeys = 'CleanupKeys',
  CleanupPrefix = 'CleanupPrefix',
  SelfieRetentionSweep = 'SelfieRetentionSweep',
  StagingSweep = 'StagingSweep',
  SessionCleanup = 'SessionCleanup',
  StorageReconcile = 'StorageReconcile',
  PersonCleanup = 'PersonCleanup',
}

export enum JobStatus {
  Success = 'success',
  Failed = 'failed',
  Skipped = 'skipped',
}

export enum QueueCleanType {
  Failed = 'failed',
}

export enum MetadataKey {
  JobConfig = 'job-config',
  EventConfig = 'event-config',
  AuthRoute = 'auth-route',
}

export enum DatabaseLock {
  Migrations = 210,
  CronJobs = 220,
}

export enum LogLevel {
  Verbose = 'verbose',
  Debug = 'debug',
  Log = 'log',
  Warn = 'warn',
  Error = 'error',
  Fatal = 'fatal',
}

export enum Environment {
  Development = 'development',
  Production = 'production',
}

export enum VectorExtension {
  VectorChord = 'vchord',
  PgVector = 'vector',
}

// --- domain enums (docs/plan/03-database-schema.md) ---

export enum OrgRole {
  Owner = 'owner',
  Admin = 'admin',
  Member = 'member',
}

export enum OrgStatus {
  Active = 'active',
  Suspended = 'suspended',
}

export enum EventStatus {
  Draft = 'draft',
  Active = 'active',
  Closed = 'closed',
}

export enum AssetType {
  Image = 'image',
  Video = 'video',
}

export enum AssetStatus {
  Staged = 'staged',
  Stored = 'stored',
  Processed = 'processed',
  Failed = 'failed',
}

export enum AssetSource {
  Upload = 'upload',
  GDrive = 'gdrive',
  OneDrive = 'onedrive',
}

export enum AssetFileType {
  Preview = 'preview',
  Thumbnail = 'thumbnail',
  EncodedVideo = 'encoded_video',
}

export enum FaceSourceType {
  MachineLearning = 'machine-learning',
}

export enum ParticipantStatus {
  Processing = 'processing',
  NoFace = 'no_face',
  PendingMatch = 'pending_match',
  Matched = 'matched',
}

export enum CloudProvider {
  GDrive = 'gdrive',
  OneDrive = 'onedrive',
}

export enum ImportJobStatus {
  Listing = 'listing',
  Importing = 'importing',
  Done = 'done',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

export enum ImportItemStatus {
  Pending = 'pending',
  Downloading = 'downloading',
  Done = 'done',
  SkippedDuplicate = 'skipped_duplicate',
  Failed = 'failed',
}

export enum EmailTemplate {
  GalleryReady = 'gallery-ready',
  GalleryUpdate = 'gallery-update',
  NoFaceDetected = 'no-face-detected',
}

export enum EmailStatus {
  Queued = 'queued',
  Sent = 'sent',
  Failed = 'failed',
}

export enum SystemConfigKey {
  FacialRecognition = 'facialRecognition',
  Smtp = 'smtp',
}
