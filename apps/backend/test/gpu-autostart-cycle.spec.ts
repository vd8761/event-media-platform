// Does the box actually start when work arrives and stop when it runs out?
// Both halves cost money when wrong — one leaves photos unprocessed, the other
// leaves a GPU billing — so the whole cycle is pinned here rather than trusted.
import { GPU_LIFECYCLE_INITIAL } from 'src/repositories/system-config.repository';
import { GpuLifecycleService } from 'src/services/gpu-lifecycle.service';
import { describe, expect, it } from 'vitest';

const MINUTE = 60_000;

const build = (options: {
  state?: string;
  waiting?: number;
  oldestWaitingMinutes?: number;
  workerOnline?: boolean;
  idleSinceMinutesAgo?: number | null;
  sinceMinutesAgo?: number;
  pendingThreshold?: number;
  idleShutdownMinutes?: number;
  enabled?: boolean;
}) => {
  const {
    state: initial = 'off',
    waiting = 0,
    oldestWaitingMinutes = 0,
    workerOnline = false,
    idleSinceMinutesAgo = null,
    sinceMinutesAgo = 60,
    pendingThreshold = 25,
    idleShutdownMinutes = 10,
    enabled = true,
  } = options;

  let state: any = {
    ...GPU_LIFECYCLE_INITIAL,
    state: initial,
    machineId: '452647',
    since: new Date(Date.now() - sinceMinutesAgo * MINUTE).toISOString(),
    idleSince: idleSinceMinutesAgo === null ? null : new Date(Date.now() - idleSinceMinutesAgo * MINUTE).toISOString(),
  };
  const calls: string[] = [];

  const service = new GpuLifecycleService(
    { record: async () => undefined } as never,
    {
      isConfigured: () => true,
      list: async () => [{ machineId: '452647', status: workerOnline ? 'Running' : 'Paused' }],
      get: async () => ({ machineId: '452647', status: workerOnline ? 'Running' : 'Paused' }),
      resume: async () => {
        calls.push('resume');
        return { machineId: '452647' };
      },
      pause: async () => void calls.push('pause'),
    } as never,
    {
      getJobCounts: async (queue: string) =>
        queue === 'faceDetection'
          ? { waiting, active: 0, delayed: 0, failed: 0, completed: 0, paused: 0 }
          : { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0, paused: 0 },
      getOldestWaitingTimestamp: async (queue: string) =>
        queue === 'faceDetection' && waiting > 0 ? Date.now() - oldestWaitingMinutes * MINUTE : undefined,
      getOldestActiveTimestamp: async () => undefined,
    } as never,
    { setContext: () => undefined, log: () => undefined, warn: () => undefined, error: () => undefined } as never,
    {
      getGpuLifecycleState: async () => state,
      setGpuLifecycleState: async (next: any) => {
        state = next;
      },
      getGpuAutostartConfig: async () => ({
        enabled,
        provider: 'jarvislabs',
        jarvislabsMachineId: '452647',
        jarvislabsGpuType: '',
        pendingThreshold,
        maxPendingAgeMinutes: 120,
        idleShutdownMinutes,
        startTimeoutMinutes: 20,
      }),
    } as never,
    { getInstances: async () => (workerOnline ? [{ roles: ['media'] }] : []) } as never,
  );

  return { service, calls, current: () => state };
};

describe('starting when work is queued', () => {
  it('starts once the queue reaches the threshold', async () => {
    const { service, calls } = build({ state: 'off', waiting: 30 });
    await service.handleGpuLifecycleSweep();

    expect(calls).toContain('resume');
  });

  it('does not start for a handful of jobs below the threshold', async () => {
    // Deliberate: booting a GPU for two photos costs more than the wait.
    const { service, calls } = build({ state: 'off', waiting: 2, oldestWaitingMinutes: 1 });
    await service.handleGpuLifecycleSweep();

    expect(calls).not.toContain('resume');
  });

  it('rescues a small batch once it has waited long enough', async () => {
    // The age rule is what stops two photos sitting below the threshold forever.
    const { service, calls } = build({ state: 'off', waiting: 2, oldestWaitingMinutes: 125 });
    await service.handleGpuLifecycleSweep();

    expect(calls).toContain('resume');
  });

  it('does nothing at all when autostart is disabled', async () => {
    const { service, calls } = build({ state: 'off', waiting: 500, enabled: false });
    await service.handleGpuLifecycleSweep();

    expect(calls).toEqual([]);
  });
});

describe('stopping when the queues are empty', () => {
  it('starts the idle clock on the first empty sweep rather than stopping at once', async () => {
    // The bug this replaced measured idle from when the box *started*, so a box
    // that had been up longer than the window stopped the instant it drained —
    // no grace at all, and a restart costs boot time plus a model reload.
    const { service, calls, current } = build({
      state: 'running',
      workerOnline: true,
      waiting: 0,
      sinceMinutesAgo: 60,
      idleSinceMinutesAgo: null,
    });
    await service.handleGpuLifecycleSweep();

    expect(calls).not.toContain('pause');
    expect(current().idleSince).not.toBeNull();
  });

  it('stops once the idle window has actually elapsed', async () => {
    const { service, calls } = build({
      state: 'running',
      workerOnline: true,
      waiting: 0,
      idleSinceMinutesAgo: 11,
      idleShutdownMinutes: 10,
    });
    await service.handleGpuLifecycleSweep();

    expect(calls).toContain('pause');
  });

  it('does not stop part-way through the idle window', async () => {
    const { service, calls } = build({
      state: 'running',
      workerOnline: true,
      waiting: 0,
      idleSinceMinutesAgo: 4,
      idleShutdownMinutes: 10,
    });
    await service.handleGpuLifecycleSweep();

    expect(calls).not.toContain('pause');
  });

  it('clears the idle clock when work arrives during the window', async () => {
    // Otherwise a lull followed by a new batch would stop the box mid-work.
    const { service, calls, current } = build({
      state: 'running',
      workerOnline: true,
      waiting: 5,
      idleSinceMinutesAgo: 9,
    });
    await service.handleGpuLifecycleSweep();

    expect(current().idleSince).toBeNull();
    expect(calls).not.toContain('pause');
  });

  it('respects a manual hold past the idle window', async () => {
    const { service, calls, current } = build({
      state: 'running',
      workerOnline: true,
      waiting: 0,
      idleSinceMinutesAgo: 30,
    });
    (current() as any).holdUntil = new Date(Date.now() + 30 * MINUTE).toISOString();
    await service.handleGpuLifecycleSweep();

    expect(calls).not.toContain('pause');
  });
});
