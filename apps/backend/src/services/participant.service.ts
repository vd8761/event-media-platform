// M4 (docs/plan/07-participant-flow.md): SelfieProcess (GPU worker — ML embed
// + inline match), the shared matchParticipant() used by every trigger
// (Decision D6 — face-level KNN against face_search, never cluster-level, risk
// R3), the debounced ParticipantRematch, the 15-min ParticipantMatchSweep, and
// the selfie retention sweep.
import { Injectable } from '@nestjs/common';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { OnJob } from 'src/decorators';
import { JobName, JobStatus, ParticipantStatus, QueueName } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { FaceSearchRepository } from 'src/repositories/face-search.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository';
import { ParticipantRepository } from 'src/repositories/participant.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { FacialRecognitionConfig, SystemConfigRepository } from 'src/repositories/system-config.repository';
import { Participant } from 'src/schema';
import { JobOf } from 'src/types';

const SELFIE_RETENTION_DAYS = 30; // after event end (docs/plan/07 §6)
const MATCH_NUM_RESULTS = 200;

@Injectable()
export class ParticipantService {
  private cacheFolder: string;

  constructor(
    private configRepository: ConfigRepository,
    private eventRepository: EventRepository,
    private faceSearchRepository: FaceSearchRepository,
    private jobRepository: JobRepository,
    private logger: LoggingRepository,
    private machineLearningRepository: MachineLearningRepository,
    private participantRepository: ParticipantRepository,
    private storageRepository: StorageRepository,
    private systemConfigRepository: SystemConfigRepository,
  ) {
    this.logger.setContext(ParticipantService.name);
    this.cacheFolder = this.configRepository.getEnv().storage.cacheFolder;
  }

  private async getConfig(eventId: string): Promise<FacialRecognitionConfig> {
    const config = await this.systemConfigRepository.getFacialRecognitionConfig();
    const event = await this.eventRepository.getById(eventId);
    return {
      ...config,
      minScore: event?.config?.minScore ?? config.minScore,
      maxDistance: event?.config?.matchMaxDistance ?? config.maxDistance,
    };
  }

  // --- selfie → embedding → inline match (GPU worker) ---

  @OnJob({ name: JobName.SelfieProcess, queue: QueueName.Selfie })
  async handleSelfieProcess({ participantId }: JobOf<JobName.SelfieProcess>): Promise<JobStatus> {
    const participant = await this.participantRepository.getById(participantId);
    if (!participant || !participant.selfieKey) {
      this.logger.warn(`SelfieProcess skipped — participant ${participantId} not found or has no selfie`);
      return JobStatus.Skipped;
    }

    const config = await this.getConfig(participant.eventId);
    const workDir = join(this.cacheFolder, `selfie-${participantId}`);
    const selfiePath = join(workDir, 'selfie.jpg');

    try {
      await mkdir(workDir, { recursive: true });
      await this.storageRepository.downloadToFile(participant.selfieKey, selfiePath);

      const { faces } = await this.machineLearningRepository.detectFaces(selfiePath, {
        modelName: config.modelName,
        minScore: config.minScore,
      });

      if (faces.length === 0) {
        this.logger.log(`No face detected in selfie of participant ${participantId}`);
        await this.participantRepository.update(participantId, { status: ParticipantStatus.NoFace });
        await this.jobRepository.queue({ name: JobName.SendNoFaceEmail, data: { participantId } });
        return JobStatus.Success;
      }

      // pick the largest bounding box (docs/plan/06 §6)
      const largest = faces.reduce((a, b) => {
        const areaA = (a.boundingBox.x2 - a.boundingBox.x1) * (a.boundingBox.y2 - a.boundingBox.y1);
        const areaB = (b.boundingBox.x2 - b.boundingBox.x1) * (b.boundingBox.y2 - b.boundingBox.y1);
        return areaB > areaA ? b : a;
      });

      await this.participantRepository.update(participantId, { selfieEmbedding: largest.embedding });

      // run the match inline — this worker already holds the embedding
      const updated = await this.participantRepository.getById(participantId);
      const newMatches = await this.matchParticipant(updated!);
      if (newMatches > 0) {
        await this.jobRepository.queue({ name: JobName.SendGalleryEmail, data: { participantId } });
      }
      return JobStatus.Success;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // --- the one shared matching function (docs/plan/07 §3) ---
  // Face-level KNN directly against face_search — all detected faces of the
  // event, clustered or not. Returns the number of NEW matches inserted.
  async matchParticipant(participant: Participant): Promise<number> {
    if (!participant.selfieEmbedding) {
      return 0;
    }

    const config = await this.getConfig(participant.eventId);
    const results = await this.faceSearchRepository.searchFacesByEmbedding(
      participant.eventId,
      participant.selfieEmbedding,
      { numResults: MATCH_NUM_RESULTS, maxDistance: config.maxDistance },
    );

    const inserted = await this.participantRepository.insertMatches(
      results.map((result) => ({
        participantId: participant.id,
        assetId: result.assetId,
        viaFaceId: result.id,
        distance: result.distance,
      })),
    );

    const total = await this.participantRepository.countMatches(participant.id);
    await this.participantRepository.update(participant.id, {
      status: total > 0 ? ParticipantStatus.Matched : ParticipantStatus.PendingMatch,
    });

    if (inserted > 0) {
      this.logger.log(`Participant ${participant.id}: ${inserted} new matches (${total} total)`);
    }
    return inserted;
  }

  // --- debounced per-event rematch (ingest role) ---

  @OnJob({ name: JobName.ParticipantRematch, queue: QueueName.Match })
  async handleParticipantRematch({ eventId }: JobOf<JobName.ParticipantRematch>): Promise<JobStatus> {
    const participants = await this.participantRepository.getMatchableByEvent(eventId);
    if (participants.length === 0) {
      return JobStatus.Skipped;
    }

    for (const participant of participants) {
      const newMatches = await this.matchParticipant(participant);
      if (newMatches > 0) {
        await this.jobRepository.queue(
          participant.notifiedFirstAt
            ? { name: JobName.SendDigest, data: { participantId: participant.id } }
            : { name: JobName.SendGalleryEmail, data: { participantId: participant.id } },
        );
      }
    }
    return JobStatus.Success;
  }

  // safety net: covers "selfie submitted before any photos were uploaded"
  @OnJob({ name: JobName.ParticipantMatchSweep, queue: QueueName.Match })
  async handleParticipantMatchSweep(): Promise<JobStatus> {
    const pending = await this.participantRepository.getPendingForSweep();
    for (const participant of pending) {
      const newMatches = await this.matchParticipant(participant);
      if (newMatches > 0) {
        await this.jobRepository.queue(
          participant.notifiedFirstAt
            ? { name: JobName.SendDigest, data: { participantId: participant.id } }
            : { name: JobName.SendGalleryEmail, data: { participantId: participant.id } },
        );
      }
    }
    return JobStatus.Success;
  }

  // --- retention (docs/plan/07 §6) ---

  @OnJob({ name: JobName.SelfieRetentionSweep, queue: QueueName.StorageCleanup })
  async handleSelfieRetentionSweep(): Promise<JobStatus> {
    const expired = await this.participantRepository.getExpiredSelfies(SELFIE_RETENTION_DAYS);
    if (expired.length === 0) {
      return JobStatus.Success;
    }

    const keys = expired.map((participant) => participant.selfieKey!).filter(Boolean);
    if (keys.length > 0) {
      await this.jobRepository.queue({ name: JobName.CleanupKeys, data: { keys } });
    }
    for (const participant of expired) {
      await this.participantRepository.softDeleteAndScrub(participant.id);
    }
    this.logger.log(`Selfie retention: scrubbed ${expired.length} participants`);
    return JobStatus.Success;
  }
}
