// Ported from immich:server/src/repositories/job.repository.ts. Keeps the
// @OnJob handler registry, the startup handler-completeness check, and
// queue/queueAll. EventLens changes (docs/plan/01-architecture.md §1):
//   - startWorkers() starts only queues whose QUEUE_ROLES entry matches the
//     process roles, minus EL_QUEUES_EXCLUDE (multi-GPU scale-out, risk R1)
//   - workers run handlers directly (no event-repository indirection) with
//     per-queue concurrency + retry policy from src/types.ts
import { getQueueToken } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import { JobsOptions, MetricsTime, Queue, Worker } from 'bullmq';
import { setTimeout } from 'node:timers/promises';
import { JobConfig } from 'src/decorators';
import { JobName, JobStatus, MetadataKey, QueueCleanType, QueueName } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { JobCounts, JobItem, QUEUE_CONCURRENCY, QUEUE_RETRY, QUEUE_ROLES } from 'src/types';
import { getKeyByValue, getMethodNames, StartupError } from 'src/utils/misc';

type JobMapItem = {
  jobName: JobName;
  queueName: QueueName;
  handler: (job: any) => Promise<JobStatus>;
  label: string;
};

@Injectable()
export class JobRepository {
  private workers: Partial<Record<QueueName, Worker>> = {};
  private handlers: Partial<Record<JobName, JobMapItem>> = {};

  constructor(
    private moduleRef: ModuleRef,
    private configRepository: ConfigRepository,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(JobRepository.name);
  }

  setup(services: (new (...args: any[]) => unknown)[]) {
    const reflector = this.moduleRef.get(Reflector, { strict: false });

    // discovery
    for (const Service of services) {
      const instance = this.moduleRef.get<any>(Service);
      for (const methodName of getMethodNames(instance)) {
        const handler = instance[methodName];
        const config = reflector.get<JobConfig>(MetadataKey.JobConfig, handler);
        if (!config) {
          continue;
        }

        const { name: jobName, queue: queueName } = config;
        const label = `${Service.name}.${handler.name}`;

        // one handler per job
        if (this.handlers[jobName]) {
          const jobKey = getKeyByValue(JobName, jobName);
          const errorMessage = `Failed to add job handler for ${label}`;
          this.logger.error(
            `${errorMessage}. JobName.${jobKey} is already handled by ${this.handlers[jobName].label}.`,
          );
          throw new StartupError(errorMessage);
        }

        this.handlers[jobName] = {
          label,
          jobName,
          queueName,
          handler: handler.bind(instance),
        };

        this.logger.verbose(`Added job handler: ${jobName} => ${label}`);
      }
    }

    // no missing handlers
    for (const [jobKey, jobName] of Object.entries(JobName)) {
      const item = this.handlers[jobName];
      if (!item) {
        const errorMessage = `Failed to find job handler for Job.${jobKey} ("${jobName}")`;
        this.logger.error(
          `${errorMessage}. Make sure to add the @OnJob({ name: JobName.${jobKey}, queue: QueueName.XYZ }) decorator for the new job.`,
        );
        throw new StartupError(errorMessage);
      }
    }
  }

  startWorkers() {
    const { bull, workers, excludedQueues, includedQueues } = this.configRepository.getEnv();
    for (const queueName of Object.values(QueueName)) {
      // A queue runs when this process holds its role, or when the deployment
      // explicitly opted in via EL_QUEUES_INCLUDE (e.g. `selfie` on the API
      // host, so participant intake does not wait on the GPU box).
      const ownsRole = workers.includes(QUEUE_ROLES[queueName]);
      const optedIn = includedQueues.includes(queueName);
      if (!ownsRole && !optedIn) {
        continue;
      }
      // Exclude always wins — it is what keeps facialRecognition to exactly
      // one consumer across the fleet.
      if (excludedQueues.includes(queueName)) {
        this.logger.log(`Skipping queue (EL_QUEUES_EXCLUDE): ${queueName}`);
        continue;
      }
      if (optedIn && !ownsRole) {
        this.logger.log(`Starting out-of-role queue (EL_QUEUES_INCLUDE): ${queueName}`);
      }
      this.logger.debug(`Starting worker for queue: ${queueName}`);
      const worker = new Worker(queueName, (job) => this.run(job as JobItem), {
        ...bull.config,
        concurrency: QUEUE_CONCURRENCY[queueName],
        // per-minute completed/failed counters kept in Redis, so the API
        // process can read throughput for queues it does not itself run
        metrics: { maxDataPoints: MetricsTime.ONE_HOUR * 2 },
      });
      // surface queue-level problems — BullMQ is silent about these by default
      worker.on('failed', (job, error) => {
        this.logger.error(`Job failed [${queueName}/${job?.name}] ${JSON.stringify(job?.data)}: ${error.message}`);
      });
      worker.on('stalled', (jobId) => {
        this.logger.warn(`Job stalled and will be retried [${queueName}] id=${jobId}`);
      });
      worker.on('error', (error) => {
        this.logger.error(`Worker error [${queueName}]: ${error.message}`);
      });
      this.workers[queueName] = worker;
    }
  }

  // Cron schedule (docs/plan/05-job-orchestration.md §6) via BullMQ job
  // schedulers — upserts are idempotent, so every ingest process may register.
  async registerCronSchedules() {
    const crons: { queue: QueueName; name: JobName; pattern: string }[] = [
      { queue: QueueName.Match, name: JobName.ParticipantMatchSweep, pattern: '*/15 * * * *' },
      { queue: QueueName.Background, name: JobName.StagingSweep, pattern: '0 * * * *' },
      { queue: QueueName.StorageCleanup, name: JobName.SelfieRetentionSweep, pattern: '30 2 * * *' },
      { queue: QueueName.Background, name: JobName.StorageReconcile, pattern: '0 3 * * *' },
      { queue: QueueName.Background, name: JobName.SessionCleanup, pattern: '30 3 * * *' },
      { queue: QueueName.Background, name: JobName.PersonCleanup, pattern: '0 4 * * *' },
      // Hourly: close expired events and tell their owners. Deliberately more
      // frequent than the purge — the notification is the useful half.
      { queue: QueueName.Background, name: JobName.EventExpirySweep, pattern: '5 * * * *' },
      // Daily, well after the expiry sweep so the grace period is honoured.
      { queue: QueueName.StorageCleanup, name: JobName.EventPurgeSweep, pattern: '0 5 * * *' },
      { queue: QueueName.StorageCleanup, name: JobName.AuditRetentionSweep, pattern: '10 4 * * *' },
      // Frequent: this is what decides whether the GPU box wakes or shuts down,
      // so its resolution is the worst-case delay on both.
      { queue: QueueName.Background, name: JobName.GpuLifecycleSweep, pattern: '*/2 * * * *' },
    ];

    for (const { queue, name, pattern } of crons) {
      await this.getQueue(queue).upsertJobScheduler(`cron-${name}`, { pattern }, { name, data: {} });
    }
    this.logger.log(`Registered ${crons.length} cron schedules`);
  }

  async teardown() {
    await Promise.all(Object.values(this.workers).map((worker) => worker.close()));
    this.workers = {};
  }

  async run({ name, data }: { name: string; data?: any }): Promise<JobStatus> {
    const item = this.handlers[name as JobName];
    if (!item) {
      this.logger.warn(`Skipping unknown job: "${name}"`);
      return JobStatus.Skipped;
    }

    const status = await item.handler(data);
    if (status === JobStatus.Failed) {
      // surface handler-reported failure to BullMQ so retry/backoff applies
      throw new Error(`Job failed: ${name}`);
    }
    return status;
  }

  async isActive(name: QueueName): Promise<boolean> {
    const count = await this.getQueue(name).getActiveCount();
    return count > 0;
  }

  async isPaused(name: QueueName): Promise<boolean> {
    return this.getQueue(name).isPaused();
  }

  pause(name: QueueName) {
    return this.getQueue(name).pause();
  }

  resume(name: QueueName) {
    return this.getQueue(name).resume();
  }

  empty(name: QueueName) {
    return this.getQueue(name).drain();
  }

  clear(name: QueueName, type: QueueCleanType) {
    return this.getQueue(name).clean(0, 1000, type);
  }

  async retryFailed(name: QueueName) {
    const queue = this.getQueue(name);
    const jobs = await queue.getFailed();
    await Promise.all(jobs.map((job) => job.retry()));
  }

  // Enqueue time of the longest-waiting job, or undefined when nothing is
  // waiting. Drives the "one job has been stuck for two hours" wake-up, which
  // the depth threshold alone would never trigger.
  async getOldestWaitingTimestamp(name: QueueName): Promise<number | undefined> {
    // BullMQ returns waiting jobs oldest-first, so one entry is enough.
    const [job] = await this.getQueue(name).getJobs(['waiting'], 0, 0, true);
    return job?.timestamp;
  }

  // Where a specific job sits in the waiting list, 1-based, or null when it is
  // not waiting — which means it is already running, finished, or failed. Used
  // to tell a guest "you're 4th in line" while they watch the page.
  //
  // Scans oldest-first and stops at `limit`: past that depth we do not offer a
  // live position anyway, so reading the whole list would be wasted work on a
  // queue that can hold thousands during an import.
  async getWaitingPosition(
    name: QueueName,
    match: (data: any) => boolean,
    limit = 100,
  ): Promise<number | null> {
    const jobs = await this.getQueue(name).getJobs(['waiting'], 0, limit - 1, true);
    const index = jobs.findIndex((job) => match(job.data));
    return index === -1 ? null : index + 1;
  }

  getJobCounts(name: QueueName): Promise<JobCounts> {
    return this.getQueue(name).getJobCounts(
      'active',
      'completed',
      'failed',
      'delayed',
      'waiting',
      'paused',
    ) as unknown as Promise<JobCounts>;
  }

  // Per-minute throughput from BullMQ's own metrics (Redis-backed, so the API
  // process reports queues that only the media VM actually runs). `data` is
  // newest-first, one bucket per minute.
  async getQueueMetrics(name: QueueName, minutes = 15): Promise<{ completed: number[]; failed: number[] }> {
    const queue = this.getQueue(name);
    const [completed, failed] = await Promise.all([
      queue.getMetrics('completed', 0, minutes - 1),
      queue.getMetrics('failed', 0, minutes - 1),
    ]);
    return { completed: completed.data ?? [], failed: failed.data ?? [] };
  }

  // Currently-running jobs, for the "what is it working on right now" panel.
  async getActiveJobs(name: QueueName, limit = 5): Promise<{ name: string; data: any; startedAt: number | null }[]> {
    const jobs = await this.getQueue(name).getActive(0, limit - 1);
    return jobs.map((job) => ({ name: job.name, data: job.data, startedAt: job.processedOn ?? null }));
  }

  async getFailedJobs(
    name: QueueName,
    limit = 20,
  ): Promise<{ id: string; name: string; data: any; reason: string; failedAt: number | null }[]> {
    const jobs = await this.getQueue(name).getFailed(0, limit - 1);
    return jobs.map((job) => ({
      id: String(job.id),
      name: job.name,
      data: job.data,
      reason: job.failedReason ?? '',
      failedAt: job.finishedOn ?? null,
    }));
  }

  async queueAll(items: JobItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }

    const promises = [];
    const itemsByQueue = {} as Record<string, { name: string; data: any; opts?: JobsOptions }[]>;
    for (const item of items) {
      const queueName = this.getQueueName(item.name);
      const options = this.getJobOptions(item) || undefined;

      if (options?.jobId || options?.deduplication || options?.delay) {
        // add() instead of addBulk() so jobId/deduplication/delay take effect
        promises.push(this.getQueue(queueName).add(item.name, item.data ?? {}, options));
      } else {
        itemsByQueue[queueName] = itemsByQueue[queueName] || [];
        itemsByQueue[queueName].push({ name: item.name, data: item.data ?? {}, opts: options });
      }
    }

    for (const [queueName, jobs] of Object.entries(itemsByQueue)) {
      promises.push(this.getQueue(queueName as QueueName).addBulk(jobs));
    }

    await Promise.all(promises);
  }

  async queue(item: JobItem): Promise<void> {
    return this.queueAll([item]);
  }

  // Honor provider Retry-After exactly (docs/plan/08 §4): pause the queue's
  // worker for `ms`, then throw rateLimitError() from the handler so the job
  // returns to waiting WITHOUT consuming an attempt.
  async rateLimitQueue(queueName: QueueName, ms: number): Promise<void> {
    const worker = this.workers[queueName];
    if (worker) {
      await worker.rateLimit(ms);
    }
  }

  rateLimitError(): Error {
    return Worker.RateLimitError();
  }

  async waitForQueueCompletion(...queues: QueueName[]): Promise<void> {
    const getPending = async () => {
      const results = await Promise.all(queues.map(async (name) => ({ pending: await this.isActive(name), name })));
      return results.filter(({ pending }) => pending).map(({ name }) => name);
    };

    let pending = await getPending();
    while (pending.length > 0) {
      this.logger.verbose(`Waiting for ${pending[0]} queue to stop...`);
      await setTimeout(1000);
      pending = await getPending();
    }
  }

  private getQueueName(name: JobName) {
    return (this.handlers[name] as JobMapItem).queueName;
  }

  // Debounce/dedup patterns from docs/plan/05-job-orchestration.md §1.
  private getJobOptions(item: JobItem): JobsOptions | null {
    const retry = QUEUE_RETRY[this.getQueueName(item.name)];
    const base: JobsOptions = {
      attempts: retry.attempts,
      backoff: { type: 'exponential', delay: retry.backoffMs },
    };

    // NOTE: BullMQ custom job ids must not contain ':' (Redis key separator)
    switch (item.name) {
      case JobName.ParticipantRematch: {
        // burst of uploads → one rematch per event
        return { ...base, jobId: `rematch-${item.data.eventId}`, delay: 60_000 };
      }
      case JobName.SendDigest: {
        return { ...base, jobId: `digest-${item.data.participantId}` };
      }
      case JobName.FaceRecognizeQueueAll: {
        // per-event dedup: one pending sweep per event, however many uploads
        return { ...base, deduplication: { id: `queueall-${item.data.eventId}` } };
      }
      default: {
        return base;
      }
    }
  }

  private getQueue(queue: QueueName): Queue {
    return this.moduleRef.get<Queue>(getQueueToken(queue), { strict: false });
  }
}
