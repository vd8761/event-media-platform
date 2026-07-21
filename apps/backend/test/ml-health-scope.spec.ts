// The admin panel reported "unreachable" for the ML sidecar on a healthy
// production deployment, because an api/ingest host was pinging an endpoint it
// is not on the network for and never calls. A dashboard that is permanently
// red for a correct deployment trains people to ignore it, so this pins which
// processes probe at all.
import { QueueName, WorkerRole } from 'src/enum';
import { AdminService } from 'src/services/admin.service';
import { describe, expect, it } from 'vitest';

const build = (workers: WorkerRole[], includedQueues: QueueName[] = []) => {
  let probed = false;

  const service = new AdminService(
    {} as never,
    // audit — queue actions record themselves; irrelevant to ML scoping.
    { record: async () => undefined } as never,
    {
      getEnv: () => ({
        workers,
        includedQueues,
        machineLearning: { device: 'cpu' },
        database: { vectorExtension: 'pgvector' },
      }),
    } as never,
    {} as never,
    {
      getServerStatus: async () => {
        probed = true;
        return [{ url: 'http://ml:3003', healthy: false, latencyMs: null }];
      },
    } as never,
    {} as never,
    { getInstances: async () => [] } as never,
  );

  // getSystemStatus reads a database version; stub it so the test stays about
  // ML scoping rather than needing a live Postgres.
  (service as unknown as { getDatabaseVersion: () => Promise<string> }).getDatabaseVersion = async () => 'test';

  return { service, didProbe: () => probed };
};

describe('machine-learning health is only probed where it means something', () => {
  it('does not probe from an api/ingest host', async () => {
    // Render's shape. It reaches ML never; `http://ml:3003` is compose DNS on
    // the GPU box, so a failed ping here says nothing about system health.
    const { service, didProbe } = build([WorkerRole.Api, WorkerRole.Ingest]);
    const status = await service.getSystemStatus();

    expect(didProbe()).toBe(false);
    expect(status.machineLearning.usedByThisProcess).toBe(false);
    expect(status.machineLearning.servers).toEqual([]);
  });

  it('probes from a media worker', async () => {
    // The GPU box: it is on the same compose network as its sidecar, so here
    // the health check is real and a failure is worth showing.
    const { service, didProbe } = build([WorkerRole.Media]);
    const status = await service.getSystemStatus();

    expect(didProbe()).toBe(true);
    expect(status.machineLearning.usedByThisProcess).toBe(true);
    expect(status.machineLearning.servers).toHaveLength(1);
  });

  it('probes from an api host that took the selfie queue', async () => {
    // deploy docs §10: EL_QUEUES_INCLUDE=selfie means this process embeds
    // selfies itself, so it does have a real ML dependency to report on.
    const { service, didProbe } = build([WorkerRole.Api, WorkerRole.Ingest], [QueueName.Selfie]);
    const status = await service.getSystemStatus();

    expect(didProbe()).toBe(true);
    expect(status.machineLearning.usedByThisProcess).toBe(true);
  });
});
