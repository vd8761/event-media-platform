// M3 (docs/plan/06-face-pipeline.md): port of PersonService.handleDetectFaces /
// handleRecognizeFaces / handleQueueRecognizeFaces / handlePersonCleanup and
// MediaService.handleGeneratePersonThumbnail from immich:server. Every
// ownerId → eventId (privacy invariant, risk R2 — scope lives inside the SQL CTE).
import { Injectable } from '@nestjs/common';
import { OnJob } from 'src/decorators';
import { JobName, JobStatus, QueueName } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { JobOf } from 'src/types';

@Injectable()
export class FaceService {
  constructor(private logger: LoggingRepository) {
    this.logger.setContext(FaceService.name);
  }

  @OnJob({ name: JobName.FaceDetect, queue: QueueName.FaceDetection })
  async handleDetectFaces({ assetId }: JobOf<JobName.FaceDetect>): Promise<JobStatus> {
    this.logger.warn(`FaceDetect not implemented yet (M3) — asset ${assetId}`);
    return JobStatus.Skipped;
  }

  // Concurrency 1 — globally (risk R1). Extra GPU VMs exclude this queue.
  @OnJob({ name: JobName.FaceRecognize, queue: QueueName.FacialRecognition })
  async handleRecognizeFaces({ faceId }: JobOf<JobName.FaceRecognize>): Promise<JobStatus> {
    this.logger.warn(`FaceRecognize not implemented yet (M3) — face ${faceId}`);
    return JobStatus.Skipped;
  }

  @OnJob({ name: JobName.FaceRecognizeQueueAll, queue: QueueName.FacialRecognition })
  async handleQueueRecognizeFaces({ eventId }: JobOf<JobName.FaceRecognizeQueueAll>): Promise<JobStatus> {
    this.logger.warn(`FaceRecognizeQueueAll not implemented yet (M3) — event ${eventId}`);
    return JobStatus.Skipped;
  }

  @OnJob({ name: JobName.PersonThumbnail, queue: QueueName.PersonThumbnail })
  async handlePersonThumbnail({ personId }: JobOf<JobName.PersonThumbnail>): Promise<JobStatus> {
    this.logger.warn(`PersonThumbnail not implemented yet (M3) — person ${personId}`);
    return JobStatus.Skipped;
  }

  @OnJob({ name: JobName.PersonCleanup, queue: QueueName.Background })
  async handlePersonCleanup(): Promise<JobStatus> {
    this.logger.warn('PersonCleanup not implemented yet (M3)');
    return JobStatus.Skipped;
  }
}
