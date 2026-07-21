// The idle hold pauses the one safeguard that stops a per-second GPU bill, so
// its edges are worth pinning: it must be absolute rather than additive, it
// must not start a stopped box, and clearing it must genuinely hand control
// back to the idle policy.
import { GpuLifecycleService } from 'src/services/gpu-lifecycle.service';
import { GPU_LIFECYCLE_INITIAL } from 'src/repositories/system-config.repository';
import { describe, expect, it, vi } from 'vitest';

const build = (initial = {}) => {
  let state = { ...GPU_LIFECYCLE_INITIAL, ...initial };
  const audits: { action: string; detail?: unknown; userId?: string | null }[] = [];
  const providerCalls: string[] = [];

  const systemConfigRepository = {
    getGpuLifecycleState: async () => state,
    setGpuLifecycleState: async (next: typeof state) => {
      state = next;
    },
    getGpuAutostartConfig: async () => ({ idleShutdownMinutes: 10, provider: 'jarvislabs' }),
  };

  const service = new GpuLifecycleService(
    { record: async (entry: any) => void audits.push(entry) } as never,
    {
      // Any call here would mean we tried to start or stop the machine.
      resume: async () => providerCalls.push('resume'),
      pause: async () => providerCalls.push('pause'),
      isConfigured: () => true,
    } as never,
    {} as never,
    { setContext: () => undefined, log: () => undefined, warn: () => undefined, error: () => undefined } as never,
    systemConfigRepository as never,
    {} as never,
  );

  return { service, audits, providerCalls, current: () => state };
};

describe('gpu idle hold', () => {
  it('sets a deadline the configured minutes out', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T12:00:00Z'));

    const { service, current } = build();
    await service.holdIdle(60, 'user-1');

    expect(current().holdUntil).toBe('2026-07-21T13:00:00.000Z');
    vi.useRealTimers();
  });

  it('is absolute, not additive — renewing twice is still one hour out', async () => {
    // A button whose effect depends on click count is how someone ends up
    // paying for an idle GPU overnight.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T12:00:00Z'));

    const { service, current } = build();
    await service.holdIdle(60, 'user-1');
    vi.setSystemTime(new Date('2026-07-21T12:10:00Z'));
    await service.holdIdle(60, 'user-1');

    expect(current().holdUntil).toBe('2026-07-21T13:10:00.000Z');
    vi.useRealTimers();
  });

  it('never starts a stopped box', async () => {
    // "Do not shut down" is a different request from "turn on", and only one of
    // them begins billing.
    const { service, providerCalls, current } = build({ state: 'off' });
    await service.holdIdle(60, 'user-1');

    expect(providerCalls).toEqual([]);
    expect(current().state).toBe('off');
  });

  it('clearing hands the box back to the idle policy', async () => {
    const { service, current } = build({ state: 'running', holdUntil: '2026-07-21T13:00:00.000Z' });
    await service.clearHold('user-1');

    expect(current().holdUntil).toBeNull();
    // Still running — clearing a hold is not a stop, it just stops protecting
    // the box from the next sweep.
    expect(current().state).toBe('running');
  });

  it('records both actions against the user who made them', async () => {
    const { service, audits } = build();
    await service.holdIdle(60, 'user-1');
    await service.clearHold('user-2');

    expect(audits.map((entry) => entry.action)).toEqual(['gpu.hold.set', 'gpu.hold.cleared']);
    expect(audits[0].userId).toBe('user-1');
    expect(audits[1].userId).toBe('user-2');
  });

  it('preserves the rest of the lifecycle state', async () => {
    // machineId in particular: losing it would leave a running box that the
    // next pause cannot target.
    const { service, current } = build({ state: 'running', machineId: '452218', lastStartedAt: 'x' });
    await service.holdIdle(60, 'user-1');

    expect(current().machineId).toBe('452218');
    expect(current().lastStartedAt).toBe('x');
  });
});
