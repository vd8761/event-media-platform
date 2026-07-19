// M3 — the Immich facial classification port (docs/plan/06-face-pipeline.md).
// handleDetectFaces / iou / handleRecognizeFaces / handleQueueRecognizeFaces /
// handlePersonCleanup are line-for-line ports of
// immich:server/src/services/person.service.ts, and handlePersonThumbnail of
// immich MediaService.handleGeneratePersonThumbnail — with one systematic
// change: tenancy scope ownerId → eventId (privacy invariant, risk R2).
// Dropped vs Immich: birthDate/visibility gates, asset_job_status.
import { Injectable } from '@nestjs/common';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { OnJob } from 'src/decorators';
import { AssetFileType, FaceSourceType, JobName, JobStatus, QueueName } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { FaceRepository } from 'src/repositories/face.repository';
import { FaceSearchRepository } from 'src/repositories/face-search.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { BoundingBox, MachineLearningRepository } from 'src/repositories/machine-learning.repository';
import { MediaRepository } from 'src/repositories/media.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { FacialRecognitionConfig, SystemConfigRepository } from 'src/repositories/system-config.repository';
import { JobItem, JobOf } from 'src/types';
import { StorageKeys } from 'src/utils/storage-keys';

// FACE_THUMBNAIL_SIZE, immich:server/src/constants.ts
const FACE_THUMBNAIL_SIZE = 250;
const QUEUE_ALL_PAGE_SIZE = 1000;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

@Injectable()
export class FaceService {
  private cacheFolder: string;

  constructor(
    private assetRepository: AssetRepository,
    private configRepository: ConfigRepository,
    private cryptoRepository: CryptoRepository,
    private databaseRepository: DatabaseRepository,
    private eventRepository: EventRepository,
    private faceRepository: FaceRepository,
    private faceSearchRepository: FaceSearchRepository,
    private jobRepository: JobRepository,
    private logger: LoggingRepository,
    private machineLearningRepository: MachineLearningRepository,
    private mediaRepository: MediaRepository,
    private personRepository: PersonRepository,
    private storageRepository: StorageRepository,
    private systemConfigRepository: SystemConfigRepository,
  ) {
    this.logger.setContext(FaceService.name);
    this.cacheFolder = this.configRepository.getEnv().storage.cacheFolder;
  }

  // ML settings: system defaults overridable per event (docs/plan/06 §2).
  private async getConfig(eventId: string): Promise<FacialRecognitionConfig> {
    const config = await this.systemConfigRepository.getFacialRecognitionConfig();
    const event = await this.eventRepository.getById(eventId);
    return {
      ...config,
      minScore: event?.config?.minScore ?? config.minScore,
      maxDistance: event?.config?.matchMaxDistance ?? config.maxDistance,
    };
  }

  // --- Stage A: detection (port of PersonService.handleDetectFaces ~line 301) ---

  @OnJob({ name: JobName.FaceDetect, queue: QueueName.FaceDetection })
  async handleDetectFaces({ assetId }: JobOf<JobName.FaceDetect>): Promise<JobStatus> {
    const asset = await this.assetRepository.getByIdUnscoped(assetId);
    if (!asset) {
      this.logger.warn(`FaceDetect skipped — asset ${assetId} not found`);
      return JobStatus.Skipped;
    }

    const files = await this.assetRepository.getFiles(assetId);
    const preview = files.find((file) => file.type === AssetFileType.Preview);
    if (!preview) {
      this.logger.warn(`FaceDetect failed — asset ${assetId} has no preview yet`);
      return JobStatus.Failed;
    }

    const config = await this.getConfig(asset.eventId);

    // stage preview from R2 (Immich reads the local preview path directly)
    const workDir = join(this.cacheFolder, `${assetId}-faces`);
    const previewPath = join(workDir, 'preview.jpeg');
    try {
      await mkdir(workDir, { recursive: true });
      await this.storageRepository.downloadToFile(preview.storageKey, previewPath);

      const { imageHeight, imageWidth, faces } = await this.machineLearningRepository.detectFaces(previewPath, {
        modelName: config.modelName,
        minScore: config.minScore,
      });
      this.logger.debug(`${faces.length} faces detected in asset ${assetId}`);

      const existingFaces = await this.faceRepository.getByAssetId(assetId);

      const facesToAdd: (Parameters<FaceRepository['refreshFaces']>[0][number] & { id: string })[] = [];
      const embeddings: { faceId: string; embedding: string }[] = [];
      const mlFaceIds = new Set<string>();

      for (const face of existingFaces) {
        if (face.sourceType === FaceSourceType.MachineLearning) {
          mlFaceIds.add(face.id);
        }
      }

      // scale new boxes into the coordinate space of the previously stored
      // faces so IoU compares like with like (verbatim Immich)
      const heightScale = imageHeight / (existingFaces[0]?.imageHeight || 1);
      const widthScale = imageWidth / (existingFaces[0]?.imageWidth || 1);
      for (const { boundingBox, embedding } of faces) {
        const scaledBox = {
          x1: boundingBox.x1 * widthScale,
          y1: boundingBox.y1 * heightScale,
          x2: boundingBox.x2 * widthScale,
          y2: boundingBox.y2 * heightScale,
        };
        const match = existingFaces.find((face) => this.iou(face, scaledBox) > 0.5);

        if (match && !mlFaceIds.delete(match.id)) {
          embeddings.push({ faceId: match.id, embedding });
        } else if (!match) {
          const faceId = this.cryptoRepository.randomUUID();
          facesToAdd.push({
            id: faceId,
            assetId,
            imageHeight,
            imageWidth,
            boundingBoxX1: boundingBox.x1,
            boundingBoxY1: boundingBox.y1,
            boundingBoxX2: boundingBox.x2,
            boundingBoxY2: boundingBox.y2,
          });
          embeddings.push({ faceId, embedding });
        }
      }
      const faceIdsToRemove = [...mlFaceIds];

      if (facesToAdd.length > 0 || faceIdsToRemove.length > 0 || embeddings.length > 0) {
        await this.faceRepository.refreshFaces(facesToAdd, faceIdsToRemove, embeddings);
      }

      if (faceIdsToRemove.length > 0) {
        this.logger.log(`Removed ${faceIdsToRemove.length} faces below detection threshold in asset ${assetId}`);
      }

      // Record that detection ran regardless of the outcome — a photo with no
      // faces must not stay indistinguishable from one that was never queued.
      await this.assetRepository.setFacesDetected(assetId, faces.length);

      if (facesToAdd.length > 0) {
        this.logger.log(`Detected ${facesToAdd.length} new faces in asset ${assetId}`);
        const jobs: JobItem[] = facesToAdd.map((face) => ({
          name: JobName.FaceRecognize as const,
          data: { faceId: face.id },
        }));
        // Immich queues FacialRecognitionQueueAll alongside the per-face jobs
        // (person.service.ts ~line 374): early faces are skipped when their
        // neighbors' embeddings don't exist yet, and the deduplicated queue-all
        // sweep (which waits for detection to drain) re-covers them.
        jobs.push({ name: JobName.FaceRecognizeQueueAll, data: { eventId: asset.eventId } });
        // debounced — a burst of uploads triggers one rematch (docs/plan/05 §1)
        jobs.push({ name: JobName.ParticipantRematch, data: { eventId: asset.eventId } });
        await this.jobRepository.queueAll(jobs);
      }

      return JobStatus.Success;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // verbatim from immich person.service iou() ~line 384
  private iou(
    face: { boundingBoxX1: number; boundingBoxY1: number; boundingBoxX2: number; boundingBoxY2: number },
    newBox: BoundingBox,
  ): number {
    const x1 = Math.max(face.boundingBoxX1, newBox.x1);
    const y1 = Math.max(face.boundingBoxY1, newBox.y1);
    const x2 = Math.min(face.boundingBoxX2, newBox.x2);
    const y2 = Math.min(face.boundingBoxY2, newBox.y2);

    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const area1 = (face.boundingBoxX2 - face.boundingBoxX1) * (face.boundingBoxY2 - face.boundingBoxY1);
    const area2 = (newBox.x2 - newBox.x1) * (newBox.y2 - newBox.y1);
    const union = area1 + area2 - intersection;

    return intersection / union;
  }

  // --- Stage B: clustering (port of handleRecognizeFaces ~line 459) ---
  // Concurrency 1 — globally (risk R1). Extra GPU VMs exclude this queue.

  @OnJob({ name: JobName.FaceRecognize, queue: QueueName.FacialRecognition })
  async handleRecognizeFaces({ faceId, deferred }: JobOf<JobName.FaceRecognize>): Promise<JobStatus> {
    const face = await this.faceRepository.getForRecognition(faceId);
    if (!face) {
      this.logger.warn(`Face ${faceId} not found`);
      return JobStatus.Failed;
    }

    if (face.sourceType !== FaceSourceType.MachineLearning) {
      this.logger.warn(`Skipping face ${faceId} due to source ${face.sourceType}`);
      return JobStatus.Skipped;
    }

    if (!face.embedding) {
      this.logger.warn(`Face ${faceId} does not have an embedding`);
      return JobStatus.Failed;
    }

    if (face.personId) {
      this.logger.debug(`Face ${faceId} already has a person assigned`);
      return JobStatus.Skipped;
    }

    const config = await this.getConfig(face.eventId);

    const matches = await this.faceSearchRepository.searchFaces({
      eventId: face.eventId, // ★ Immich: userIds: [face.asset.ownerId]
      embedding: face.embedding,
      maxDistance: config.maxDistance,
      numResults: config.minFaces,
    });

    // `matches` also includes the face itself
    if (config.minFaces > 1 && matches.length <= 1) {
      this.logger.debug(`Face ${faceId} only matched the face itself, skipping`);
      return JobStatus.Skipped;
    }

    this.logger.debug(`Face ${faceId} has ${matches.length} matches`);

    // core/deferred two-pass: non-core faces run again after core faces have
    // created persons (verbatim Immich)
    const isCore = matches.length >= config.minFaces;
    if (!isCore && !deferred) {
      this.logger.debug(`Deferring non-core face ${faceId} for later processing`);
      await this.jobRepository.queue({ name: JobName.FaceRecognize, data: { faceId, deferred: true } });
      return JobStatus.Skipped;
    }

    let personId = matches.find((match) => match.personId)?.personId ?? undefined;
    if (!personId) {
      const matchWithPerson = await this.faceSearchRepository.searchFaces({
        eventId: face.eventId,
        embedding: face.embedding,
        maxDistance: config.maxDistance,
        numResults: 1,
        hasPerson: true,
      });

      if (matchWithPerson.length > 0) {
        personId = matchWithPerson[0].personId ?? undefined;
      }
    }

    if (isCore && !personId) {
      this.logger.log(`Creating new person for face ${faceId}`);
      const newPerson = await this.personRepository.create({
        eventId: face.eventId,
        orgId: face.orgId,
        faceAssetFaceId: face.id,
      });
      await this.jobRepository.queueAll([
        { name: JobName.PersonThumbnail, data: { personId: newPerson.id } },
        { name: JobName.ParticipantRematch, data: { eventId: face.eventId } },
      ]);
      personId = newPerson.id;
    }

    if (personId) {
      this.logger.debug(`Assigning face ${faceId} to person ${personId}`);
      await this.faceRepository.reassignFaces({ faceIds: [faceId], newPersonId: personId });
    }

    return JobStatus.Success;
  }

  // --- re-run entry point (port of handleQueueRecognizeFaces ~line 401) ---

  @OnJob({ name: JobName.FaceRecognizeQueueAll, queue: QueueName.FacialRecognition })
  async handleQueueRecognizeFaces({ eventId, force }: JobOf<JobName.FaceRecognizeQueueAll>): Promise<JobStatus> {
    // let detection finish before re-clustering
    await this.jobRepository.waitForQueueCompletion(QueueName.MediaProcess, QueueName.FaceDetection);

    if (force) {
      await this.faceRepository.unassignByEvent(eventId);
      await this.handlePersonCleanup();
    }

    await this.databaseRepository.prewarmVectorIndex();

    let afterId: string | undefined;
    let total = 0;
    for (;;) {
      const page = await this.faceRepository.getUnassignedFaceIds(eventId, QUEUE_ALL_PAGE_SIZE, afterId);
      if (page.length === 0) {
        break;
      }
      await this.jobRepository.queueAll(
        page.map(({ id }) => ({ name: JobName.FaceRecognize as const, data: { faceId: id, deferred: false } })),
      );
      total += page.length;
      afterId = page.at(-1)!.id;
    }

    this.logger.log(`Queued recognition for ${total} unassigned faces of event ${eventId}`);
    await this.jobRepository.queue({ name: JobName.ParticipantRematch, data: { eventId } });
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.PersonCleanup, queue: QueueName.Background })
  async handlePersonCleanup(): Promise<JobStatus> {
    const people = await this.personRepository.getAllWithoutFaces();
    if (people.length === 0) {
      return JobStatus.Success;
    }
    const keys = people.map((person) => person.thumbnailKey).filter(Boolean);
    if (keys.length > 0) {
      await this.jobRepository.queue({ name: JobName.CleanupKeys, data: { keys } });
    }
    await this.personRepository.delete(people.map((person) => person.id));
    this.logger.log(`Deleted ${people.length} people without faces`);
    return JobStatus.Success;
  }

  // --- Stage C: person thumbnail (port of handleGeneratePersonThumbnail ~line 408) ---
  // Deviation: crops from the PREVIEW derivative (detection also ran on the
  // preview, so face boxes map 1:1); Immich re-decodes the original.

  @OnJob({ name: JobName.PersonThumbnail, queue: QueueName.PersonThumbnail })
  async handlePersonThumbnail({ personId }: JobOf<JobName.PersonThumbnail>): Promise<JobStatus> {
    const data = await this.personRepository.getThumbnailData(personId);
    if (!data) {
      this.logger.error(`Could not generate person thumbnail for ${personId}: missing data`);
      return JobStatus.Failed;
    }

    const files = await this.assetRepository.getFiles(data.assetId);
    const preview = files.find((file) => file.type === AssetFileType.Preview);
    if (!preview) {
      this.logger.error(`Could not generate person thumbnail for ${personId}: no preview file`);
      return JobStatus.Failed;
    }

    const workDir = join(this.cacheFolder, `person-${personId}`);
    const previewPath = join(workDir, 'preview.jpeg');
    const thumbPath = join(workDir, 'person.jpeg');
    try {
      await mkdir(workDir, { recursive: true });
      await this.storageRepository.downloadToFile(preview.storageKey, previewPath);

      const previewDims = await this.mediaRepository.getImageDimensions(previewPath);
      const crop = this.getCrop(
        { old: { width: data.imageWidth, height: data.imageHeight }, new: previewDims },
        { x1: data.boundingBoxX1, y1: data.boundingBoxY1, x2: data.boundingBoxX2, y2: data.boundingBoxY2 },
      );

      await this.mediaRepository.cropToThumbnail(previewPath, crop, FACE_THUMBNAIL_SIZE, thumbPath);

      const thumbnailKey = StorageKeys.person(data.orgId, data.eventId, personId);
      await this.storageRepository.putFile(thumbPath, thumbnailKey, 'image/jpeg');
      await this.personRepository.setThumbnailKey(personId, thumbnailKey);

      return JobStatus.Success;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // verbatim from immich media.service getCrop ~line 470 (clamp + zoom-out 10%)
  private getCrop(
    dims: { old: { width: number; height: number }; new: { width: number; height: number } },
    { x1, y1, x2, y2 }: BoundingBox,
  ): { x: number; y: number; width: number; height: number } {
    // face bounding boxes can spill outside the image dimensions
    const clampedX1 = clamp(x1, 0, dims.old.width);
    const clampedY1 = clamp(y1, 0, dims.old.height);
    const clampedX2 = clamp(x2, 0, dims.old.width);
    const clampedY2 = clamp(y2, 0, dims.old.height);

    const widthScale = dims.new.width / dims.old.width;
    const heightScale = dims.new.height / dims.old.height;

    const halfWidth = (widthScale * (clampedX2 - clampedX1)) / 2;
    const halfHeight = (heightScale * (clampedY2 - clampedY1)) / 2;

    const middleX = Math.round(widthScale * clampedX1 + halfWidth);
    const middleY = Math.round(heightScale * clampedY1 + halfHeight);

    // zoom out 10%
    const targetHalfSize = Math.floor(Math.max(halfWidth, halfHeight) * 1.1);

    // get the longest distance from the center of the image without overflowing
    const newHalfSize = Math.min(
      middleX - Math.max(0, middleX - targetHalfSize),
      middleY - Math.max(0, middleY - targetHalfSize),
      Math.min(dims.new.width - 1, middleX + targetHalfSize) - middleX,
      Math.min(dims.new.height - 1, middleY + targetHalfSize) - middleY,
    );

    return {
      x: middleX - newHalfSize,
      y: middleY - newHalfSize,
      width: newHalfSize * 2,
      height: newHalfSize * 2,
    };
  }
}
