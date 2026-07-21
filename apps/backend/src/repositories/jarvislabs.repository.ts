// JarvisLabs instance control.
//
// JarvisLabs ships no REST API — only the `jl` CLI (and a Python SDK). So
// pausing/resuming the GPU worker means running a process, not making an HTTP
// call. This wraps `jl` with the flags the docs mandate for non-interactive
// use: `--json` for machine-readable output and `--yes` on anything that would
// otherwise prompt (pause/resume both do).
//
// Auth is the `JL_API_KEY` environment variable, which the CLI accepts
// directly — no `jl setup` and no config file needed, which is what makes this
// workable on an immutable container filesystem like Render's.
//
// Everything here is defensive on purpose: this runs on the API box, and a
// missing binary or a JarvisLabs outage must surface as a readable error on
// the admin panel rather than an unhandled rejection.
import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ConfigRepository } from 'src/repositories/config.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';

const execFileAsync = promisify(execFile);

// create/resume block until the instance is Running, which is minutes, not
// seconds. Pause is quicker but still not instant.
const RESUME_TIMEOUT_MS = 8 * 60_000;
const PAUSE_TIMEOUT_MS = 3 * 60_000;
const READ_TIMEOUT_MS = 60_000;

// `jl` prints human-readable status to stderr and JSON to stdout, so only
// stdout is parsed.
const MAX_BUFFER = 4 * 1024 * 1024;

export interface JarvisLabsInstance {
  machineId: string;
  name?: string;
  status?: string;
  gpuType?: string;
}

export class JarvisLabsError extends Error {}

@Injectable()
export class JarvisLabsRepository {
  private apiKey: string;
  private binary: string;

  constructor(
    configRepository: ConfigRepository,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(JarvisLabsRepository.name);
    const env = configRepository.getEnv();
    this.apiKey = env.jarvisLabs.apiKey;
    this.binary = env.jarvisLabs.binary;
  }

  // The admin panel uses this to explain *why* the provider is unavailable
  // before anyone tries to use it.
  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  // Resume a paused instance. Returns the id to use from now on: the CLI docs
  // are explicit that resume can allocate a new machine id, and using the old
  // one afterwards would target a machine that no longer exists.
  async resume(machineId: string, gpuType?: string): Promise<JarvisLabsInstance> {
    const args = ['resume', machineId];
    if (gpuType) {
      args.push('--gpu', gpuType);
    }
    const payload = await this.run(args, RESUME_TIMEOUT_MS);
    const resumed = this.toInstance(payload) ?? { machineId };
    if (resumed.machineId !== machineId) {
      this.logger.warn(`JarvisLabs resume reassigned instance ${machineId} → ${resumed.machineId}`);
    }
    return resumed;
  }

  // Pause a running instance: compute billing stops, storage is kept.
  async pause(machineId: string): Promise<void> {
    await this.run(['pause', machineId], PAUSE_TIMEOUT_MS);
  }

  async get(machineId: string): Promise<JarvisLabsInstance | null> {
    const payload = await this.run(['get', machineId], READ_TIMEOUT_MS);
    return this.toInstance(payload);
  }

  async list(): Promise<JarvisLabsInstance[]> {
    const payload = await this.run(['list'], READ_TIMEOUT_MS);
    const rows = Array.isArray(payload) ? payload : [];
    return rows.map((row) => this.toInstance(row)).filter((row): row is JarvisLabsInstance => row !== null);
  }

  // --- internals ---

  private async run(args: string[], timeoutMs: number): Promise<unknown> {
    if (!this.isConfigured()) {
      throw new JarvisLabsError('JL_API_KEY is not set — JarvisLabs control is unavailable');
    }

    // `--json` on every call; `--yes` only on the ones that prompt, because the
    // read-only commands reject it (documented).
    const prompts = args[0] === 'pause' || args[0] === 'resume' || args[0] === 'destroy';
    const argv = [...args, '--json', ...(prompts ? ['--yes'] : [])];

    let stdout: string;
    try {
      const result = await execFileAsync(this.binary, argv, {
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER,
        env: {
          ...process.env,
          JL_API_KEY: this.apiKey,
          // Suppress the once-a-day upgrade banner so it can never contaminate
          // output or block on a TTY check.
          JL_NO_UPDATE_CHECK: '1',
          CI: '1',
        },
      });
      stdout = result.stdout;
    } catch (error) {
      throw this.toError(error, argv);
    }

    return this.parse(stdout, argv);
  }

  // `jl` reports its own failures as `{"error": "..."}` on stdout *with* a
  // non-zero exit, so the error body is worth more than the exit code.
  private toError(error: unknown, argv: string[]): JarvisLabsError {
    const failure = error as { code?: string; stdout?: string; stderr?: string; message?: string; killed?: boolean };

    if (failure.code === 'ENOENT') {
      return new JarvisLabsError(
        `The '${this.binary}' CLI is not installed on this host. Install the 'jarvislabs' package (see the backend Dockerfile).`,
      );
    }
    if (failure.killed) {
      return new JarvisLabsError(`jl ${argv[0]} timed out`);
    }

    const fromStdout = this.errorMessage(failure.stdout);
    const detail = fromStdout || failure.stderr?.trim() || failure.message || 'unknown error';
    return new JarvisLabsError(`jl ${argv[0]} failed: ${detail.slice(0, 500)}`);
  }

  private errorMessage(stdout?: string): string | undefined {
    if (!stdout) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(stdout.trim());
      if (parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string') {
        return (parsed as { error: string }).error;
      }
    } catch {
      // not JSON — fall through
    }
    return undefined;
  }

  private parse(stdout: string, argv: string[]): unknown {
    const trimmed = stdout.trim();
    if (!trimmed) {
      // A prompt-free success with no body (some verbs do this) is still a
      // success — the exit code already said so.
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new JarvisLabsError(`jl ${argv[0]} returned unparseable output: ${trimmed.slice(0, 200)}`);
    }
    const message = parsed && typeof parsed === 'object' ? (parsed as { error?: unknown }).error : undefined;
    if (typeof message === 'string') {
      throw new JarvisLabsError(`jl ${argv[0]} failed: ${message.slice(0, 500)}`);
    }
    return parsed;
  }

  // The CLI's field names aren't guaranteed stable across versions, so accept
  // the documented snake_case and the obvious camelCase alternative rather
  // than hard-failing on a rename.
  private toInstance(payload: unknown): JarvisLabsInstance | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const row = payload as Record<string, unknown>;
    const id = row.machine_id ?? row.machineId ?? row.id;
    if (id === undefined || id === null) {
      return null;
    }
    return {
      machineId: String(id),
      name: typeof row.name === 'string' ? row.name : undefined,
      status: typeof row.status === 'string' ? row.status : undefined,
      gpuType: typeof row.gpu_type === 'string' ? row.gpu_type : undefined,
    };
  }
}
