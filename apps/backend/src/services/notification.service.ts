// M4 (docs/plan/07 §5): react-email templates (gallery-ready / gallery-update /
// no-face) via the ported nodemailer pipeline; email_log rows; ≥6 h digest
// throttle re-checked at send time.
import { Injectable } from '@nestjs/common';
import { OnJob } from 'src/decorators';
import { JobName, JobStatus, QueueName } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { JobOf } from 'src/types';

@Injectable()
export class NotificationService {
  constructor(private logger: LoggingRepository) {
    this.logger.setContext(NotificationService.name);
  }

  @OnJob({ name: JobName.SendGalleryEmail, queue: QueueName.Notification })
  async handleSendGalleryEmail({ participantId }: JobOf<JobName.SendGalleryEmail>): Promise<JobStatus> {
    this.logger.warn(`SendGalleryEmail not implemented yet (M4) — participant ${participantId}`);
    return JobStatus.Skipped;
  }

  @OnJob({ name: JobName.SendDigest, queue: QueueName.Notification })
  async handleSendDigest({ participantId }: JobOf<JobName.SendDigest>): Promise<JobStatus> {
    this.logger.warn(`SendDigest not implemented yet (M4) — participant ${participantId}`);
    return JobStatus.Skipped;
  }

  @OnJob({ name: JobName.SendNoFaceEmail, queue: QueueName.Notification })
  async handleSendNoFaceEmail({ participantId }: JobOf<JobName.SendNoFaceEmail>): Promise<JobStatus> {
    this.logger.warn(`SendNoFaceEmail not implemented yet (M4) — participant ${participantId}`);
    return JobStatus.Skipped;
  }
}
