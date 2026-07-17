// M5 (docs/plan/08-cloud-imports.md): ImportFolder pages Drive/Graph listings
// into import_item rows (incremental re-sync on unique(event_id, provider,
// remote_id)); ImportFile streams the download into /staging with inline SHA-1
// and hands off to the standard upload pipeline.
import { Injectable } from '@nestjs/common';
import { OnJob } from 'src/decorators';
import { JobName, JobStatus, QueueName } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { JobOf } from 'src/types';

@Injectable()
export class ImportService {
  constructor(private logger: LoggingRepository) {
    this.logger.setContext(ImportService.name);
  }

  @OnJob({ name: JobName.ImportFolder, queue: QueueName.Import })
  async handleImportFolder({ importJobId }: JobOf<JobName.ImportFolder>): Promise<JobStatus> {
    this.logger.warn(`ImportFolder not implemented yet (M5) — job ${importJobId}`);
    return JobStatus.Skipped;
  }

  @OnJob({ name: JobName.ImportFile, queue: QueueName.Import })
  async handleImportFile({ importItemId }: JobOf<JobName.ImportFile>): Promise<JobStatus> {
    this.logger.warn(`ImportFile not implemented yet (M5) — item ${importItemId}`);
    return JobStatus.Skipped;
  }
}
