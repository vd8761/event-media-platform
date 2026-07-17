// M2/M6 (docs/plan/04-storage-r2.md §6): R2 key/prefix deletion, staging
// sweeps, session cleanup, and the nightly reconciliation + hard-delete sweep.
import { Injectable } from '@nestjs/common';
import { OnJob } from 'src/decorators';
import { JobName, JobStatus, QueueName } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SessionRepository } from 'src/repositories/session.repository';
import { JobOf } from 'src/types';

@Injectable()
export class CleanupService {
  constructor(
    private logger: LoggingRepository,
    private sessionRepository: SessionRepository,
  ) {
    this.logger.setContext(CleanupService.name);
  }

  @OnJob({ name: JobName.CleanupKeys, queue: QueueName.StorageCleanup })
  async handleCleanupKeys({ keys }: JobOf<JobName.CleanupKeys>): Promise<JobStatus> {
    this.logger.warn(`CleanupKeys not implemented yet (M2) — ${keys.length} keys`);
    return JobStatus.Skipped;
  }

  @OnJob({ name: JobName.CleanupPrefix, queue: QueueName.StorageCleanup })
  async handleCleanupPrefix({ prefix }: JobOf<JobName.CleanupPrefix>): Promise<JobStatus> {
    this.logger.warn(`CleanupPrefix not implemented yet (M2) — ${prefix}`);
    return JobStatus.Skipped;
  }

  @OnJob({ name: JobName.StagingSweep, queue: QueueName.Background })
  async handleStagingSweep(): Promise<JobStatus> {
    this.logger.debug('StagingSweep not implemented yet (M2)');
    return JobStatus.Skipped;
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
    this.logger.debug('StorageReconcile not implemented yet (M6)');
    return JobStatus.Skipped;
  }
}
