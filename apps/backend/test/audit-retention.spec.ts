// The retention sweep deletes rows nobody is watching, so a wrong boundary is
// silent data loss. These pin the two that matter: "same day" must mean the
// calendar day, not a rolling 24 hours, and "never" must survive the sweep
// entirely — only an explicit flush may remove it.
import { AuditCategory, AuditLevel, AuditRetention, AUDIT_DEFAULT_RETENTION } from 'src/enum';
import { AuditLogService } from 'src/services/audit-log.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Deletion {
  retention: AuditRetention;
  cutoff: Date;
}

const build = () => {
  const deletions: Deletion[] = [];
  const created: Record<string, unknown>[] = [];

  const repository = {
    create: async (entry: Record<string, unknown>) => {
      created.push(entry);
    },
    deleteOlderThan: async (retention: AuditRetention, cutoff: Date) => {
      deletions.push({ retention, cutoff });
      return 1;
    },
    flush: async () => 7,
    total: async () => 0,
    countByRetention: async () => ({}),
    getOldest: async () => null,
  };

  const logger = { setContext: () => undefined, log: () => undefined, warn: () => undefined };
  const service = new AuditLogService(repository as never, logger as never);

  return { service, deletions, created };
};

describe('audit retention sweep', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('treats same-day as the calendar boundary, not a rolling 24 hours', async () => {
    // 23:59 on a Tuesday. A rolling window would keep this row until Wednesday
    // night; the calendar rule drops it at midnight, which is what "delete the
    // same day" was asked for.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T23:59:00'));

    const { service, deletions } = build();
    await service.handleAuditRetentionSweep();

    const sameDay = deletions.find((entry) => entry.retention === AuditRetention.SameDay);
    expect(sameDay).toBeDefined();
    expect(sameDay!.cutoff.getHours()).toBe(0);
    expect(sameDay!.cutoff.getMinutes()).toBe(0);
    expect(sameDay!.cutoff.getDate()).toBe(21);

    vi.useRealTimers();
  });

  it('cuts thirty-day rows at exactly thirty days', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T12:00:00Z'));

    const { service, deletions } = build();
    await service.handleAuditRetentionSweep();

    const thirty = deletions.find((entry) => entry.retention === AuditRetention.ThirtyDays);
    expect(thirty!.cutoff.toISOString()).toBe('2026-06-21T12:00:00.000Z');

    vi.useRealTimers();
  });

  it('never touches never-delete rows', async () => {
    const { service, deletions } = build();
    await service.handleAuditRetentionSweep();

    expect(deletions.map((entry) => entry.retention)).not.toContain(AuditRetention.Never);
  });
});

describe('audit retention defaults', () => {
  it('keeps security-relevant categories forever', async () => {
    // "Who deleted this organisation" is the question the table exists for, and
    // a 30-day window answers it only by luck.
    for (const category of [AuditCategory.Auth, AuditCategory.Organization, AuditCategory.Event]) {
      expect(AUDIT_DEFAULT_RETENTION[category]).toBe(AuditRetention.Never);
    }
  });

  it('keeps GPU lifecycle for thirty days', async () => {
    expect(AUDIT_DEFAULT_RETENTION[AuditCategory.Gpu]).toBe(AuditRetention.ThirtyDays);
  });

  it('applies the category default when a caller does not choose', async () => {
    const { service, created } = build();
    await service.record({ category: AuditCategory.Gpu, action: 'gpu.start', message: 'up' });

    expect(created[0]).toMatchObject({ retention: AuditRetention.ThirtyDays, level: AuditLevel.Info });
  });
});

describe('audit writes never break their caller', () => {
  it('swallows a failed insert', async () => {
    // A GPU stop must not fail because logging the stop failed — that turns a
    // logging bug into a machine that keeps billing.
    const logger = { setContext: () => undefined, log: () => undefined, warn: () => undefined };
    const repository = {
      create: async () => {
        throw new Error('database is on fire');
      },
    };
    const service = new AuditLogService(repository as never, logger as never);

    await expect(
      service.record({ category: AuditCategory.Gpu, action: 'gpu.stop', message: 'down' }),
    ).resolves.toBeUndefined();
  });

  it('flattens an unknown error shape into the detail', async () => {
    const { service, created } = build();
    await service.recordError({
      category: AuditCategory.Gpu,
      action: 'gpu.stop.failed',
      message: 'pause failed',
      detail: { machineId: '452153' },
      error: new Error('timeout'),
    });

    expect(created[0]).toMatchObject({ level: AuditLevel.Error });
    expect(created[0].detail).toEqual({ machineId: '452153', error: 'timeout' });
  });
});

describe('manual flush', () => {
  it('records the flush itself, after the delete, so the entry survives', async () => {
    const { service, created } = build();
    const removed = await service.flush(undefined, 'user-1');

    expect(removed).toBe(7);
    // Written as never-delete: a full flush is exactly the kind of destructive
    // act the audit trail must retain.
    expect(created[0]).toMatchObject({
      category: AuditCategory.Retention,
      action: 'audit.flush',
      retention: AuditRetention.Never,
      userId: 'user-1',
    });
  });
});
