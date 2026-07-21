// The guest-facing progress view has two jobs and both are easy to get wrong
// silently: it must never promise a queue position the GPU box cannot honour,
// and its ticket must never become a way to read someone else's participant
// row. Both are pinned here with stubbed collaborators — no Redis, no GPU.
import { ParticipantStatus, QueueName } from 'src/enum';
import { SelfieProgressService } from 'src/services/selfie-progress.service';
import { describe, expect, it } from 'vitest';

// Real AES-GCM would need EL_TOKEN_ENCRYPTION_KEY plumbing; the contract this
// service depends on is just "round-trips, and throws on tampering", so the
// stub enforces exactly that.
const cipher = {
  encryptState: (payload: object) => Buffer.from(JSON.stringify(payload)).toString('base64url'),
  decryptState: <T>(state: string): T => {
    const decoded = Buffer.from(state, 'base64url').toString();
    if (!decoded.startsWith('{')) {
      throw new Error('bad ticket');
    }
    return JSON.parse(decoded) as T;
  },
};

const build = (options: {
  workerOnline?: boolean;
  pending?: number;
  status?: ParticipantStatus;
  participant?: boolean;
  position?: number | null;
  completedPerBucket?: number[];
  selfiesRunHere?: boolean;
}) => {
  const {
    workerOnline = true,
    pending = 3,
    status = ParticipantStatus.Processing,
    participant = true,
    position = 1,
    completedPerBucket = [],
    selfiesRunHere = false,
  } = options;

  const service = new SelfieProgressService(
    { getEnv: () => ({ includedQueues: selfiesRunHere ? [QueueName.Selfie] : [] }) } as never,
    cipher as never,
    { getStatus: async () => ({ workerOnline, pending }) } as never,
    {
      getWaitingPosition: async () => position,
      getQueueMetrics: async () => ({ completed: completedPerBucket, failed: [] }),
    } as never,
    {
      getById: async () => (participant ? { id: 'p1', status } : undefined),
      countMatches: async () => 7,
    } as never,
  );

  return service;
};

describe('selfie progress — when a live view is offered', () => {
  it('reports live position while the box is awake and keeping up', async () => {
    const service = build({ workerOnline: true, pending: 3, position: 4 });
    const result = await service.getProgress(service.issueTicket('p1'));

    expect(result.mode).toBe('live');
    expect(result).toMatchObject({ position: 4, status: ParticipantStatus.Processing });
  });

  it('falls back to email when the GPU worker is offline', async () => {
    // The box being off is the whole reason the email path exists: a cold start
    // is minutes, and a countdown across it would be fiction.
    const service = build({ workerOnline: false });
    expect(await service.getProgress(service.issueTicket('p1'))).toEqual({ mode: 'email' });
  });

  it('falls back to email once total GPU pending exceeds the cutoff', async () => {
    // Selfie queue may be nearly empty while an import floods facialRecognition
    // on the same GPU — total depth is what makes the estimate unreliable.
    const service = build({ pending: 101 });
    expect(await service.getProgress(service.issueTicket('p1'))).toEqual({ mode: 'email' });
  });

  it('ignores the GPU box entirely when this process runs the selfie queue', async () => {
    // deploy docs §10: selfie intake moved to Render with a CPU ML sidecar. The
    // GPU box being asleep is then irrelevant to how fast this guest is served.
    const service = build({ selfiesRunHere: true, workerOnline: false, pending: 9999, position: 2 });
    const result = await service.getProgress(service.issueTicket('p1'));

    expect(result).toMatchObject({ mode: 'live', position: 2 });
  });

  it('still reports a finished participant even on a loaded box', async () => {
    const service = build({ pending: 5000, status: ParticipantStatus.Matched });
    const result = await service.getProgress(service.issueTicket('p1'));

    expect(result).toMatchObject({ mode: 'live', status: ParticipantStatus.Matched, matchedCount: 7 });
  });
});

describe('selfie progress — ticket handling', () => {
  it('rejects a forged ticket without touching the database', async () => {
    const service = build({});
    expect(await service.getProgress('not-a-real-ticket')).toEqual({ mode: 'email' });
  });

  it('rejects an expired ticket', async () => {
    const service = build({});
    const stale = cipher.encryptState({ p: 'p1', exp: Date.now() - 1 });
    expect(await service.getProgress(stale)).toEqual({ mode: 'email' });
  });

  it('rejects a ticket whose participant no longer exists', async () => {
    const service = build({ participant: false });
    expect(await service.getProgress(service.issueTicket('gone'))).toEqual({ mode: 'email' });
  });
});

describe('selfie progress — estimates', () => {
  it('derives seconds-per-job from measured throughput', async () => {
    // 30 completed over the 15-minute window = 30s/job; 3rd in line means two
    // ahead plus our own = 90s.
    const service = build({ position: 3, completedPerBucket: Array.from({ length: 15 }, () => 2) });
    const result = await service.getProgress(service.issueTicket('p1'));

    expect(result).toMatchObject({ etaSeconds: 90 });
  });

  it('never returns a zero estimate', async () => {
    // A "0s remaining" beside a spinner reads as a stuck page.
    const service = build({ position: null, completedPerBucket: Array.from({ length: 15 }, () => 1000) });
    const result = await service.getProgress(service.issueTicket('p1'));

    expect(result.mode).toBe('live');
    expect(result).toMatchObject({ etaSeconds: 5 });
  });

  it('falls back to a fixed cost when the queue has no history', async () => {
    // First submission after the box wakes: nothing completed to average over.
    const service = build({ position: 1, completedPerBucket: [] });
    const result = await service.getProgress(service.issueTicket('p1'));

    // DEFAULT_SECONDS_PER_SELFIE (25) over concurrency 2.
    expect(result).toMatchObject({ etaSeconds: 13 });
  });

  it('scans only the selfie queue for position', async () => {
    let asked: QueueName | null = null;
    const service = new SelfieProgressService(
      { getEnv: () => ({ includedQueues: [] }) } as never,
      cipher as never,
      { getStatus: async () => ({ workerOnline: true, pending: 1 }) } as never,
      {
        getWaitingPosition: async (queue: QueueName) => {
          asked = queue;
          return 1;
        },
        getQueueMetrics: async () => ({ completed: [], failed: [] }),
      } as never,
      { getById: async () => ({ id: 'p1', status: ParticipantStatus.Processing }), countMatches: async () => 0 } as never,
    );

    await service.getProgress(service.issueTicket('p1'));
    expect(asked).toBe(QueueName.Selfie);
  });
});
