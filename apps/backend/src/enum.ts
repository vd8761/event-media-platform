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
  SmartSearch = 'smartSearch',
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
  SmartSearch = 'SmartSearch',
  SmartSearchQueueAll = 'SmartSearchQueueAll',
  PersonThumbnail = 'PersonThumbnail',
  SelfieProcess = 'SelfieProcess',
  ImportFolder = 'ImportFolder',
  ImportFile = 'ImportFile',
  ParticipantRematch = 'ParticipantRematch',
  ParticipantMatchSweep = 'ParticipantMatchSweep',
  SendSelfieReceived = 'SendSelfieReceived',
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
  SendEventExpiry = 'SendEventExpiry',
  EventExpirySweep = 'EventExpirySweep',
  EventPurgeSweep = 'EventPurgeSweep',
  GpuLifecycleSweep = 'GpuLifecycleSweep',
  AuditRetentionSweep = 'AuditRetentionSweep',
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

// --- audit log (migration 0012) ---

// How long a row survives. Chosen per-event at write time and then fixed:
// reclassifying a category later must not retroactively delete or preserve
// history written under the old policy.
export enum AuditRetention {
  // Verbose traces worth having while something is happening and worthless
  // tomorrow. Swept at the end of the day they were written.
  SameDay = 'same_day',
  // Operational history: what the GPU did and why, failures, deliveries.
  ThirtyDays = 'thirty_days',
  // Anything a real audit needs to answer months later — who deleted what,
  // who was granted access. Only a deliberate manual flush removes these.
  Never = 'never',
}

export enum AuditLevel {
  Info = 'info',
  Warning = 'warning',
  Error = 'error',
}

export enum AuditCategory {
  // GPU box lifecycle: every start and stop with its reason, plus the
  // failures — a provider call that errored is exactly as interesting as one
  // that worked, and is the thing that costs money when missed.
  Gpu = 'gpu',
  Job = 'job',
  Auth = 'auth',
  Organization = 'organization',
  Event = 'event',
  Retention = 'retention',
  System = 'system',
}

// Default class per category. Security-relevant categories are kept forever
// because "when was this deleted, and by whom" is the question an audit log
// exists to answer, and a 30-day window answers it only by luck.
export const AUDIT_DEFAULT_RETENTION: Record<AuditCategory, AuditRetention> = {
  [AuditCategory.Auth]: AuditRetention.Never,
  [AuditCategory.Organization]: AuditRetention.Never,
  [AuditCategory.Event]: AuditRetention.Never,
  [AuditCategory.Retention]: AuditRetention.Never,
  [AuditCategory.Gpu]: AuditRetention.ThirtyDays,
  [AuditCategory.Job]: AuditRetention.ThirtyDays,
  [AuditCategory.System]: AuditRetention.SameDay,
};

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
  SelfieReceived = 'selfie-received',
  GalleryReady = 'gallery-ready',
  GalleryUpdate = 'gallery-update',
  NoFaceDetected = 'no-face-detected',
  // Organizer-facing, unlike the four above.
  EventExpired = 'event-expired',
}

// queued → sent (provider accepted) → delivered | bounced | complained.
// The terminal three only arrive if the Resend webhook is configured;
// `failed` means we could not hand the message over at all.
export enum EmailStatus {
  Queued = 'queued',
  Sent = 'sent',
  Delivered = 'delivered',
  Bounced = 'bounced',
  Complained = 'complained',
  Failed = 'failed',
}

// Where a support message came from. `organization` messages have a signed-in
// organiser behind them; `public` ones come from a guest page and are
// self-identified at best.
export enum SupportSource {
  Organization = 'organization',
  Public = 'public',
}

export enum SupportStatus {
  Open = 'open',
  Resolved = 'resolved',
}

export enum SystemConfigKey {
  FacialRecognition = 'facialRecognition',
  Smtp = 'smtp',
  // How long expired events keep their media before it is purged from R2.
  EventRetention = 'eventRetention',
  // When the GPU box should be woken, and how it is started/stopped.
  GpuAutostart = 'gpuAutostart',
  // Mutable lifecycle state for that box — written by the sweep, not by hand.
  GpuLifecycle = 'gpuLifecycle',
}
