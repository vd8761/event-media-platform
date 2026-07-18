// M2/M6 (docs/plan/04-storage-r2.md §6): R2 key/prefix deletion, staging
// sweeps, session cleanup, and the nightly reconciliation + hard-delete sweep.
import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { OnJob } from 'src/decorators';
import { JobName, JobStatus, QueueName } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SessionRepository } from 'src/repositories/session.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { DB } from 'src/schema';
import { JobOf } from 'src/types';

const STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1000; // crashed uploads (docs/plan/04 §3)
const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // soft-delete grace (docs/plan/04 §6)

@Injectable()
export class CleanupService {
  private stagingFolder: string;

  constructor(
    @InjectKysely() private db: Kysely<DB>,
    configRepository: ConfigRepository,
    private jobRepository: JobRepository,
    private logger: LoggingRepository,
    private sessionRepository: SessionRepository,
    private storageRepository: StorageRepository,
  ) {
    this.logger.setContext(CleanupService.name);
    this.stagingFolder = configRepository.getEnv().storage.stagingFolder;
  }

  @OnJob({ name: JobName.CleanupKeys, queue: QueueName.StorageCleanup })
  async handleCleanupKeys({ keys }: JobOf<JobName.CleanupKeys>): Promise<JobStatus> {
    if (keys.length === 0) {
      return JobStatus.Skipped;
    }
    await this.storageRepository.deleteKeys(keys);
    this.logger.log(`Deleted ${keys.length} R2 objects`);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.CleanupPrefix, queue: QueueName.StorageCleanup })
  async handleCleanupPrefix({ prefix }: JobOf<JobName.CleanupPrefix>): Promise<JobStatus> {
    await this.storageRepository.deletePrefix(prefix);
    this.logger.log(`Deleted R2 prefix ${prefix}`);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.StagingSweep, queue: QueueName.Background })
  async handleStagingSweep(): Promise<JobStatus> {
    let removed = 0;
    let entries: string[];
    try {
      entries = await readdir(this.stagingFolder);
    } catch {
      return JobStatus.Skipped; // staging folder not created yet
    }
    const cutoff = Date.now() - STAGING_MAX_AGE_MS;
    for (const entry of entries) {
      const path = join(this.stagingFolder, entry);
      try {
        const info = await stat(path);
        if (info.isFile() && info.mtimeMs < cutoff) {
          await unlink(path);
          removed++;
        }
      } catch {
        // raced with another sweep or an in-flight upload — ignore
      }
    }
    if (removed > 0) {
      this.logger.log(`StagingSweep removed ${removed} stale files`);
    }
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.SessionCleanup, queue: QueueName.Background })
  async handleSessionCleanup(): Promise<JobStatus> {
    const deleted = await this.sessionRepository.deleteExpired();
    if (deleted > 0) {
      this.logger.log(`Deleted ${deleted} expired sessions`);
    }
    return JobStatus.Success;
  }

  // Nightly reconciliation (docs/plan/04 §6): after the 7-day grace period,
  // hard-delete soft-deleted rows and queue R2 cleanup for any stragglers —
  // this is the safety net for cleanup jobs lost to crashes.
  @OnJob({ name: JobName.StorageReconcile, queue: QueueName.Background })
  async handleStorageReconcile(): Promise<JobStatus> {
    const cutoff = new Date(Date.now() - GRACE_PERIOD_MS);
    const keys: string[] = [];
    const prefixes: string[] = [];

    // events past grace: one prefix delete covers every derivative + original
    const events = await this.db
      .selectFrom('event')
      .select(['id', 'orgId'])
      .where('deletedAt', 'is not', null)
      .where('deletedAt', '<', cutoff)
      .execute();
    for (const event of events) {
      prefixes.push(`org/${event.orgId}/event/${event.id}/`);
    }

    // individually deleted assets past grace (their event may still be live)
    const assets = await this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.storageKey'])
      .where('asset.deletedAt', 'is not', null)
      .where('asset.deletedAt', '<', cutoff)
      .execute();
    for (const asset of assets) {
      keys.push(asset.storageKey);
      const files = await this.db
        .selectFrom('assetFile')
        .select('storageKey')
        .where('assetId', '=', asset.id)
        .execute();
      keys.push(...files.map((file) => file.storageKey));
    }

    // participants scrubbed by retention keep no R2 objects; just drop rows
    if (keys.length > 0) {
      await this.jobRepository.queue({ name: JobName.CleanupKeys, data: { keys } });
    }
    for (const prefix of prefixes) {
      await this.jobRepository.queue({ name: JobName.CleanupPrefix, data: { prefix } });
    }

    // hard deletes — FK cascades clear faces/matches/files/items
    if (assets.length > 0) {
      await this.db.deleteFrom('asset').where('id', 'in', assets.map((asset) => asset.id)).execute();
    }
    if (events.length > 0) {
      await this.db.deleteFrom('event').where('id', 'in', events.map((event) => event.id)).execute();
    }
    const participants = await this.db
      .deleteFrom('participant')
      .where('deletedAt', 'is not', null)
      .where('deletedAt', '<', cutoff)
      .executeTakeFirst();

    const removed = events.length + assets.length + Number(participants.numDeletedRows ?? 0);
    if (removed > 0) {
      this.logger.log(
        `StorageReconcile: hard-deleted ${events.length} events, ${assets.length} assets, ${participants.numDeletedRows} participants; queued ${keys.length} keys + ${prefixes.length} prefixes`,
      );
    }
    return JobStatus.Success;
  }
}
