// M2 (docs/plan/05 §2, 04 §4): AssetProcess = stage original from R2 →
// exif → preview 1440 JPEG q80 + thumb 250 WebP q80 + thumbhash → R2 +
// asset_file rows; VideoTranscode = H.264 720p playback copy. Port of
// immich:server/src/services/media.service.ts handleGenerateThumbnails.
import { Injectable } from '@nestjs/common';
import { OnJob } from 'src/decorators';
import { JobName, JobStatus, QueueName } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { JobOf } from 'src/types';

@Injectable()
export class MediaService {
  constructor(private logger: LoggingRepository) {
    this.logger.setContext(MediaService.name);
  }

  @OnJob({ name: JobName.AssetProcess, queue: QueueName.MediaProcess })
  async handleAssetProcess({ assetId }: JobOf<JobName.AssetProcess>): Promise<JobStatus> {
    this.logger.warn(`AssetProcess not implemented yet (M2) — asset ${assetId}`);
    return JobStatus.Skipped;
  }

  @OnJob({ name: JobName.VideoTranscode, queue: QueueName.VideoTranscode })
  async handleVideoTranscode({ assetId }: JobOf<JobName.VideoTranscode>): Promise<JobStatus> {
    this.logger.warn(`VideoTranscode not implemented yet (M2) — asset ${assetId}`);
    return JobStatus.Skipped;
  }
}
