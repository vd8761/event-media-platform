// Live progress for a guest who just submitted a selfie and is still sitting on
// the submission page.
//
// The default flow is deliberately fire-and-forget: we acknowledge, email a
// gallery link, and the guest leaves. That is still the flow whenever the GPU
// box is asleep, because a box that is off (or booting) can take many minutes
// to accept work and a countdown nobody can honour is worse than no countdown.
//
// So this only offers a live view when the work will actually move now: the
// worker is online AND the box is not so loaded that any estimate is fiction.
// Otherwise it reports `email` and the page falls back to "check your inbox".
import { Injectable } from '@nestjs/common';
import { ParticipantStatus, QueueName } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { ParticipantRepository } from 'src/repositories/participant.repository';
import { CipherService } from 'src/services/cipher.service';
import { GpuLifecycleService } from 'src/services/gpu-lifecycle.service';
import { QUEUE_CONCURRENCY } from 'src/types';

// Above this much *total* GPU work, we stop promising a time. The selfie queue
// may be short while a photo import has thousands of faces in flight ahead of
// it, and those share the same GPU — so the honest signal is total depth, not
// this queue's depth.
const LIVE_MODE_MAX_PENDING = 100;

// How long a ticket stays valid. Long enough to outlast a queue backed up
// behind an import, short enough that a link pasted somewhere goes stale.
const TICKET_TTL_MS = 30 * 60 * 1000;

// Fallback per-selfie cost when the queue has no throughput history yet — the
// first submission after the box wakes has nothing to average over. Detection
// plus a KNN over face_search, rounded up rather than optimistic: an estimate
// that expires and leaves the guest waiting reads as broken.
const DEFAULT_SECONDS_PER_SELFIE = 25;

interface TicketPayload {
  p: string;
  exp: number;
}

export type SelfieProgress =
  | { mode: 'email' }
  | {
      mode: 'live';
      status: ParticipantStatus;
      // 1-based place in the selfie queue; null once it is being processed.
      position: number | null;
      etaSeconds: number | null;
      matchedCount: number;
    };

@Injectable()
export class SelfieProgressService {
  // True when *this* process runs the selfie queue itself (deploy docs §10:
  // `EL_QUEUES_INCLUDE=selfie` on Render against a CPU ML sidecar). Then selfie
  // work is not the GPU box's at all, so gating the live view on that box being
  // awake would send every guest to their inbox while the queue drains beside
  // them in under a second.
  private selfiesRunHere: boolean;

  constructor(
    configRepository: ConfigRepository,
    private cipherService: CipherService,
    private gpuLifecycleService: GpuLifecycleService,
    private jobRepository: JobRepository,
    private participantRepository: ParticipantRepository,
  ) {
    this.selfiesRunHere = configRepository.getEnv().includedQueues.includes(QueueName.Selfie);
  }

  // Scoped to progress only — it carries no gallery token and every reader of
  // it returns counts, never photos. That is what lets us hand it straight back
  // from the submit response: unlike the gallery token, possession proves
  // nothing about owning the mailbox, so it must not unlock anything.
  issueTicket(participantId: string): string {
    return this.cipherService.encryptState({
      p: participantId,
      exp: Date.now() + TICKET_TTL_MS,
    });
  }

  async getProgress(ticket: string): Promise<SelfieProgress> {
    let payload: TicketPayload;
    try {
      payload = this.cipherService.decryptState<TicketPayload>(ticket);
    } catch {
      // AES-GCM authenticates, so a forged or truncated ticket lands here.
      return { mode: 'email' };
    }

    if (!payload?.p || typeof payload.exp !== 'number' || payload.exp < Date.now()) {
      return { mode: 'email' };
    }

    const participant = await this.participantRepository.getById(payload.p);
    if (!participant) {
      return { mode: 'email' };
    }

    // Terminal states are worth reporting even on a loaded box: the answer is
    // already known, so there is nothing to estimate and nothing to gain by
    // sending the guest to their inbox instead.
    if (participant.status !== ParticipantStatus.Processing) {
      return {
        mode: 'live',
        status: participant.status,
        position: null,
        etaSeconds: null,
        matchedCount: await this.participantRepository.countMatches(participant.id),
      };
    }

    if (!this.selfiesRunHere) {
      const status = await this.gpuLifecycleService.getStatus();
      if (!status.workerOnline || status.pending > LIVE_MODE_MAX_PENDING) {
        return { mode: 'email' };
      }
    }

    const position = await this.jobRepository.getWaitingPosition(
      QueueName.Selfie,
      (data) => data?.participantId === participant.id,
    );

    return {
      mode: 'live',
      status: participant.status,
      position,
      etaSeconds: await this.estimateSeconds(position),
      matchedCount: 0,
    };
  }

  // Prefer measured throughput: it already accounts for whatever else the GPU
  // is doing, which a fixed per-job cost cannot. Falls back to the constant
  // only when the queue has completed nothing recently.
  private async estimateSeconds(position: number | null): Promise<number> {
    // Not waiting means it is in a worker right now — one job's worth left.
    const ahead = position === null ? 0 : position - 1;

    const metrics = await this.jobRepository.getQueueMetrics(QueueName.Selfie, 15);
    const completed = metrics.completed.reduce((sum, count) => sum + count, 0);

    const secondsPerJob =
      completed > 0
        ? (15 * 60) / completed
        : DEFAULT_SECONDS_PER_SELFIE / QUEUE_CONCURRENCY[QueueName.Selfie];

    // Never show zero — "0s remaining" next to a spinner reads as stuck.
    return Math.max(5, Math.round((ahead + 1) * secondsPerJob));
  }
}
