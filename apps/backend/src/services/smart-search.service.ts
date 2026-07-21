// Smart / similar-photo search (Immich's SmartInfoService / smart_search):
// after an asset is processed, its preview is run through CLIP to produce a
// visual embedding stored in smart_search; "view similar photos" then does a
// cosine nearest-neighbour lookup scoped to the event.
//
// CLIP was originally stripped from this app (facial recognition only), so
// this is the one place image embeddings come back — kept in its own service
// and queue so it can be excluded on constrained deployments without touching
// the face pipeline.
import { Injectable, NotFoundException } from '@nestjs/common';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { OnJob } from 'src/decorators';
import { AssetFileType, JobName, JobStatus, QueueName } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository';
import { SmartSearchRepository } from 'src/repositories/smart-search.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { JobOf } from 'src/types';

// 512-dim OpenAI CLIP — matches smart_search.embedding vector(512). The ML
// service downloads it on first use (immich-app/ViT-B-32__openai on HF).
const CLIP_MODEL_NAME = 'ViT-B-32__openai';
const QUEUE_ALL_PAGE_SIZE = 1000;
const SIMILAR_RESULTS = 60;

@Injectable()
export class SmartSearchService {
  private cacheFolder: string;

  constructor(
    private assetRepository: AssetRepository,
    private configRepository: ConfigRepository,
    private jobRepository: JobRepository,
    private logger: LoggingRepository,
    private machineLearningRepository: MachineLearningRepository,
    private smartSearchRepository: SmartSearchRepository,
    private storageRepository: StorageRepository,
  ) {
    this.logger.setContext(SmartSearchService.name);
    this.cacheFolder = this.configRepository.getEnv().storage.cacheFolder;
  }

  // Per-asset embedding — mirrors FaceService.handleDetectFaces' stage-then-ML
  // shape: pull the preview from R2, run CLIP, upsert the vector.
  @OnJob({ name: JobName.SmartSearch, queue: QueueName.SmartSearch })
  async handleSmartSearch({ assetId }: JobOf<JobName.SmartSearch>): Promise<JobStatus> {
    const asset = await this.assetRepository.getByIdUnscoped(assetId);
    if (!asset) {
      this.logger.warn(`SmartSearch skipped — asset ${assetId} not found`);
      return JobStatus.Skipped;
    }

    const files = await this.assetRepository.getFiles(assetId);
    const preview = files.find((file) => file.type === AssetFileType.Preview);
    if (!preview) {
      this.logger.warn(`SmartSearch failed — asset ${assetId} has no preview yet`);
      return JobStatus.Failed;
    }

    const workDir = join(this.cacheFolder, `${assetId}-clip`);
    const previewPath = join(workDir, 'preview.jpeg');
    try {
      await mkdir(workDir, { recursive: true });
      await this.storageRepository.downloadToFile(preview.storageKey, previewPath);

      const embedding = await this.machineLearningRepository.encodeImage(previewPath, { modelName: CLIP_MODEL_NAME });
      await this.smartSearchRepository.upsert(assetId, embedding);

      this.logger.debug(`Computed CLIP embedding for asset ${assetId}`);
      return JobStatus.Success;
    } catch (error) {
      this.logger.warn(`SmartSearch failed for ${assetId}: ${error instanceof Error ? error.message : error}`);
      return JobStatus.Failed;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // Backfill: enqueue an embedding job for every processed asset of an event
  // that doesn't have one (or all of them when forced).
  @OnJob({ name: JobName.SmartSearchQueueAll, queue: QueueName.SmartSearch })
  async handleQueueAll({ eventId, force }: JobOf<JobName.SmartSearchQueueAll>): Promise<JobStatus> {
    let afterId: string | undefined;
    let total = 0;
    for (;;) {
      const page = await this.assetRepository.getProcessedAssetIds(eventId, {
        onlyMissing: !force,
        limit: QUEUE_ALL_PAGE_SIZE,
        afterId,
      });
      if (page.length === 0) {
        break;
      }
      await this.jobRepository.queueAll(
        page.map(({ id }) => ({ name: JobName.SmartSearch as const, data: { assetId: id } })),
      );
      total += page.length;
      afterId = page.at(-1)!.id;
    }
    this.logger.log(`Queued CLIP embedding for ${total} assets of event ${eventId}`);
    return JobStatus.Success;
  }

  // "View similar photos": nearest neighbours of one asset within its event.
  async findSimilar(eventId: string, assetId: string): Promise<string[]> {
    const asset = await this.assetRepository.getById(eventId, assetId);
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }
    const embedding = await this.smartSearchRepository.getEmbedding(assetId);
    if (!embedding) {
      // Not embedded yet (or CLIP unavailable) — nothing to compare against.
      return [];
    }
    const results = await this.smartSearchRepository.searchSimilar({
      eventId,
      embedding,
      excludeAssetId: assetId,
      numResults: SIMILAR_RESULTS,
    });
    return results.map((row) => row.assetId);
  }
}
