import { JobName, JobStatus, QueueName, WorkerRole } from 'src/enum';

// Job payloads carry IDs only — never bytes or file paths across machines
// (docs/plan/05-job-orchestration.md).

export interface JobPayloads {
  [JobName.AssetProcess]: { assetId: string };
  [JobName.VideoTranscode]: { assetId: string };
  [JobName.FaceDetect]: { assetId: string };
  [JobName.FaceRecognize]: { faceId: string; deferred?: boolean };
  [JobName.FaceRecognizeQueueAll]: { eventId: string; force?: boolean };
  [JobName.SmartSearch]: { assetId: string };
  [JobName.SmartSearchQueueAll]: { eventId: string; force?: boolean };
  [JobName.PersonThumbnail]: { personId: string };
  [JobName.SelfieProcess]: { participantId: string };
  [JobName.ImportFolder]: { importJobId: string };
  [JobName.ImportFile]: { importItemId: string };
  [JobName.ParticipantRematch]: { eventId: string };
  [JobName.ParticipantMatchSweep]: Record<string, never>;
  [JobName.SendSelfieReceived]: { participantId: string };
  [JobName.SendGalleryEmail]: { participantId: string };
  [JobName.SendDigest]: { participantId: string };
  [JobName.SendNoFaceEmail]: { participantId: string };
  [JobName.CleanupKeys]: { keys: string[] };
  [JobName.CleanupPrefix]: { prefix: string };
  [JobName.SelfieRetentionSweep]: Record<string, never>;
  [JobName.StagingSweep]: Record<string, never>;
  [JobName.SessionCleanup]: Record<string, never>;
  [JobName.StorageReconcile]: Record<string, never>;
  [JobName.PersonCleanup]: Record<string, never>;
  [JobName.PersonNameBackfill]: Record<string, never>;
  [JobName.SendEventExpiry]: { eventId: string };
  [JobName.EventExpirySweep]: Record<string, never>;
  [JobName.EventPurgeSweep]: Record<string, never>;
  [JobName.GpuLifecycleSweep]: Record<string, never>;
  [JobName.AuditRetentionSweep]: Record<string, never>;
}

export type JobItem = {
  [N in JobName]: JobPayloads[N] extends Record<string, never>
    ? { name: N; data?: JobPayloads[N] }
    : { name: N; data: JobPayloads[N] };
}[JobName];

export type JobOf<N extends JobName> = JobPayloads[N];

export type JobHandler = (data: any) => Promise<JobStatus>;

export interface JobCounts {
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  waiting: number;
  paused: number;
}

// Which process role consumes each queue (docs/plan/01-architecture.md §1).
export const QUEUE_ROLES: Record<QueueName, WorkerRole.Ingest | WorkerRole.Media> = {
  [QueueName.MediaProcess]: WorkerRole.Media,
  [QueueName.VideoTranscode]: WorkerRole.Media,
  [QueueName.FaceDetection]: WorkerRole.Media,
  // Ingest, not Media, despite the name: clustering never calls the ML sidecar.
  // It is a pgvector KNN loop against the database, so running it on the GPU
  // box meant every query crossed a region (Noida -> Singapore) at concurrency
  // 1, holding the GPU at idle while a queue backed up behind it. On the API
  // host it sits next to Neon. This also drops it from GPU_QUEUES, so a
  // database-bound backlog no longer keeps a GPU billing.
  //
  // Still exactly one consumer fleet-wide (risk R1): the API service must stay
  // at a single instance, or concurrent clustering creates duplicate persons.
  [QueueName.FacialRecognition]: WorkerRole.Ingest,
  [QueueName.SmartSearch]: WorkerRole.Media,
  [QueueName.PersonThumbnail]: WorkerRole.Media,
  [QueueName.Selfie]: WorkerRole.Media,
  [QueueName.Import]: WorkerRole.Ingest,
  [QueueName.Match]: WorkerRole.Ingest,
  [QueueName.Notification]: WorkerRole.Ingest,
  [QueueName.StorageCleanup]: WorkerRole.Ingest,
  [QueueName.Background]: WorkerRole.Ingest,
};

// Per-queue consumer concurrency (docs/plan/05-job-orchestration.md §1).
// facialRecognition MUST stay 1 — and globally single-consumer: every
// additional GPU VM sets EL_QUEUES_EXCLUDE=facialRecognition (risk R1).
// Sized against what each job actually spends its time on, not against cores.
//
// The GPU jobs are overwhelmingly I/O: a faceDetection job makes six database
// round trips and an R2 download around a single inference call. Against a
// database in another region that is roughly 400ms of waiting per ~100ms of
// GPU, so at low concurrency the card sits idle between jobs. Overlapping more
// jobs is what keeps it fed — the limit is the connection pool (DB_POOL_MAX),
// not the GPU.
export const QUEUE_CONCURRENCY: Record<QueueName, number> = {
  [QueueName.MediaProcess]: 4,
  // Serial on purpose: ffmpeg already saturates what it is given, and running
  // several transcodes at once only makes each slower.
  [QueueName.VideoTranscode]: 1,
  [QueueName.FaceDetection]: 6,
  [QueueName.FacialRecognition]: 1,
  [QueueName.SmartSearch]: 2,
  [QueueName.PersonThumbnail]: 2,
  [QueueName.Selfie]: 2,
  [QueueName.Import]: 4,
  [QueueName.Match]: 1,
  [QueueName.Notification]: 2,
  [QueueName.StorageCleanup]: 2,
  [QueueName.Background]: 2,
};

// Retry policy per queue (docs/plan/05-job-orchestration.md §5).
export const QUEUE_RETRY: Record<QueueName, { attempts: number; backoffMs: number }> = {
  [QueueName.MediaProcess]: { attempts: 3, backoffMs: 30_000 },
  [QueueName.VideoTranscode]: { attempts: 3, backoffMs: 30_000 },
  [QueueName.FaceDetection]: { attempts: 3, backoffMs: 30_000 },
  [QueueName.FacialRecognition]: { attempts: 3, backoffMs: 10_000 },
  [QueueName.SmartSearch]: { attempts: 3, backoffMs: 30_000 },
  [QueueName.PersonThumbnail]: { attempts: 3, backoffMs: 30_000 },
  [QueueName.Selfie]: { attempts: 3, backoffMs: 30_000 },
  [QueueName.Import]: { attempts: 5, backoffMs: 30_000 },
  [QueueName.Match]: { attempts: 3, backoffMs: 30_000 },
  [QueueName.Notification]: { attempts: 3, backoffMs: 60_000 },
  [QueueName.StorageCleanup]: { attempts: 3, backoffMs: 60_000 },
  [QueueName.Background]: { attempts: 3, backoffMs: 60_000 },
};
