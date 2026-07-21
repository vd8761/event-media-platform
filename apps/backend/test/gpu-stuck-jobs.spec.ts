// A job left "active" in Redis by a worker that vanished mid-batch used to
// report as in-flight forever, and `active > 0` is what holds the GPU box up.
// One orphan therefore pinned a per-second-billed machine online indefinitely —
// the exact runaway the autoshutdown exists to prevent. These pin the boundary.
import { GPU_LIFECYCLE_INITIAL } from 'src/repositories/system-config.repository';
import { GpuLifecycleService } from 'src/services/gpu-lifecycle.service';
import { describe, expect, it } from 'vitest';

const MINUTE = 60_000;

const build = (queue: { waiting?: number; active?: number; activeAgeMinutes?: number }) => {
  const { waiting = 0, active = 0, activeAgeMinutes = 0 } = queue;
  const audits: { action: string }[] = [];

  const service = new GpuLifecycleService(
    { record: async (entry: any) => void audits.push(entry) } as never,
    { isConfigured: () => true } as never,
    {
      getJobCounts: async () => ({ waiting, active, delayed: 0, failed: 0, completed: 0, paused: 0 }),
      getOldestWaitingTimestamp: async () => (waiting > 0 ? Date.now() - MINUTE : undefined),
      getOldestActiveTimestamp: async () => (active > 0 ? Date.now() - activeAgeMinutes * MINUTE : undefined),
    } as never,
    { setContext: () => undefined, log: () => undefined, warn: () => undefined, error: () => undefined } as never,
    {
      getGpuLifecycleState: async () => ({ ...GPU_LIFECYCLE_INITIAL, state: 'running' }),
      setGpuLifecycleState: async () => undefined,
      getGpuAutostartConfig: async () => ({ idleShutdownMinutes: 10, provider: 'jarvislabs' }),
    } as never,
    {} as never,
  );

  return { service, audits };
};

describe('stuck active jobs must not hold the GPU box up', () => {
  it('keeps the box alive for a genuinely running job', async () => {
    // Two minutes in is normal work. Killing the box here would throw away the
    // GPU seconds already spent and force a retry.
    const { service } = build({ active: 1, activeAgeMinutes: 2 });
    const result = await service.heartbeat();

    expect(result.keepAlive).toBe(true);
    expect(result.reason).toContain('in flight');
  });

  it('stops treating an hour-old active job as in flight', async () => {
    // The reported case: "2 active" unchanged for an hour on a queue whose jobs
    // take seconds.
    const { service } = build({ active: 2, activeAgeMinutes: 60 });
    const result = await service.heartbeat();

    expect(result.keepAlive).toBe(false);
  });

  it('records the orphans so the bill has an explanation', async () => {
    const { service, audits } = build({ active: 2, activeAgeMinutes: 60 });
    await service.heartbeat();

    expect(audits.map((entry) => entry.action)).toContain('gpu.jobs.stuck');
  });

  it('excludes orphans from pending, so queue depth is not inflated', async () => {
    // pending drives the wake decision too — counting phantoms there would
    // restart a box that has nothing to do.
    const { service } = build({ active: 3, activeAgeMinutes: 90 });
    const result = await service.heartbeat();

    expect(result.pending).toBe(0);
  });

  it('still keeps the box up for real waiting work alongside orphans', async () => {
    // An orphan must not mask genuine queued work sitting behind it.
    const { service } = build({ waiting: 5, active: 1, activeAgeMinutes: 90 });
    const result = await service.heartbeat();

    expect(result.keepAlive).toBe(true);
    expect(result.reason).toContain('queued');
  });

  it('treats just under the threshold as still running', async () => {
    // 30 minutes is the line; a long video transcode legitimately sits near it,
    // and cutting the box off mid-encode wastes the work already done.
    const { service } = build({ active: 1, activeAgeMinutes: 29 });
    expect((await service.heartbeat()).keepAlive).toBe(true);
  });
});
