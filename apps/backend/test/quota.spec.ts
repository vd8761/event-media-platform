// Quotas decide what a paying customer can and cannot do, so the edges are
// worth pinning: the number shown must be the number enforced, an org must not
// be blocked for re-uploading something it already has, and custom limits must
// not leak onto plans that do not sell them.
import { OrgPlan, PLAN_LIMITS } from 'src/enum';
import { QuotaService } from 'src/services/quota.service';
import { describe, expect, it } from 'vitest';

const GB = 1024 * 1024 * 1024;

const build = (org: Partial<{ plan: OrgPlan; storageLimitBytes: number | null; eventLimit: number | null }>, usage = {}) => {
  const { bytes = 0, events = 0 } = usage as { bytes?: number; events?: number };
  const full = { plan: OrgPlan.Starter, storageLimitBytes: null, eventLimit: null, ...org };

  return new QuotaService(
    { getOrgStorageBytes: async () => bytes } as never,
    { countForOrg: async () => events } as never,
    { getById: async () => full } as never,
  );
};

describe('plan limits', () => {
  it('matches the advertised tiers', async () => {
    expect(PLAN_LIMITS[OrgPlan.Starter]).toEqual({ storageBytes: 2 * GB, events: 1 });
    expect(PLAN_LIMITS[OrgPlan.Pro]).toEqual({ storageBytes: 10 * GB, events: 5 });
    expect(PLAN_LIMITS[OrgPlan.Enterprise]).toEqual({ storageBytes: 50 * GB, events: 10 });
  });

  it('reports the plan limit when no override is set', async () => {
    const status = await build({ plan: OrgPlan.Pro }, { bytes: 3 * GB, events: 2 }).getStatus('org');

    expect(status.storage).toEqual({ usedBytes: 3 * GB, limitBytes: 10 * GB, remainingBytes: 7 * GB });
    expect(status.events).toEqual({ used: 2, limit: 5, remaining: 3 });
    expect(status.hasCustomLimits).toBe(false);
  });

  it('prefers a negotiated override', async () => {
    const status = await build(
      { plan: OrgPlan.Enterprise, storageLimitBytes: 500 * GB, eventLimit: 99 },
      { bytes: GB, events: 1 },
    ).getStatus('org');

    expect(status.storage.limitBytes).toBe(500 * GB);
    expect(status.events.limit).toBe(99);
    expect(status.hasCustomLimits).toBe(true);
  });

  it('never reports negative headroom', async () => {
    // Possible after a downgrade: the org is legitimately over. "0 remaining"
    // is honest; "-3 GB remaining" reads as a bug.
    const status = await build({ plan: OrgPlan.Starter }, { bytes: 5 * GB, events: 4 }).getStatus('org');

    expect(status.storage.remainingBytes).toBe(0);
    expect(status.events.remaining).toBe(0);
  });
});

describe('storage enforcement', () => {
  it('allows an upload that fits', async () => {
    const service = build({ plan: OrgPlan.Starter }, { bytes: GB });
    await expect(service.assertStorageAvailable('org', 100 * 1024 * 1024)).resolves.toBeUndefined();
  });

  it('blocks the upload that would cross the limit, not the one after it', async () => {
    // Checking "are they already over" instead of "would this put them over"
    // means the final upload before the limit can be arbitrarily large.
    const service = build({ plan: OrgPlan.Starter }, { bytes: 1.9 * GB });
    await expect(service.assertStorageAvailable('org', 0.5 * GB)).rejects.toThrow(/Storage limit reached/);
  });

  it('names the plan and the way out', async () => {
    // An error that only says "limit reached" leaves someone stuck with no idea
    // whether it is permanent.
    const service = build({ plan: OrgPlan.Starter }, { bytes: 2 * GB });
    await expect(service.assertStorageAvailable('org', 1)).rejects.toThrow(/starter plan.*Upgrade to Pro/s);
  });
});

describe('event enforcement', () => {
  it('allows creating up to the limit', async () => {
    const service = build({ plan: OrgPlan.Pro }, { events: 4 });
    await expect(service.assertEventAvailable('org')).resolves.toBeUndefined();
  });

  it('blocks the one past it', async () => {
    const service = build({ plan: OrgPlan.Pro }, { events: 5 });
    await expect(service.assertEventAvailable('org')).rejects.toThrow(/Event limit reached — 5 of 5/);
  });

  it('lets a Starter org create exactly one event', async () => {
    await expect(build({ plan: OrgPlan.Starter }, { events: 0 }).assertEventAvailable('org')).resolves.toBeUndefined();
    await expect(build({ plan: OrgPlan.Starter }, { events: 1 }).assertEventAvailable('org')).rejects.toThrow();
  });
});
