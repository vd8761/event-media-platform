// Cross-process host telemetry for the super-admin system panel.
//
// The API and the media worker run on different machines (docs/plan/11 §2 —
// and more so when the API sits on a PaaS while the GPU box is elsewhere), so
// the API cannot read the GPU's utilisation directly: os.cpus() only ever
// describes the process asking. Instead every process publishes its own host
// sample to a short-TTL Redis key and the API reads whatever is currently
// alive. A worker that dies simply stops appearing once its key expires.
import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { arch, cpus, freemem, hostname, platform, totalmem, uptime } from 'node:os';
import { promisify } from 'node:util';
import { Redis } from 'ioredis';
import { ConfigRepository } from 'src/repositories/config.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { WorkerRole } from 'src/enum';

const execFileAsync = promisify(execFile);

const KEY_PREFIX = 'el:telemetry:instance:';
const HEARTBEAT_INTERVAL_MS = 15_000;
// Generous relative to the interval so one slow tick does not blank the panel.
const HEARTBEAT_TTL_SECONDS = 60;
const NVIDIA_SMI_TIMEOUT_MS = 4000;
const CPU_SAMPLE_WINDOW_MS = 250;

export interface GpuStatus {
  index: number;
  name: string;
  utilizationPercent: number | null;
  memoryUsedMb: number | null;
  memoryTotalMb: number | null;
  temperatureC: number | null;
}

export interface InstanceStatus {
  instanceId: string;
  hostname: string;
  roles: WorkerRole[];
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  cpuPercent: number;
  memoryTotal: number;
  memoryUsed: number;
  uptimeSeconds: number;
  processUptimeSeconds: number;
  rssBytes: number;
  nodeVersion: string;
  mlDevice: 'cpu' | 'cuda';
  gpus: GpuStatus[];
  // null when nvidia-smi is not on PATH — i.e. a CPU-only box, which is not
  // an error and must not be rendered as a failure.
  gpuError: string | null;
  reportedAt: string;
}

// Sample the CPU counters twice so the reported figure is a real utilisation
// percentage rather than an average since boot.
export async function sampleCpuPercent(windowMs = CPU_SAMPLE_WINDOW_MS): Promise<number> {
  const snapshot = () => {
    let idle = 0;
    let total = 0;
    for (const cpu of cpus()) {
      for (const value of Object.values(cpu.times)) {
        total += value;
      }
      idle += cpu.times.idle;
    }
    return { idle, total };
  };

  const first = snapshot();
  await new Promise((resolve) => setTimeout(resolve, windowMs));
  const second = snapshot();

  const totalDelta = second.total - first.total;
  const idleDelta = second.idle - first.idle;
  if (totalDelta <= 0) {
    return 0;
  }
  return Math.round((1 - idleDelta / totalDelta) * 1000) / 10;
}

const toNumber = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

@Injectable()
export class TelemetryRepository implements OnApplicationShutdown {
  private client?: Redis;
  private interval?: ReturnType<typeof setInterval>;
  private readonly instanceId = `${hostname()}:${process.pid}`;

  constructor(
    private configRepository: ConfigRepository,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(TelemetryRepository.name);
  }

  private getClient(): Redis {
    // Its own connection rather than borrowing BullMQ's: worker connections
    // sit in blocking reads, and a blocked client cannot serve a GET.
    //
    // The shared config carries maxRetriesPerRequest: null because BullMQ
    // demands it, but that means "retry forever" — on a telemetry read that
    // would hang the admin request instead of failing it. Fail fast here: a
    // missing panel is much better than a stuck one.
    // maxRetriesPerRequest bounds it: once the reconnect attempts are spent,
    // ioredis flushes the queued commands with an error rather than holding
    // them. The offline queue stays on so the first heartbeat does not race
    // the initial connect.
    this.client ??= new Redis({
      ...this.configRepository.getEnv().redis,
      maxRetriesPerRequest: 2,
      connectTimeout: 5000,
    });
    return this.client;
  }

  // Every process heartbeats — the API so its own host shows up, the workers
  // so their (possibly GPU-bearing) hosts do.
  startHeartbeat() {
    void this.publish();
    this.interval ??= setInterval(() => void this.publish(), HEARTBEAT_INTERVAL_MS);
  }

  // Invoked by Nest on SIGTERM/SIGINT (main.ts enables shutdown hooks). A
  // hard kill -9 skips this, in which case the key just expires on its TTL.
  async onApplicationShutdown() {
    await this.teardown();
  }

  async teardown() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    if (this.client) {
      // Drop our key immediately so a clean shutdown does not leave a ghost
      // instance on the panel for the rest of the TTL.
      await this.client.del(`${KEY_PREFIX}${this.instanceId}`).catch(() => undefined);
      this.client.disconnect();
      this.client = undefined;
    }
  }

  private async publish(): Promise<void> {
    try {
      const status = await this.sample();
      await this.getClient().set(
        `${KEY_PREFIX}${this.instanceId}`,
        JSON.stringify(status),
        'EX',
        HEARTBEAT_TTL_SECONDS,
      );
    } catch (error) {
      // Telemetry is best-effort: never take a worker down over it.
      this.logger.warn(`Failed to publish telemetry heartbeat: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async sample(): Promise<InstanceStatus> {
    const env = this.configRepository.getEnv();
    const [cpuPercent, gpu] = await Promise.all([sampleCpuPercent(), this.sampleGpus()]);
    const memoryTotal = totalmem();
    const cores = cpus();

    return {
      instanceId: this.instanceId,
      hostname: hostname(),
      roles: env.workers,
      platform: platform(),
      arch: arch(),
      cpuModel: cores[0]?.model?.trim() ?? 'unknown',
      cpuCount: cores.length,
      cpuPercent,
      memoryTotal,
      memoryUsed: memoryTotal - freemem(),
      uptimeSeconds: Math.round(uptime()),
      processUptimeSeconds: Math.round(process.uptime()),
      rssBytes: process.memoryUsage().rss,
      nodeVersion: process.version,
      mlDevice: env.machineLearning.device,
      gpus: gpu.gpus,
      gpuError: gpu.error,
      reportedAt: new Date().toISOString(),
    };
  }

  // nvidia-smi is present whenever the container has the NVIDIA runtime; on
  // every other host this fails and we report "no GPU" rather than an error.
  private async sampleGpus(): Promise<{ gpus: GpuStatus[]; error: string | null }> {
    try {
      const { stdout } = await execFileAsync(
        'nvidia-smi',
        [
          '--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu',
          '--format=csv,noheader,nounits',
        ],
        { timeout: NVIDIA_SMI_TIMEOUT_MS },
      );

      const gpus = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [index, name, utilization, memoryUsed, memoryTotal, temperature] = line
            .split(',')
            .map((field) => field.trim());
          return {
            index: toNumber(index) ?? 0,
            name,
            utilizationPercent: toNumber(utilization),
            memoryUsedMb: toNumber(memoryUsed),
            memoryTotalMb: toNumber(memoryTotal),
            temperatureC: toNumber(temperature),
          };
        });

      return { gpus, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // ENOENT just means this host has no NVIDIA tooling — the common case
      // for the API box, and not worth surfacing as a fault.
      const isMissing = message.includes('ENOENT');
      return { gpus: [], error: isMissing ? null : message };
    }
  }

  // Read side for GET /admin/system. SCAN rather than KEYS so a large shared
  // Redis is not blocked while we enumerate.
  async getInstances(): Promise<InstanceStatus[]> {
    const client = this.getClient();
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [next, batch] = await client.scan(cursor, 'MATCH', `${KEY_PREFIX}*`, 'COUNT', 100);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0');

    if (keys.length === 0) {
      return [];
    }

    const values = await client.mget(keys);
    const instances: InstanceStatus[] = [];
    for (const value of values) {
      if (!value) {
        continue;
      }
      try {
        instances.push(JSON.parse(value) as InstanceStatus);
      } catch {
        // a torn or half-written value: skip it rather than fail the panel
      }
    }

    return instances.sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  }
}
