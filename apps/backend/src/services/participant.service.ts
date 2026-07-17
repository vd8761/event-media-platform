// M4 (docs/plan/07-participant-flow.md): SelfieProcess (ML embed + inline
// match on the GPU worker), face-level matchParticipant() shared with the
// debounced ParticipantRematch and the 15-min ParticipantMatchSweep cron
// (Decision D6 — never cluster-level, risk R3).
import { Injectable } from '@nestjs/common';
import { OnJob } from 'src/decorators';
import { JobName, JobStatus, QueueName } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { JobOf } from 'src/types';

@Injectable()
export class ParticipantService {
  constructor(private logger: LoggingRepository) {
    this.logger.setContext(ParticipantService.name);
  }

  @OnJob({ name: JobName.SelfieProcess, queue: QueueName.Selfie })
  async handleSelfieProcess({ participantId }: JobOf<JobName.SelfieProcess>): Promise<JobStatus> {
    this.logger.warn(`SelfieProcess not implemented yet (M4) — participant ${participantId}`);
    return JobStatus.Skipped;
  }

  @OnJob({ name: JobName.ParticipantRematch, queue: QueueName.Match })
  async handleParticipantRematch({ eventId }: JobOf<JobName.ParticipantRematch>): Promise<JobStatus> {
    this.logger.warn(`ParticipantRematch not implemented yet (M4) — event ${eventId}`);
    return JobStatus.Skipped;
  }

  @OnJob({ name: JobName.ParticipantMatchSweep, queue: QueueName.Match })
  async handleParticipantMatchSweep(): Promise<JobStatus> {
    this.logger.debug('ParticipantMatchSweep not implemented yet (M4)');
    return JobStatus.Skipped;
  }

  @OnJob({ name: JobName.SelfieRetentionSweep, queue: QueueName.StorageCleanup })
  async handleSelfieRetentionSweep(): Promise<JobStatus> {
    this.logger.debug('SelfieRetentionSweep not implemented yet (M4)');
    return JobStatus.Skipped;
  }
}
