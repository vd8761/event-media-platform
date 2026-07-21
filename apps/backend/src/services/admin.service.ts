// Super-admin platform surface: stats + BullMQ queue dashboard
// (docs/plan/09-api-surface.md §Super admin; Immich queue-status pattern).
import { BadRequestException, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { arch, cpus, freemem, platform, totalmem, uptime } from 'node:os';
import { AuditCategory, AuditLevel, JobName, QueueCleanType, QueueName, SystemConfigKey, WorkerRole } from 'src/enum';
import {
  EventRetentionConfig,
  GpuAutostartConfig,
  SystemConfigRepository,
} from 'src/repositories/system-config.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { AuditLogService } from 'src/services/audit-log.service';
import { JobRepository } from 'src/repositories/job.repository';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository';
import { sampleCpuPercent, TelemetryRepository } from 'src/repositories/telemetry.repository';
import { DB } from 'src/schema';
import { JobCounts, QUEUE_CONCURRENCY, QUEUE_ROLES } from 'src/types';

export type QueueAction = 'pause' | 'resume' | 'clear-failed' | 'retry-failed' | 'empty' | 'kill-active';

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
  [QueueName.SmartSearch]: {
    label: 'Smart search',
    description: 'Computes a CLIP visual embedding for each photo, powering "view similar photos".',
    jobs: [JobName.SmartSearch, JobName.SmartSearchQueueAll],
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

@Injectable()
export class AdminService {
  constructor(
    @InjectKysely() private db: Kysely<DB>,
    private auditLogService: AuditLogService,
    private configRepository: ConfigRepository,
    private jobRepository: JobRepository,
    private machineLearningRepository: MachineLearningRepository,
    private systemConfigRepository: SystemConfigRepository,
    private telemetryRepository: TelemetryRepository,
  ) {}

  // Platform totals plus a per-organization breakdown. Deliberately counts
  // only: a super admin administers organizations but cannot see inside their
  // events, so no event name, asset or person ever appears here — just how
  // many of each an org holds.
  async getStats() {
    // `organizations` stays the platform total; the per-org rows live under
    // their own key so the two never get confused.
    const [totals, byOrganization] = await Promise.all([
      this.getTotals(),
      this.getOrganizationBreakdown(),
    ]);
    return { ...totals, byOrganization };
  }

  private async getTotals() {
    const [row] = await this.db
      .selectNoFrom((eb) => [
        eb.selectFrom('organization').where('deletedAt', 'is', null).select(sql<number>`count(*)::int`.as('count')).as('organizations'),
        eb.selectFrom('user').where('deletedAt', 'is', null).select(sql<number>`count(*)::int`.as('count')).as('users'),
        eb.selectFrom('event').where('deletedAt', 'is', null).select(sql<number>`count(*)::int`.as('count')).as('events'),
        eb.selectFrom('asset').where('deletedAt', 'is', null).select(sql<number>`count(*)::int`.as('count')).as('assets'),
        eb.selectFrom('asset').where('deletedAt', 'is', null).select(sql<number>`coalesce(sum(file_size), 0)::bigint`.as('sum')).as('storageBytes'),
        eb.selectFrom('person').select(sql<number>`count(*)::int`.as('count')).as('people'),
        // Joined through event so this matches the per-organization rows
        // below: a participant whose event was deleted has no gallery left,
        // and counting them here would make the column stop adding up.
        eb
          .selectFrom('participant')
          .innerJoin('event', 'event.id', 'participant.eventId')
          .where('participant.deletedAt', 'is', null)
          .where('event.deletedAt', 'is', null)
          .select(sql<number>`count(*)::int`.as('count'))
          .as('participants'),
      ])
      .execute();
    return row;
  }

  // Correlated scalar subqueries rather than joins: joining events, assets,
  // people and participants in one pass would multiply the counts together.
  private async getOrganizationBreakdown() {
    const rows = await this.db
      .selectFrom('organization')
      .where('organization.deletedAt', 'is', null)
      .select((eb) => [
        'organization.id as orgId',
        'organization.name as name',
        'organization.slug as slug',
        eb
          .selectFrom('event')
          .whereRef('event.orgId', '=', 'organization.id')
          .where('event.deletedAt', 'is', null)
          .select(sql<number>`count(*)::int`.as('value'))
          .as('eventCount'),
        eb
          .selectFrom('asset')
          .whereRef('asset.orgId', '=', 'organization.id')
          .where('asset.deletedAt', 'is', null)
          .select(sql<number>`count(*)::int`.as('value'))
          .as('assetCount'),
        eb
          .selectFrom('asset')
          .whereRef('asset.orgId', '=', 'organization.id')
          .where('asset.deletedAt', 'is', null)
          .select(sql<number>`coalesce(sum(file_size), 0)::bigint`.as('value'))
          .as('storageBytes'),
        eb
          .selectFrom('person')
          .whereRef('person.orgId', '=', 'organization.id')
          .select(sql<number>`count(*)::int`.as('value'))
          .as('personCount'),
        eb
          .selectFrom('participant')
          .innerJoin('event', 'event.id', 'participant.eventId')
          .whereRef('event.orgId', '=', 'organization.id')
          .where('participant.deletedAt', 'is', null)
          .where('event.deletedAt', 'is', null)
          .select(sql<number>`count(*)::int`.as('value'))
          .as('participantCount'),
      ])
      .orderBy('organization.name')
      .execute();

    // A subquery over zero rows types as nullable; flatten to 0 so the API
    // contract is plain numbers.
    return rows.map((row) => {
      const eventCount = row.eventCount ?? 0;
      const personCount = row.personCount ?? 0;
      return {
        orgId: row.orgId,
        name: row.name,
        slug: row.slug,
        eventCount,
        personCount,
        assetCount: row.assetCount ?? 0,
        storageBytes: Number(row.storageBytes ?? 0),
        participantCount: row.participantCount ?? 0,
        // "people per event" as an average — a per-event list would leak which
        // events exist and how big each one is.
        personsPerEvent: eventCount > 0 ? Math.round((personCount / eventCount) * 10) / 10 : 0,
      };
    });
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

  // Host + sidecar health for the "system status" card.
  //
  // `instances` is every process currently heartbeating into Redis, which is
  // how the GPU box's CPU/GPU figures reach an API running on another machine
  // — os.cpus() here would only ever describe the API's own container.
  async getSystemStatus() {
    const env = this.configRepository.getEnv();

    // Only probe ML from a process that actually calls it.
    //
    // The API host runs `api,ingest` and never does inference — that belongs to
    // the `media` role on the GPU box, which reaches its sidecar over a compose
    // network the API is not on. Pinging `http://ml:3003` from Render therefore
    // fails by design, and reporting that as "unreachable" on the dashboard is
    // a permanent red light on a perfectly healthy deployment. It is the kind
    // of false alarm that trains people to ignore the panel.
    const usesMachineLearning =
      env.workers.includes(WorkerRole.Media) || env.includedQueues.includes(QueueName.Selfie);

    const [cpuPercent, mlServers, instances] = await Promise.all([
      sampleCpuPercent(),
      usesMachineLearning ? this.machineLearningRepository.getServerStatus() : Promise.resolve([]),
      this.telemetryRepository.getInstances().catch(() => []),
    ]);

    const memoryTotal = totalmem();
    const memoryFree = freemem();
    const cores = cpus();

    return {
      machineLearning: {
        device: env.machineLearning.device,
        deviceIsConfigured: true,
        // False on the API host: the panel then says so rather than showing a
        // failed health check for an endpoint this process is not meant to use.
        usedByThisProcess: usesMachineLearning,
        servers: mlServers,
      },
      // The API's own host, measured directly — kept so the panel still shows
      // something if Redis telemetry is unavailable.
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
      instances,
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

  // Merge-on-write: the panel sends only the fields it changed, so a partial
  // save must not blank the rest of the config.
  async updateGpuAutostart(dto: Partial<GpuAutostartConfig>): Promise<GpuAutostartConfig> {
    const current = await this.systemConfigRepository.getGpuAutostartConfig();
    const next = { ...current, ...dto };
    await this.systemConfigRepository.set(SystemConfigKey.GpuAutostart, next);
    return next;
  }

  async updateEventRetention(dto: Partial<EventRetentionConfig>): Promise<EventRetentionConfig> {
    const current = await this.systemConfigRepository.getEventRetentionConfig();
    const next = { ...current, ...dto };
    await this.systemConfigRepository.set(SystemConfigKey.EventRetention, next);
    return next;
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
      case 'kill-active': {
        const killed = await this.jobRepository.killActive(queue);
        await this.auditLogService.record({
          category: AuditCategory.Job,
          action: 'queue.kill-active',
          level: AuditLevel.Warning,
          message: `Terminated ${killed} active job(s) on ${queue}`,
          detail: { queue, killed },
        });
        break;
      }
      default: {
        throw new BadRequestException(`Unknown action: ${action}`);
      }
    }
  }
}
