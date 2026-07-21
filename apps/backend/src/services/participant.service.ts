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
import { PersonRepository } from 'src/repositories/person.repository';
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
    private personRepository: PersonRepository,
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

    // A participant may have submitted up to three photos of themselves
    // (migration 0011). Each is embedded independently and they are all
    // treated as the same person at match time.
    const selfies = await this.participantRepository.getSelfies(participantId);

    try {
      await mkdir(workDir, { recursive: true });

      let embedded = 0;
      for (const selfie of selfies) {
        const selfiePath = join(workDir, `selfie-${selfie.ordinal}.jpg`);
        await this.storageRepository.downloadToFile(selfie.storageKey, selfiePath);

        const { faces } = await this.machineLearningRepository.detectFaces(selfiePath, {
          modelName: config.modelName,
          minScore: config.minScore,
        });

        if (faces.length === 0) {
          // One unusable photo out of three is not a failure — the others can
          // still carry the match, so this is recorded and skipped.
          this.logger.log(`No face in selfie ${selfie.ordinal} of participant ${participantId}`);
          await this.participantRepository.setSelfieEmbedding(selfie.id, null);
          continue;
        }

        // pick the largest bounding box (docs/plan/06 §6)
        const largest = faces.reduce((a, b) => {
          const areaA = (a.boundingBox.x2 - a.boundingBox.x1) * (a.boundingBox.y2 - a.boundingBox.y1);
          const areaB = (b.boundingBox.x2 - b.boundingBox.x1) * (b.boundingBox.y2 - b.boundingBox.y1);
          return areaB > areaA ? b : a;
        });

        await this.participantRepository.setSelfieEmbedding(selfie.id, largest.embedding);
        // The first usable embedding also becomes the participant's primary —
        // it is what the sweep and re-match queries treat as "processed".
        if (embedded === 0) {
          await this.participantRepository.update(participantId, { selfieEmbedding: largest.embedding });
        }
        embedded += 1;
      }

      if (embedded === 0) {
        this.logger.log(`No face detected in any selfie of participant ${participantId}`);
        await this.participantRepository.update(participantId, { status: ParticipantStatus.NoFace });
        await this.jobRepository.queue({ name: JobName.SendNoFaceEmail, data: { participantId } });
        return JobStatus.Success;
      }

      // run the match inline — this worker already holds the embeddings
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

  // Name the clusters a matched participant belongs to, so the organiser sees
  // "Priya" instead of a face they would have to identify by hand.
  //
  // Every cluster the participant's faces touch is offered a name, not just the
  // dominant one: one person's faces routinely land in several clusters, and
  // naming only the biggest left the rest unnamed for the same guest. The
  // safety is in `nameFromParticipants` deciding per cluster, from that
  // cluster's own faces — a stranger who matched loosely on one face does not
  // out-vote the participant who claimed the other twenty.
  //
  // Two rules hold regardless:
  //
  //  - Last write wins against the organiser, decided on when each side acted
  //    rather than which code path ran last — see nameFromParticipants.
  //  - Failures are swallowed. This is a nicety on top of matching; it must
  //    never fail a selfie that otherwise worked.
  //
  // This is the after-clustering half. The before-clustering half lives in
  // FaceService.handleRecognizeFaces, which runs the same query as each face
  // joins a cluster — matching and clustering race, so both directions are
  // needed for the name to appear whichever finishes first.
  private async nameMatchedPerson(participant: Participant, faceIds: string[]): Promise<void> {
    if (!participant.name || faceIds.length === 0) {
      return;
    }

    try {
      const clusters = await this.personRepository.getPersonsForFaces(faceIds);
      for (const cluster of clusters) {
        // No `if (cluster.name) continue` here: an already-named cluster is
        // exactly the case last-write-wins has to decide, and the timestamp
        // comparison inside nameFromParticipants is what decides it.
        const named = await this.personRepository.nameFromParticipants(participant.eventId, cluster.personId);
        if (named) {
          this.logger.log(`Named person ${cluster.personId} "${named}" from participant ${participant.id}`);
        }
      }
    } catch (error) {
      this.logger.warn(`Could not name the person for participant ${participant.id}: ${error}`);
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

    // Search once per selfie and union the hits, keeping the smallest distance
    // for each face. All the selfies are the same person, so a photo that only
    // one of them recognises is still a correct match — taking the best
    // distance per face is what makes three photos strictly better than one.
    // Falls back to the primary embedding for pre-0011 participants that have
    // no participant_selfie rows.
    const selfies = await this.participantRepository.getSelfies(participant.id);
    const embeddings = selfies
      .map((selfie) => selfie.embedding)
      .filter((embedding): embedding is string => embedding !== null);
    if (embeddings.length === 0) {
      embeddings.push(participant.selfieEmbedding);
    }

    const best = new Map<string, { assetId: string; distance: number }>();
    for (const embedding of embeddings) {
      const hits = await this.faceSearchRepository.searchFacesByEmbedding(participant.eventId, embedding, {
        numResults: MATCH_NUM_RESULTS,
        maxDistance: config.maxDistance,
      });
      for (const hit of hits) {
        const current = best.get(hit.id);
        if (!current || hit.distance < current.distance) {
          best.set(hit.id, { assetId: hit.assetId, distance: hit.distance });
        }
      }
    }

    const inserted = await this.participantRepository.insertMatches(
      [...best.entries()].map(([faceId, hit]) => ({
        participantId: participant.id,
        assetId: hit.assetId,
        viaFaceId: faceId,
        distance: hit.distance,
      })),
    );

    // Carry the participant's name onto their person cluster, so the organiser's
    // People tab shows "Priya" rather than an unnamed face they have to identify
    // by hand. Matching previously only recorded participant->asset rows, which
    // is what the guest gallery reads — the organiser-facing cluster was never
    // touched, so a guest could submit a selfie with their name and the
    // organiser would still see nobody.
    await this.nameMatchedPerson(participant, [...best.keys()]);

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

    // Both the primary selfie key and any extras (migration 0011).
    const extraKeys = await this.participantRepository.listSelfieKeys(expired.map((p) => p.id));
    const keys = [...new Set([...expired.map((participant) => participant.selfieKey!), ...extraKeys])].filter(Boolean);
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
