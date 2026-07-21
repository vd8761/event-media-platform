// BullMQ's read helpers can return holes. `getJobs`/`getActive`/`getFailed`
// read a list of ids and then fetch each job hash separately; a job that
// completes (or is trimmed by removeOnComplete) in between yields `undefined`
// in the result array. Active and failed jobs are precisely the ones churning,
// so this is not a rare race — it 500s /api/admin/jobs and /api/admin/gpu,
// both of which the admin panel polls every five seconds.
import { JobRepository } from 'src/repositories/job.repository';
import { describe, expect, it } from 'vitest';

// Only the queue accessor matters here, so the repository is built bare and
// its private getQueue is replaced. Constructing the real DI graph would test
// Nest, not the hole-handling this is about.
const build = (jobs: unknown[]) => {
  const repository = Object.create(JobRepository.prototype) as JobRepository;
  const queue = {
    getJobs: async () => jobs,
    getActive: async () => jobs,
    getFailed: async () => jobs,
  };
  (repository as unknown as { getQueue: () => unknown }).getQueue = () => queue;
  return repository;
};

const real = { id: '1', name: 'faceDetection', data: {}, processedOn: 1_000, finishedOn: 2_000 };

describe('reading queues that are changing underneath us', () => {
  it('ignores holes when finding the oldest active job', async () => {
    const repository = build([undefined, real, undefined]);
    await expect(repository.getOldestActiveTimestamp('faceDetection' as never)).resolves.toBe(1_000);
  });

  it('returns undefined when every active entry has vanished', async () => {
    // Not an error: the queue drained mid-read. Reporting "no active job" is
    // correct, and the GPU sweep treats it as an empty queue.
    const repository = build([undefined, undefined]);
    await expect(repository.getOldestActiveTimestamp('faceDetection' as never)).resolves.toBeUndefined();
  });

  it('drops holes from the active job list rather than throwing', async () => {
    const repository = build([undefined, real]);
    const active = await repository.getActiveJobs('faceDetection' as never);

    expect(active).toHaveLength(1);
    expect(active[0].startedAt).toBe(1_000);
  });

  it('drops holes from the failed job list', async () => {
    const repository = build([real, undefined]);
    await expect(repository.getFailedJobs('faceDetection' as never)).resolves.toHaveLength(1);
  });

  it('does not match a hole when locating a waiting job', async () => {
    // The matcher reads job.data; a hole here would break the guest-facing
    // "you are Nth in line" progress display.
    const repository = build([undefined, { ...real, data: { assetId: 'a' } }]);
    const position = await repository.getWaitingPosition('faceDetection' as never, (data) => data.assetId === 'a');

    expect(position).toBe(2);
  });
});
