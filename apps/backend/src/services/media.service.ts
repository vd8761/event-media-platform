// M2 (docs/plan/05 §2, 04 §4). AssetProcess: stage original from R2 → exif →
// decode-once → preview 1440 JPEG q80 + thumb 250 WebP q80 + thumbhash → R2 +
// asset_file rows → status 'processed' → enqueue FaceDetect (+ VideoTranscode
// for videos). Every handler stages to /cache and cleans up in a finally block
// (risk R4). Port of immich:server/src/services/media.service.ts
// handleGenerateThumbnails, wrapped in R2 stage-in / upload-out.
import { Injectable } from '@nestjs/common';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { OnJob } from 'src/decorators';
import { AssetFileType, AssetStatus, AssetType, JobName, JobStatus, QueueName } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { ExifRepository } from 'src/repositories/exif.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MediaRepository, PREVIEW_SIZE, THUMBNAIL_SIZE } from 'src/repositories/media.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { JobOf } from 'src/types';
import { StorageKeys } from 'src/utils/storage-keys';

@Injectable()
export class MediaService {
  private cacheFolder: string;

  constructor(
    private assetRepository: AssetRepository,
    private configRepository: ConfigRepository,
    private exifRepository: ExifRepository,
    private jobRepository: JobRepository,
    private logger: LoggingRepository,
    private mediaRepository: MediaRepository,
    private storageRepository: StorageRepository,
  ) {
    this.logger.setContext(MediaService.name);
    this.cacheFolder = this.configRepository.getEnv().storage.cacheFolder;
  }

  @OnJob({ name: JobName.AssetProcess, queue: QueueName.MediaProcess })
  async handleAssetProcess({ assetId }: JobOf<JobName.AssetProcess>): Promise<JobStatus> {
    const asset = await this.assetRepository.getByIdUnscoped(assetId);
    if (!asset) {
      this.logger.warn(`AssetProcess skipped — asset ${assetId} not found`);
      return JobStatus.Skipped;
    }

    const workDir = join(this.cacheFolder, assetId);
    const originalPath = join(workDir, 'original');
    const previewPath = join(workDir, 'preview.jpeg');
    const thumbPath = join(workDir, 'thumb.webp');

    try {
      await mkdir(workDir, { recursive: true });
      await this.storageRepository.downloadToFile(asset.storageKey, originalPath);

      const isVideo = asset.type === AssetType.Video;
      let width: number | null = asset.width;
      let height: number | null = asset.height;
      let durationSeconds: number | null = asset.durationSeconds;
      let thumbSource = originalPath;

      if (isVideo) {
        const info = await this.mediaRepository.probe(originalPath);
        width = info.width;
        height = info.height;
        durationSeconds = info.durationSeconds;
        // images decode the original directly; videos need a still frame grab
        thumbSource = join(workDir, 'frame.jpeg');
        await this.extractVideoFrame(originalPath, thumbSource);
      } else {
        const dims = await this.mediaRepository.getImageDimensions(originalPath);
        width = dims.width;
        height = dims.height;

        const exif = await this.exifRepository.extract(originalPath);
        await this.assetRepository.upsertExif({ assetId, ...exif });
        if (exif.capturedAt) {
          await this.assetRepository.update(assetId, { capturedAt: exif.capturedAt });
        }
      }

      // decode once → preview + thumb + thumbhash
      const source = await this.mediaRepository.decodePreview(thumbSource);
      await Promise.all([
        this.mediaRepository.generatePreview(source, previewPath),
        this.mediaRepository.generateThumbnail(source, thumbPath),
      ]);
      const thumbhash = await this.mediaRepository.generateThumbhash(source);

      const previewKey = StorageKeys.preview(asset.orgId, asset.eventId, assetId);
      const thumbKey = StorageKeys.thumb(asset.orgId, asset.eventId, assetId);
      await Promise.all([
        this.storageRepository.putFile(previewPath, previewKey, 'image/jpeg'),
        this.storageRepository.putFile(thumbPath, thumbKey, 'image/webp'),
      ]);

      await this.assetRepository.upsertFile({
        assetId,
        type: AssetFileType.Preview,
        storageKey: previewKey,
        format: 'jpeg',
      });
      await this.assetRepository.upsertFile({
        assetId,
        type: AssetFileType.Thumbnail,
        storageKey: thumbKey,
        width: THUMBNAIL_SIZE,
        height: THUMBNAIL_SIZE,
        format: 'webp',
      });

      await this.assetRepository.update(assetId, {
        width,
        height,
        durationSeconds,
        thumbhash,
        status: AssetStatus.Processed,
      });

      // fan out (docs/plan/05 §2): faces + CLIP embedding for similar-search
      const jobs = [
        { name: JobName.FaceDetect as const, data: { assetId } },
        { name: JobName.SmartSearch as const, data: { assetId } },
      ];
      if (isVideo) {
        jobs.push({ name: JobName.VideoTranscode as any, data: { assetId } } as any);
      }
      await this.jobRepository.queueAll(jobs as any);

      this.logger.log(`Processed asset ${assetId} (${asset.type})`);
      return JobStatus.Success;
    } catch (error) {
      this.logger.error(`AssetProcess failed for ${assetId}: ${error}`);
      await this.assetRepository.setStatus(assetId, AssetStatus.Failed);
      return JobStatus.Failed;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  @OnJob({ name: JobName.VideoTranscode, queue: QueueName.VideoTranscode })
  async handleVideoTranscode({ assetId }: JobOf<JobName.VideoTranscode>): Promise<JobStatus> {
    const asset = await this.assetRepository.getByIdUnscoped(assetId);
    if (!asset || asset.type !== AssetType.Video) {
      return JobStatus.Skipped;
    }

    const workDir = join(this.cacheFolder, `${assetId}-video`);
    const originalPath = join(workDir, 'original');
    const outputPath = join(workDir, 'encoded.mp4');

    try {
      await mkdir(workDir, { recursive: true });
      await this.storageRepository.downloadToFile(asset.storageKey, originalPath);
      await this.mediaRepository.transcode(originalPath, outputPath);

      const videoKey = StorageKeys.video(asset.orgId, asset.eventId, assetId);
      await this.storageRepository.putFile(outputPath, videoKey, 'video/mp4');
      await this.assetRepository.upsertFile({
        assetId,
        type: AssetFileType.EncodedVideo,
        storageKey: videoKey,
        format: 'mp4',
      });

      this.logger.log(`Transcoded video ${assetId}`);
      return JobStatus.Success;
    } catch (error) {
      this.logger.error(`VideoTranscode failed for ${assetId}: ${error}`);
      return JobStatus.Failed;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private extractVideoFrame(input: string, output: string): Promise<void> {
    // lazy import so the image path never loads fluent-ffmpeg
    const ffmpeg = require('fluent-ffmpeg');
    return new Promise((resolve, reject) => {
      ffmpeg(input)
        .outputOptions(['-frames:v', '1', '-q:v', '2'])
        .on('end', () => resolve())
        .on('error', (error: Error) => reject(error))
        .save(output);
    });
  }
}
