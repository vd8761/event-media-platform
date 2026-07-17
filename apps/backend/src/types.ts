import { JobName, JobStatus, QueueName, WorkerRole } from 'src/enum';

// Job payloads carry IDs only — never bytes or file paths across machines
// (docs/plan/05-job-orchestration.md).

export interface JobPayloads {
  [JobName.AssetProcess]: { assetId: string };
  [JobName.VideoTranscode]: { assetId: string };
  [JobName.FaceDetect]: { assetId: string };
  [JobName.FaceRecognize]: { faceId: string; deferred?: boolean };
  [JobName.FaceRecognizeQueueAll]: { eventId: string; force?: boolean };
  [JobName.PersonThumbnail]: { personId: string };
  [JobName.SelfieProcess]: { participantId: string };
  [JobName.ImportFolder]: { importJobId: string };
  [JobName.ImportFile]: { importItemId: string };
  [JobName.ParticipantRematch]: { eventId: string };
  [JobName.ParticipantMatchSweep]: Record<string, never>;
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
  [QueueName.FacialRecognition]: WorkerRole.Media,
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
export const QUEUE_CONCURRENCY: Record<QueueName, number> = {
  [QueueName.MediaProcess]: 3,
  [QueueName.VideoTranscode]: 1,
  [QueueName.FaceDetection]: 2,
  [QueueName.FacialRecognition]: 1,
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
  [QueueName.PersonThumbnail]: { attempts: 3, backoffMs: 30_000 },
  [QueueName.Selfie]: { attempts: 3, backoffMs: 30_000 },
  [QueueName.Import]: { attempts: 5, backoffMs: 30_000 },
  [QueueName.Match]: { attempts: 3, backoffMs: 30_000 },
  [QueueName.Notification]: { attempts: 3, backoffMs: 60_000 },
  [QueueName.StorageCleanup]: { attempts: 3, backoffMs: 60_000 },
  [QueueName.Background]: { attempts: 3, backoffMs: 60_000 },
};
