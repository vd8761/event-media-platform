// Super-admin platform surface: stats + BullMQ queue dashboard
// (docs/plan/09-api-surface.md §Super admin; Immich queue-status pattern).
import { BadRequestException, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { QueueCleanType, QueueName } from 'src/enum';
import { JobRepository } from 'src/repositories/job.repository';
import { DB } from 'src/schema';
import { JobCounts } from 'src/types';

export type QueueAction = 'pause' | 'resume' | 'clear-failed' | 'retry-failed';

@Injectable()
export class AdminService {
  constructor(
    @InjectKysely() private db: Kysely<DB>,
    private jobRepository: JobRepository,
  ) {}

  async getStats() {
    const [row] = await this.db
      .selectNoFrom((eb) => [
        eb.selectFrom('organization').where('deletedAt', 'is', null).select(sql<number>`count(*)::int`.as('count')).as('organizations'),
        eb.selectFrom('user').where('deletedAt', 'is', null).select(sql<number>`count(*)::int`.as('count')).as('users'),
        eb.selectFrom('event').where('deletedAt', 'is', null).select(sql<number>`count(*)::int`.as('count')).as('events'),
        eb.selectFrom('asset').where('deletedAt', 'is', null).select(sql<number>`count(*)::int`.as('count')).as('assets'),
        eb.selectFrom('asset').where('deletedAt', 'is', null).select(sql<number>`coalesce(sum(file_size), 0)::bigint`.as('sum')).as('storageBytes'),
        eb.selectFrom('participant').where('deletedAt', 'is', null).select(sql<number>`count(*)::int`.as('count')).as('participants'),
      ])
      .execute();
    return row;
  }

  async getQueues(): Promise<Record<string, JobCounts & { isPaused: boolean }>> {
    const result: Record<string, JobCounts & { isPaused: boolean }> = {};
    await Promise.all(
      Object.values(QueueName).map(async (name) => {
        const [counts, isPaused] = await Promise.all([
          this.jobRepository.getJobCounts(name),
          this.jobRepository.isPaused(name),
        ]);
        result[name] = { ...counts, isPaused };
      }),
    );
    return result;
  }

  async runQueueAction(name: string, action: QueueAction): Promise<void> {
    if (!Object.values(QueueName).includes(name as QueueName)) {
      throw new BadRequestException(`Unknown queue: ${name}`);
    }
    const queue = name as QueueName;

    switch (action) {
      case 'pause': {
        await this.jobRepository.pause(queue);
        break;
      }
      case 'resume': {
        await this.jobRepository.resume(queue);
        break;
      }
      case 'clear-failed': {
        await this.jobRepository.clear(queue, QueueCleanType.Failed);
        break;
      }
      case 'retry-failed': {
        await this.jobRepository.retryFailed(queue);
        break;
      }
      default: {
        throw new BadRequestException(`Unknown action: ${action}`);
      }
    }
  }
}
