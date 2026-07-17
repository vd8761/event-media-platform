// M2/M6 (docs/plan/04-storage-r2.md §6): R2 key/prefix deletion, staging
// sweeps, session cleanup, and the nightly reconciliation + hard-delete sweep.
import { Injectable } from '@nestjs/common';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { OnJob } from 'src/decorators';
import { JobName, JobStatus, QueueName } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SessionRepository } from 'src/repositories/session.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { JobOf } from 'src/types';

const STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1000; // crashed uploads (docs/plan/04 §3)

@Injectable()
export class CleanupService {
  private stagingFolder: string;

  constructor(
    configRepository: ConfigRepository,
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

  @OnJob({ name: JobName.StorageReconcile, queue: QueueName.Background })
  async handleStorageReconcile(): Promise<JobStatus> {
    // M6: hard-delete soft-deleted rows past grace + reconcile R2 stragglers
    this.logger.debug('StorageReconcile not implemented yet (M6)');
    return JobStatus.Skipped;
  }
}
