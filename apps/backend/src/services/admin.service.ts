// Super-admin platform surface: stats + BullMQ queue dashboard
// (docs/plan/09-api-surface.md §Super admin; Immich queue-status pattern).
import { BadRequestException, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { arch, cpus, freemem, platform, totalmem, uptime } from 'node:os';
import { JobName, QueueCleanType, QueueName } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository';
import { DB } from 'src/schema';
import { JobCounts, QUEUE_CONCURRENCY, QUEUE_ROLES } from 'src/types';

export type QueueAction = 'pause' | 'resume' | 'clear-failed' | 'retry-failed' | 'empty';

// Operator-facing copy for the jobs page — mirrors Immich's job descriptions.
const QUEUE_INFO: Record<QueueName, { label: string; description: string; jobs: JobName[] }> = {
  [QueueName.MediaProcess]: {
    label: 'Media processing',
    description: 'Generates the preview, thumbnail and thumbhash for every uploaded photo.',
    jobs: [JobName.AssetProcess],
  },
  [QueueName.VideoTranscode]: {
    label: 'Video transcoding',
    description: 'Re-encodes uploaded video to a web-playable H.264 MP4.',
    jobs: [JobName.VideoTranscode],
  },
  [QueueName.FaceDetection]: {
    label: 'Face detection',
    description: 'Runs RetinaFace + ArcFace over each photo to find faces and compute embeddings.',
    jobs: [JobName.FaceDetect],
  },
  [QueueName.FacialRecognition]: {
    label: 'Facial recognition',
    description: 'Clusters detected faces into people. Runs single-threaded so clusters stay unique.',
    jobs: [JobName.FaceRecognize, JobName.FaceRecognizeQueueAll],
  },
  [QueueName.PersonThumbnail]: {
    label: 'Person thumbnails',
    description: 'Crops the cover portrait shown for each detected person.',
    jobs: [JobName.PersonThumbnail],
  },
  [QueueName.Selfie]: {
    label: 'Selfie processing',
    description: 'Embeds participant selfies submitted through the public event page.',
    jobs: [JobName.SelfieProcess],
  },
  [QueueName.Import]: {
    label: 'Cloud import',
    description: 'Lists and downloads media from connected Google Drive / OneDrive folders.',
    jobs: [JobName.ImportFolder, JobName.ImportFile],
  },
  [QueueName.Match]: {
    label: 'Participant matching',
    description: 'Matches participant selfies against event faces and updates their galleries.',
    jobs: [JobName.ParticipantRematch, JobName.ParticipantMatchSweep],
  },
  [QueueName.Notification]: {
    label: 'Email delivery',
    description: 'Sends gallery-ready, gallery-update and no-face-detected emails.',
    jobs: [JobName.SendGalleryEmail, JobName.SendDigest, JobName.SendNoFaceEmail],
  },
  [QueueName.StorageCleanup]: {
    label: 'Storage cleanup',
    description: 'Deletes objects from R2 for removed assets, events and expired selfies.',
    jobs: [JobName.CleanupKeys, JobName.CleanupPrefix, JobName.SelfieRetentionSweep],
  },
  [QueueName.Background]: {
    label: 'Maintenance',
    description: 'Nightly staging sweep, session cleanup, storage reconciliation and person cleanup.',
    jobs: [JobName.StagingSweep, JobName.SessionCleanup, JobName.StorageReconcile, JobName.PersonCleanup],
  },
};

// Sample the CPU counters twice so the reported figure is a real utilisation
// percentage rather than an average since boot.
async function sampleCpuPercent(windowMs = 250): Promise<number> {
  const snapshot = () => {
    let idle = 0;
    let total = 0;
    for (const cpu of cpus()) {
      for (const value of Object.values(cpu.times)) {
        total += value;
      }
      idle += cpu.times.idle;
    }
    return { idle, total };
  };

  const first = snapshot();
  await new Promise((resolve) => setTimeout(resolve, windowMs));
  const second = snapshot();

  const totalDelta = second.total - first.total;
  const idleDelta = second.idle - first.idle;
  if (totalDelta <= 0) {
    return 0;
  }
  return Math.round((1 - idleDelta / totalDelta) * 1000) / 10;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectKysely() private db: Kysely<DB>,
    private configRepository: ConfigRepository,
    private jobRepository: JobRepository,
    private machineLearningRepository: MachineLearningRepository,
  ) {}

  async getStats() {
    const [row] = await this.db
      .selectNoFrom((eb) => [
        eb.selectFrom('organization').where('deletedAt', 'is', null).select(sql<number>`count(*)::int`.as('count')).as('organizations'),
        eb.selectFrom('user').where('deletedAt', 'is', null).select(sql<number>`count(*)::int`.as('count')).as('users'),
        eb.selectFrom('event').where('deletedAt', 'is', null).select(sql<number>`count(*)::int`.as('count')).as('events'),
        eb.selectFrom('asset').where('deletedAt', 'is', null).select(sql<number>`count(*)::int`.as('count')).as('assets'),
        eb.selectFrom('asset').where('deletedAt', 'is', null).select(sql<number>`coalesce(sum(file_size), 0)::bigint`.as('sum')).as('storageBytes'),
        eb.selectFrom('participant').where('deletedAt', 'is', null).select(sql<number>`count(*)::int`.as('count')).as('participants'),
      ])
      .execute();
    return row;
  }

  async getQueues(): Promise<Record<string, JobCounts & { isPaused: boolean }>> {
    const result: Record<string, JobCounts & { isPaused: boolean }> = {};
    await Promise.all(
      Object.values(QueueName).map(async (name) => {
        const [counts, isPaused] = await Promise.all([
          this.jobRepository.getJobCounts(name),
          this.jobRepository.isPaused(name),
        ]);
        result[name] = { ...counts, isPaused };
      }),
    );
    return result;
  }

  // Everything the jobs page needs in one poll: counts, whether the queue is
  // paused, what it is working on right now, and recent throughput.
  async getJobs() {
    const queues = await Promise.all(
      Object.values(QueueName).map(async (name) => {
        const [counts, isPaused, metrics, active] = await Promise.all([
          this.jobRepository.getJobCounts(name),
          this.jobRepository.isPaused(name),
          this.jobRepository.getQueueMetrics(name),
          this.jobRepository.getActiveJobs(name),
        ]);

        // metrics.data is newest-first, one bucket per minute; bucket 0 is the
        // current (still filling) minute, so rate uses the completed buckets.
        const recent = metrics.completed.slice(1, 6);
        const perMinute = recent.length > 0 ? recent.reduce((sum, value) => sum + value, 0) / recent.length : 0;
        const pending = counts.waiting + counts.active + counts.delayed + counts.paused;

        return {
          name,
          ...QUEUE_INFO[name],
          role: QUEUE_ROLES[name],
          concurrency: QUEUE_CONCURRENCY[name],
          isPaused,
          counts,
          pending,
          ratePerMinute: Math.round(perMinute * 10) / 10,
          // null when idle or stalled — the UI must not render a fake ETA
          etaSeconds: pending > 0 && perMinute > 0 ? Math.round((pending / perMinute) * 60) : null,
          history: metrics.completed,
          active,
        };
      }),
    );

    return { queues };
  }

  async getFailedJobs(name: string) {
    if (!Object.values(QueueName).includes(name as QueueName)) {
      throw new BadRequestException(`Unknown queue: ${name}`);
    }
    return this.jobRepository.getFailedJobs(name as QueueName);
  }

  // Host + sidecar health for the "system status" card. Everything here is
  // measured except machineLearning.device, which is reported from config.
  async getSystemStatus() {
    const env = this.configRepository.getEnv();
    const [cpuPercent, mlServers] = await Promise.all([
      sampleCpuPercent(),
      this.machineLearningRepository.getServerStatus(),
    ]);

    const memoryTotal = totalmem();
    const memoryFree = freemem();
    const cores = cpus();

    return {
      machineLearning: {
        device: env.machineLearning.device,
        deviceIsConfigured: true,
        servers: mlServers,
      },
      host: {
        platform: platform(),
        arch: arch(),
        cpuModel: cores[0]?.model?.trim() ?? 'unknown',
        cpuCount: cores.length,
        cpuPercent,
        memoryTotal,
        memoryUsed: memoryTotal - memoryFree,
        uptimeSeconds: Math.round(uptime()),
      },
      process: {
        uptimeSeconds: Math.round(process.uptime()),
        rssBytes: process.memoryUsage().rss,
        heapUsedBytes: process.memoryUsage().heapUsed,
        nodeVersion: process.version,
        workers: env.workers,
        excludedQueues: env.excludedQueues,
      },
      database: {
        vectorExtension: env.database.vectorExtension,
        version: await this.getDatabaseVersion(),
      },
    };
  }

  private async getDatabaseVersion(): Promise<string> {
    try {
      const [row] = await sql<{ version: string }>`SELECT version()`.execute(this.db).then((r) => r.rows);
      // "PostgreSQL 14.13 (Debian …) on x86_64…" → "PostgreSQL 14.13"
      return row.version.split(' ').slice(0, 2).join(' ');
    } catch {
      return 'unavailable';
    }
  }

  async runQueueAction(name: string, action: QueueAction): Promise<void> {
    if (!Object.values(QueueName).includes(name as QueueName)) {
      throw new BadRequestException(`Unknown queue: ${name}`);
    }
    const queue = name as QueueName;

    switch (action) {
      case 'pause': {
        await this.jobRepository.pause(queue);
        break;
      }
      case 'resume': {
        await this.jobRepository.resume(queue);
        break;
      }
      case 'clear-failed': {
        await this.jobRepository.clear(queue, QueueCleanType.Failed);
        break;
      }
      case 'retry-failed': {
        await this.jobRepository.retryFailed(queue);
        break;
      }
      case 'empty': {
        await this.jobRepository.empty(queue);
        break;
      }
      default: {
        throw new BadRequestException(`Unknown action: ${action}`);
      }
    }
  }
}
