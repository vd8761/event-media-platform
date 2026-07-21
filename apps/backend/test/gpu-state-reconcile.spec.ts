// The most expensive state this system can reach is "instance running, app
// thinks it is off": the stop path only fires for state === 'running', so
// nothing ever shuts it down and it bills until somebody reads the invoice.
// Seen in production — the panel showed `off` while `jl resume` reported
// "Can only resume a Paused instance (current status: Running)".
import { GPU_LIFECYCLE_INITIAL } from 'src/repositories/system-config.repository';
import { GpuLifecycleService } from 'src/services/gpu-lifecycle.service';
import { describe, expect, it } from 'vitest';

const build = (options: { providerStatus?: string; state?: string; resumeThrows?: boolean }) => {
  const { providerStatus = 'Paused', state: initial = 'off', resumeThrows = false } = options;
  let state: any = { ...GPU_LIFECYCLE_INITIAL, state: initial, machineId: '452265' };
  const audits: { action: string }[] = [];
  const calls: string[] = [];

  const service = new GpuLifecycleService(
    { record: async (entry: any) => void audits.push(entry) } as never,
    {
      isConfigured: () => true,
      get: async () => {
        calls.push('get');
        return { machineId: '452265', status: providerStatus };
      },
      resume: async () => {
        calls.push('resume');
        if (resumeThrows) {
          throw new Error('Can only resume a Paused instance (current status: Running)');
        }
        return { machineId: '452265' };
      },
      pause: async () => void calls.push('pause'),
    } as never,
    {
      getJobCounts: async () => ({ waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0, paused: 0 }),
      getOldestWaitingTimestamp: async () => undefined,
      getOldestActiveTimestamp: async () => undefined,
    } as never,
    { setContext: () => undefined, log: () => undefined, warn: () => undefined, error: () => undefined } as never,
    {
      getGpuLifecycleState: async () => state,
      setGpuLifecycleState: async (next: any) => {
        state = next;
      },
      getGpuAutostartConfig: async () => ({
        enabled: true,
        provider: 'jarvislabs',
        jarvislabsMachineId: '452265',
        jarvislabsGpuType: '',
        idleShutdownMinutes: 10,
        startTimeoutMinutes: 20,
        pendingThreshold: 25,
        maxPendingAgeMinutes: 120,
      }),
    } as never,
    { getInstances: async () => [] } as never,
  );

  return { service, audits, calls, current: () => state };
};

describe('reconciling a believed-off box against the provider', () => {
  it('adopts an instance the provider reports as running', async () => {
    const { service, current, audits } = build({ providerStatus: 'Running' });
    await service.handleGpuLifecycleSweep();

    // 'starting' rather than 'running': the worker may not be up. From here the
    // existing start-timeout stops it if it never reports in.
    expect(current().state).toBe('starting');
    expect(audits.map((entry) => entry.action)).toContain('gpu.state.reconciled');
  });

  it('leaves a genuinely paused instance alone', async () => {
    const { service, current, audits } = build({ providerStatus: 'Paused' });
    await service.handleGpuLifecycleSweep();

    expect(current().state).toBe('off');
    expect(audits.map((entry) => entry.action)).not.toContain('gpu.state.reconciled');
  });

  it('throttles the provider check rather than spawning the CLI every sweep', async () => {
    // The sweep runs every two minutes and a paused box is the resting state,
    // so an unthrottled check would run the CLI hundreds of times a day.
    const { service, calls } = build({ providerStatus: 'Paused' });
    await service.handleGpuLifecycleSweep();
    await service.handleGpuLifecycleSweep();
    await service.handleGpuLifecycleSweep();

    expect(calls.filter((call) => call === 'get')).toHaveLength(1);
  });
});

describe('starting a box that is already up', () => {
  it('adopts it instead of calling resume', async () => {
    // `jl resume` rejects a Running instance. Treating that as an error left the
    // app recorded as off while the machine billed on.
    const { service, calls, current } = build({ providerStatus: 'Running' });
    await service.startNow('manual');

    expect(calls).toContain('get');
    expect(calls).not.toContain('resume');
    expect(current().lastError).toBeNull();
  });

  it('still resumes a paused instance', async () => {
    const { service, calls } = build({ providerStatus: 'Paused' });
    await service.startNow('manual');

    expect(calls).toContain('resume');
  });
});
