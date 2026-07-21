// Audit trail behind the super-admin Logs tab.
//
// The motivating case is the GPU box: it is billed by the second and started
// and stopped by an automated sweep, so "why did it come up at 3am" and "why
// did it not shut down" are questions that must be answerable after the fact.
// Failures matter as much as successes here — a provider call that errored is
// exactly the case where the box may still be running and billing.
//
// Writes never throw. An audit trail that can break the thing it observes is
// worse than one with a gap: refusing to stop a GPU because logging the stop
// failed would turn a logging bug into a bill.
import { Injectable } from '@nestjs/common';
import { OnJob } from 'src/decorators';
import {
  AUDIT_DEFAULT_RETENTION,
  AuditCategory,
  AuditLevel,
  AuditRetention,
  JobName,
  JobStatus,
  QueueName,
} from 'src/enum';
import { AuditLogRepository, AuditQuery } from 'src/repositories/audit-log.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuditEntry {
  category: AuditCategory;
  action: string;
  message: string;
  level?: AuditLevel;
  // Overrides the category default. Used sparingly — a deliberate decision to
  // keep or drop one specific event, not a general escape hatch.
  retention?: AuditRetention;
  detail?: unknown;
  orgId?: string | null;
  userId?: string | null;
}

@Injectable()
export class AuditLogService {
  constructor(
    private auditLogRepository: AuditLogRepository,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(AuditLogService.name);
  }

  // Fire-and-forget by design: callers are in the middle of doing something
  // real, and none of them should be able to fail because of this table.
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.auditLogRepository.create({
        category: entry.category,
        action: entry.action,
        message: entry.message,
        level: entry.level ?? AuditLevel.Info,
        retention: entry.retention ?? AUDIT_DEFAULT_RETENTION[entry.category],
        detail: entry.detail === undefined ? null : entry.detail,
        orgId: entry.orgId ?? null,
        userId: entry.userId ?? null,
      });
    } catch (error) {
      // Deliberately only to the process log — recursing into the audit table
      // to report that the audit table is broken goes nowhere good.
      this.logger.warn(`Failed to write audit entry ${entry.category}/${entry.action}: ${error}`);
    }
  }

  // Convenience for the overwhelmingly common failure shape, so callers do not
  // each invent their own way of flattening an unknown error.
  async recordError(entry: Omit<AuditEntry, 'level'> & { error: unknown }): Promise<void> {
    const { error, ...rest } = entry;
    await this.record({
      ...rest,
      level: AuditLevel.Error,
      detail: {
        ...(typeof rest.detail === 'object' && rest.detail !== null ? rest.detail : {}),
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }

  list(query: AuditQuery) {
    return this.auditLogRepository.list(query);
  }

  async getSummary() {
    const [total, byRetention, oldest] = await Promise.all([
      this.auditLogRepository.total(),
      this.auditLogRepository.countByRetention(),
      this.auditLogRepository.getOldest(),
    ]);

    return {
      total,
      oldest,
      byRetention: {
        [AuditRetention.SameDay]: byRetention[AuditRetention.SameDay] ?? 0,
        [AuditRetention.ThirtyDays]: byRetention[AuditRetention.ThirtyDays] ?? 0,
        [AuditRetention.Never]: byRetention[AuditRetention.Never] ?? 0,
      },
    };
  }

  // Manual flush. Omitting `retention` clears everything, which is the only
  // route by which a never-delete row is ever removed — so the flush itself is
  // recorded, immediately, as a never-delete row. The new entry survives the
  // delete because it is written after it.
  async flush(retention: AuditRetention | undefined, userId: string): Promise<number> {
    const removed = await this.auditLogRepository.flush(retention);

    await this.record({
      category: AuditCategory.Retention,
      action: 'audit.flush',
      level: AuditLevel.Warning,
      message: retention
        ? `Manually flushed ${removed} "${retention}" audit entries`
        : `Manually flushed all ${removed} audit entries, including never-delete`,
      detail: { retention: retention ?? 'all', removed },
      userId,
    });

    return removed;
  }

  // Daily. Same-day rows go at midnight, thirty-day rows at their cutoff, and
  // never-delete rows are untouched — only `flush` removes those.
  @OnJob({ name: JobName.AuditRetentionSweep, queue: QueueName.StorageCleanup })
  async handleAuditRetentionSweep(): Promise<JobStatus> {
    const now = Date.now();

    // Midnight today: anything written yesterday or earlier is gone. Using a
    // day boundary rather than "24h ago" is what makes this a *same-day*
    // policy — an entry written at 23:59 does not survive until tomorrow noon.
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const [sameDay, thirtyDays] = await Promise.all([
      this.auditLogRepository.deleteOlderThan(AuditRetention.SameDay, startOfToday),
      this.auditLogRepository.deleteOlderThan(AuditRetention.ThirtyDays, new Date(now - THIRTY_DAYS_MS)),
    ]);

    if (sameDay + thirtyDays > 0) {
      this.logger.log(`Audit sweep removed ${sameDay} same-day and ${thirtyDays} thirty-day entries`);
    }

    return JobStatus.Success;
  }
}
