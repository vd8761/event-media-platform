// Wakes the GPU box when there is work for it and shuts it down when there is
// not. The box is billed by the second, so the goal is simply: never idle,
// never cut a batch short.
//
// Shape of the loop:
//   GpuLifecycleSweep (every 2 min) reads the GPU queue depth and the box's own
//   heartbeat, then decides start / stop / do nothing.
//
// The box is started and stopped through one of two providers — outbound
// webhooks, or the JarvisLabs `jl` CLI (which has no REST equivalent, so it
// runs as a child process). It is *kept alive* by polling us — see
// `heartbeat()` — rather than us pushing to it. That direction matters: the box
// needs no inbound access, and if this API is unreachable the box shuts itself
// down. The expensive resource fails closed.
import { BadRequestException, Injectable } from '@nestjs/common';
import { OnJob } from 'src/decorators';
import { JobName, JobStatus, QueueName } from 'src/enum';
import { JarvisLabsRepository } from 'src/repositories/jarvislabs.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import {
  GpuAutostartConfig,
  GpuLifecycleState,
  SystemConfigRepository,
} from 'src/repositories/system-config.repository';
import { TelemetryRepository } from 'src/repositories/telemetry.repository';
import { QUEUE_ROLES } from 'src/types';
import { WorkerRole } from 'src/enum';

const WEBHOOK_TIMEOUT_MS = 20_000;

// Every queue the GPU box is responsible for.
const GPU_QUEUES = Object.values(QueueName).filter((queue) => QUEUE_ROLES[queue] === WorkerRole.Media);

export interface GpuQueueSummary {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  oldestWaitingAgeSeconds: number | null;
}

@Injectable()
export class GpuLifecycleService {
  constructor(
    private jarvisLabsRepository: JarvisLabsRepository,
    private jobRepository: JobRepository,
    private logger: LoggingRepository,
    private systemConfigRepository: SystemConfigRepository,
    private telemetryRepository: TelemetryRepository,
  ) {
    this.logger.setContext(GpuLifecycleService.name);
  }

  // --- read model (admin panel) ---

  async getStatus() {
    const [config, state, queues, workerOnline] = await Promise.all([
      this.systemConfigRepository.getGpuAutostartConfig(),
      this.systemConfigRepository.getGpuLifecycleState(),
      this.getQueueSummary(),
      this.isWorkerOnline(),
    ]);

    const pending = queues.reduce((sum, queue) => sum + queue.waiting + queue.active + queue.delayed, 0);
    const oldestAges = queues
      .map((queue) => queue.oldestWaitingAgeSeconds)
      .filter((age): age is number => age !== null);

    return {
      config,
      state,
      queues,
      pending,
      workerOnline,
      oldestPendingAgeSeconds: oldestAges.length > 0 ? Math.max(...oldestAges) : null,
      // Surfaced so the panel can explain *why* the box is or isn't running
      // rather than leaving an operator guessing at the thresholds.
      trigger: this.evaluateTrigger(config, queues, pending),
      // Whether the selected provider is actually usable from this host, so
      // the panel can warn before someone relies on autostart.
      providerReady:
        config.provider === 'jarvislabs'
          ? this.jarvisLabsRepository.isConfigured() && !!config.jarvislabsMachineId
          : !!config.startWebhookUrl && !!config.stopWebhookUrl,
    };
  }

  // Verify the provider end to end without changing anything: for JarvisLabs
  // this actually shells out to `jl get`, which proves the binary exists, the
  // API key works and the instance id is real.
  async testProvider(): Promise<{ ok: boolean; detail: string }> {
    const config = await this.systemConfigRepository.getGpuAutostartConfig();
    if (config.provider !== 'jarvislabs') {
      const configured = !!config.startWebhookUrl && !!config.stopWebhookUrl;
      return {
        ok: configured,
        detail: configured ? 'Start and stop webhooks are configured' : 'Start/stop webhook URLs are missing',
      };
    }

    if (!this.jarvisLabsRepository.isConfigured()) {
      return { ok: false, detail: 'JL_API_KEY is not set on the API host' };
    }
    const state = await this.systemConfigRepository.getGpuLifecycleState();
    const target = state.machineId || config.jarvislabsMachineId;
    if (!target) {
      return { ok: false, detail: 'No JarvisLabs instance id is configured' };
    }

    try {
      const instance = await this.jarvisLabsRepository.get(target);
      if (!instance) {
        return { ok: false, detail: `JarvisLabs returned no instance for id ${target}` };
      }
      return { ok: true, detail: `Instance ${instance.machineId} is ${instance.status ?? 'reachable'}` };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  // Per-queue depth plus how long the oldest waiting job has been sitting —
  // that age is what rescues a single job stuck below the threshold.
  async getQueueSummary(): Promise<GpuQueueSummary[]> {
    return Promise.all(
      GPU_QUEUES.map(async (name) => {
        const [counts, oldest] = await Promise.all([
          this.jobRepository.getJobCounts(name),
          this.jobRepository.getOldestWaitingTimestamp(name),
        ]);
        return {
          name,
          waiting: counts.waiting,
          active: counts.active,
          delayed: counts.delayed,
          failed: counts.failed,
          oldestWaitingAgeSeconds: oldest ? Math.round((Date.now() - oldest) / 1000) : null,
        };
      }),
    );
  }

  // --- manual control ---

  // "Process all" — start regardless of thresholds and hold the box up for at
  // least the idle window, so a manual run is not undone by the next sweep.
  async startNow(reason: string): Promise<GpuLifecycleState> {
    const config = await this.systemConfigRepository.getGpuAutostartConfig();
    this.assertControllable(config);
    return this.start(config, reason, true);
  }

  async stopNow(reason: string): Promise<GpuLifecycleState> {
    const config = await this.systemConfigRepository.getGpuAutostartConfig();
    this.assertControllable(config);
    return this.stop(config, reason);
  }

  // Fail loudly and specifically on a manual click — an operator pressing
  // "Process all" against a half-configured provider should be told exactly
  // what is missing, not left watching a state that never changes.
  private assertControllable(config: GpuAutostartConfig) {
    if (config.provider === 'jarvislabs') {
      if (!this.jarvisLabsRepository.isConfigured()) {
        throw new BadRequestException('JarvisLabs control needs JL_API_KEY set on the API host');
      }
      if (!config.jarvislabsMachineId) {
        throw new BadRequestException('No JarvisLabs instance id is configured');
      }
      return;
    }
    if (!config.startWebhookUrl || !config.stopWebhookUrl) {
      throw new BadRequestException('No GPU start/stop webhook is configured');
    }
  }

  // --- the box asks us whether to stay up ---
  //
  // Called on a timer by the script on the VM. `keepAlive: false` (or an
  // unreachable API) tells it to shut itself down.
  async heartbeat(): Promise<{ keepAlive: boolean; reason: string; pending: number }> {
    const [config, state, queues] = await Promise.all([
      this.systemConfigRepository.getGpuAutostartConfig(),
      this.systemConfigRepository.getGpuLifecycleState(),
      this.getQueueSummary(),
    ]);

    const pending = queues.reduce((sum, queue) => sum + queue.waiting + queue.active + queue.delayed, 0);
    const active = queues.reduce((sum, queue) => sum + queue.active, 0);

    // A job mid-flight always wins: killing the box now would waste the GPU
    // seconds already spent on it and force a retry.
    if (active > 0) {
      return { keepAlive: true, reason: `${active} job(s) in flight`, pending };
    }
    if (state.holdUntil && new Date(state.holdUntil) > new Date()) {
      return { keepAlive: true, reason: 'manual hold', pending };
    }
    if (pending > 0) {
      return { keepAlive: true, reason: `${pending} job(s) queued`, pending };
    }
    if (state.state === 'stopping') {
      return { keepAlive: false, reason: 'shutdown requested', pending };
    }

    // Queues are empty. Stay up until the idle window elapses, in case the
    // next batch is seconds away.
    const idleSince = new Date(state.since).getTime();
    const idleMs = Date.now() - idleSince;
    const keepAlive = idleMs < config.idleShutdownMinutes * 60 * 1000;
    return {
      keepAlive,
      reason: keepAlive ? 'within idle window' : 'idle window elapsed',
      pending,
    };
  }

  // --- the sweep ---

  @OnJob({ name: JobName.GpuLifecycleSweep, queue: QueueName.Background })
  async handleGpuLifecycleSweep(): Promise<JobStatus> {
    const config = await this.systemConfigRepository.getGpuAutostartConfig();
    if (!config.enabled) {
      return JobStatus.Skipped;
    }

    const [state, queues, workerOnline] = await Promise.all([
      this.systemConfigRepository.getGpuLifecycleState(),
      this.getQueueSummary(),
      this.isWorkerOnline(),
    ]);

    const pending = queues.reduce((sum, queue) => sum + queue.waiting + queue.active + queue.delayed, 0);
    const active = queues.reduce((sum, queue) => sum + queue.active, 0);
    const now = Date.now();

    // Reconcile first: the heartbeat is the source of truth about whether the
    // box is actually up, not what we last wrote down.
    if (state.state === 'starting' && workerOnline) {
      await this.setState({ ...state, state: 'running', since: new Date().toISOString(), lastError: null });
      this.logger.log('GPU worker reported in — now running');
      return JobStatus.Success;
    }

    if (state.state === 'starting' && now - new Date(state.since).getTime() > config.startTimeoutMinutes * 60_000) {
      // Never showed up. Stop it rather than leaving a half-booted box we
      // believe is coming — a machine we are not using is a machine we pay for.
      this.logger.error(`GPU worker did not report in within ${config.startTimeoutMinutes}m — stopping`);
      await this.stop(config, 'start timed out');
      return JobStatus.Success;
    }

    if (state.state === 'running' && !workerOnline) {
      // It vanished — crashed, or stopped itself via the heartbeat.
      await this.setState({
        ...state,
        state: 'off',
        since: new Date().toISOString(),
        lastStoppedAt: new Date().toISOString(),
      });
      this.logger.warn('GPU worker stopped reporting — marking off');
      return JobStatus.Success;
    }

    if (state.state === 'stopping' && !workerOnline) {
      await this.setState({
        ...state,
        state: 'off',
        since: new Date().toISOString(),
        lastStoppedAt: new Date().toISOString(),
      });
      return JobStatus.Success;
    }

    const trigger = this.evaluateTrigger(config, queues, pending);

    if (state.state === 'off' && trigger.shouldStart) {
      await this.start(config, trigger.reason, false);
      return JobStatus.Success;
    }

    if (state.state === 'running' && pending === 0 && active === 0) {
      const holding = state.holdUntil && new Date(state.holdUntil).getTime() > now;
      const idleFor = now - new Date(state.since).getTime();
      if (!holding && idleFor > config.idleShutdownMinutes * 60_000) {
        await this.stop(config, `idle for ${Math.round(idleFor / 60_000)}m`);
      }
    }

    return JobStatus.Success;
  }

  // --- internals ---

  // Two independent reasons to wake: enough work to be worth the boot, or work
  // that has waited too long. The second is what stops one straggling job from
  // sitting below the threshold forever.
  private evaluateTrigger(config: GpuAutostartConfig, queues: GpuQueueSummary[], pending: number) {
    if (pending === 0) {
      return { shouldStart: false, reason: 'no pending work' };
    }

    if (pending >= config.pendingThreshold) {
      return { shouldStart: true, reason: `${pending} pending ≥ threshold ${config.pendingThreshold}` };
    }

    const oldest = queues
      .map((queue) => queue.oldestWaitingAgeSeconds)
      .filter((age): age is number => age !== null)
      .reduce((max, age) => Math.max(max, age), 0);

    if (oldest >= config.maxPendingAgeMinutes * 60) {
      return {
        shouldStart: true,
        reason: `oldest job waiting ${Math.round(oldest / 60)}m ≥ ${config.maxPendingAgeMinutes}m`,
      };
    }

    return {
      shouldStart: false,
      reason: `${pending} pending (< ${config.pendingThreshold}), oldest ${Math.round(oldest / 60)}m (< ${config.maxPendingAgeMinutes}m)`,
    };
  }

  // The heartbeat key the GPU worker publishes (TelemetryRepository) doubles
  // as the liveness signal — it is already there, already has a TTL, and needs
  // no separate protocol.
  private async isWorkerOnline(): Promise<boolean> {
    try {
      const instances = await this.telemetryRepository.getInstances();
      return instances.some((instance) => instance.roles.includes(WorkerRole.Media));
    } catch {
      // Unknown is not "off": treating a Redis blip as a dead box would start
      // a second one.
      return true;
    }
  }

  private async start(config: GpuAutostartConfig, reason: string, manual: boolean): Promise<GpuLifecycleState> {
    const state = await this.systemConfigRepository.getGpuLifecycleState();

    // Idempotent by state, because a duplicate start is a duplicate bill.
    if (state.state === 'starting' || state.state === 'running') {
      if (manual) {
        const holdUntil = new Date(Date.now() + config.idleShutdownMinutes * 60_000).toISOString();
        const next = { ...state, holdUntil };
        await this.setState(next);
        return next;
      }
      return state;
    }

    const now = new Date().toISOString();
    // Marked `starting` *before* the webhook fires: if the call succeeds but
    // the response is lost, the next sweep must not fire it again.
    const pendingState: GpuLifecycleState = {
      ...state,
      state: 'starting',
      since: now,
      lastStartedAt: now,
      lastError: null,
      holdUntil: manual ? new Date(Date.now() + config.idleShutdownMinutes * 60_000).toISOString() : state.holdUntil,
    };
    await this.setState(pendingState);

    this.logger.log(`Starting GPU worker (${reason})`);

    if (config.provider === 'jarvislabs') {
      const target = state.machineId || config.jarvislabsMachineId;
      if (!target) {
        const failed: GpuLifecycleState = { ...pendingState, state: 'off', lastError: 'no JarvisLabs instance id' };
        await this.setState(failed);
        return failed;
      }
      try {
        const instance = await this.jarvisLabsRepository.resume(target, config.jarvislabsGpuType || undefined);
        // Persist the id the CLI handed back: resume can reassign it, and a
        // stale id would make the later pause a no-op against a dead machine
        // while the real one keeps billing.
        const started: GpuLifecycleState = { ...pendingState, machineId: instance.machineId };
        await this.setState(started);
        return started;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failed: GpuLifecycleState = { ...pendingState, state: 'off', lastError: message };
        await this.setState(failed);
        this.logger.error(`JarvisLabs resume failed: ${message}`);
        return failed;
      }
    }

    const error = await this.callWebhook(config.startWebhookUrl, config.webhookAuthHeader, { action: 'start', reason });
    if (error) {
      const failed: GpuLifecycleState = { ...pendingState, state: 'off', lastError: error };
      await this.setState(failed);
      this.logger.error(`GPU start webhook failed: ${error}`);
      return failed;
    }

    return pendingState;
  }

  private async stop(config: GpuAutostartConfig, reason: string): Promise<GpuLifecycleState> {
    const state = await this.systemConfigRepository.getGpuLifecycleState();
    const now = new Date().toISOString();
    const stopping: GpuLifecycleState = { ...state, state: 'stopping', since: now, holdUntil: null, lastError: null };
    await this.setState(stopping);

    this.logger.log(`Stopping GPU worker (${reason})`);

    if (config.provider === 'jarvislabs') {
      const target = state.machineId || config.jarvislabsMachineId;
      if (!target) {
        const failed: GpuLifecycleState = { ...stopping, lastError: 'no JarvisLabs instance id' };
        await this.setState(failed);
        return failed;
      }
      try {
        await this.jarvisLabsRepository.pause(target);
        const stopped: GpuLifecycleState = { ...stopping, state: 'off', since: now, lastStoppedAt: now };
        await this.setState(stopped);
        return stopped;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Deliberately left in `stopping`, same as the webhook path: the box's
        // own heartbeat also tells it to shut down, so a failed pause is not a
        // runaway bill — and the state keeps the failure visible on the panel.
        const failed: GpuLifecycleState = { ...stopping, lastError: message };
        await this.setState(failed);
        this.logger.error(`JarvisLabs pause failed: ${message} — the worker should still self-stop via heartbeat`);
        return failed;
      }
    }

    const error = await this.callWebhook(config.stopWebhookUrl, config.webhookAuthHeader, { action: 'stop', reason });
    if (error) {
      // Left in `stopping` on purpose. The box's own heartbeat will also tell
      // it to shut down, so a failed webhook is not a runaway bill — and the
      // state makes the failure visible on the panel.
      const failed: GpuLifecycleState = { ...stopping, lastError: error };
      await this.setState(failed);
      this.logger.error(`GPU stop webhook failed: ${error} — the worker should still self-stop via heartbeat`);
      return failed;
    }

    const stopped: GpuLifecycleState = { ...stopping, state: 'off', since: now, lastStoppedAt: now };
    await this.setState(stopped);
    return stopped;
  }

  // Returns an error string, or undefined on success — callers decide what a
  // failure means, since it differs for start and stop.
  private async callWebhook(url: string, authHeader: string, body: unknown): Promise<string | undefined> {
    if (!url) {
      return 'no webhook URL configured';
    }
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authHeader ? { authorization: authHeader } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return `${response.status} ${response.statusText}${detail ? `: ${detail.slice(0, 200)}` : ''}`;
      }
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  private setState(state: GpuLifecycleState): Promise<void> {
    return this.systemConfigRepository.setGpuLifecycleState(state);
  }
}
