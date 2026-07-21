// Immich system_metadata pattern (docs/plan/03 §2 `system_config`).
import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { SystemConfigKey } from 'src/enum';
import { DB } from 'src/schema';

// Same defaults as immich:server/src/config.ts (~line 310).
export interface FacialRecognitionConfig {
  modelName: string;
  minScore: number;
  maxDistance: number;
  minFaces: number;
}

export const FACIAL_RECOGNITION_DEFAULTS: FacialRecognitionConfig = {
  modelName: 'buffalo_l',
  minScore: 0.7,
  maxDistance: 0.5,
  // Immich defaults to 3; EventLens uses 1 so a guest who appears in a single
  // photo still becomes a person and is never dropped from the People tab.
  // Raise it per event (EventConfig.minFaces) if single-photo people get noisy;
  // duplicates are cleaned up by merging instead.
  minFaces: 1,
};

// How long an expired event keeps its media before the purge sweep deletes it
// from R2. This is the organizer's window to extend or bail out, so it is
// deliberately generous by default — deleting event media cannot be undone.
export interface EventRetentionConfig {
  purgeGraceHours: number;
}

export const EVENT_RETENTION_DEFAULTS: EventRetentionConfig = {
  purgeGraceHours: 24,
};

// How the GPU box is started and stopped.
//
// Two providers:
//   'webhook'    — outbound POSTs to start/stop URLs. Works against Coolify, a
//                  cloud API or a home-grown script.
//   'jarvislabs' — shells out to the `jl` CLI. JarvisLabs exposes no REST API,
//                  only a CLI/SDK, so instance control has to run a process
//                  rather than make an HTTP call (see JarvisLabsRepository).
export type GpuProvider = 'webhook' | 'jarvislabs';

export interface GpuAutostartConfig {
  enabled: boolean;
  provider: GpuProvider;
  // Wake once this many jobs are waiting across the GPU queues.
  pendingThreshold: number;
  // …or once the oldest waiting job has been sitting this long, so a single
  // straggler is never stranded below the threshold.
  maxPendingAgeMinutes: number;
  // Stop this long after the queues go quiet. Billing is per-second, so this
  // is a small hedge against the next batch arriving, not an hour-boundary
  // game.
  idleShutdownMinutes: number;
  // Give up (and stop) if the box never reports in after a start.
  startTimeoutMinutes: number;
  startWebhookUrl: string;
  stopWebhookUrl: string;
  // Sent as `Authorization` on both calls. Stored in system_config, so treat
  // the config table as secret-bearing.
  webhookAuthHeader: string;

  // --- provider: jarvislabs ---
  // The instance to pause/resume. Seeds GpuLifecycleState.machineId; from then
  // on the *state* holds the live id, because `jl resume` can hand back a new
  // one (documented behaviour).
  jarvislabsMachineId: string;
  // Resume with a specific GPU type (e.g. 'A100'). Empty resumes on whatever
  // the instance was created with. Resume is region-locked, so a type that
  // isn't available in the instance's region will fail.
  jarvislabsGpuType: string;
}

export const GPU_AUTOSTART_DEFAULTS: GpuAutostartConfig = {
  enabled: false,
  provider: 'webhook',
  pendingThreshold: 25,
  maxPendingAgeMinutes: 120,
  idleShutdownMinutes: 10,
  startTimeoutMinutes: 20,
  startWebhookUrl: '',
  stopWebhookUrl: '',
  webhookAuthHeader: '',
  jarvislabsMachineId: '',
  jarvislabsGpuType: '',
};

export type GpuState = 'off' | 'starting' | 'running' | 'stopping';

// Mutable counterpart to the config above — written by the sweep.
export interface GpuLifecycleState {
  state: GpuState;
  since: string;
  // Set by a "Process all" click: hold the box up until this instant even if
  // the queues look briefly empty, so a manual run is never cut short by a lull
  // between jobs.
  holdUntil: string | null;
  // When the queues last went empty while running. The idle countdown is
  // measured from here, not from `since` — `since` is when the box started, so
  // measuring from it means a box that worked for longer than the idle window
  // gets no grace at all and stops the instant its queues drain.
  idleSince: string | null;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
  lastError: string | null;
  // JarvisLabs only: the instance id currently in play. Tracked in state rather
  // than config because `jl resume` may return a *different* id than the one it
  // was given — pausing the stale id afterwards would leave the real box
  // running and billing.
  machineId: string | null;
}

export const GPU_LIFECYCLE_INITIAL: GpuLifecycleState = {
  state: 'off',
  since: new Date(0).toISOString(),
  holdUntil: null,
  idleSince: null,
  lastStartedAt: null,
  lastStoppedAt: null,
  lastError: null,
  machineId: null,
};

@Injectable()
export class SystemConfigRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  async get<T>(key: SystemConfigKey): Promise<T | undefined> {
    const row = await this.db.selectFrom('systemConfig').select('value').where('key', '=', key).executeTakeFirst();
    return row?.value as T | undefined;
  }

  async set(key: SystemConfigKey, value: unknown): Promise<void> {
    await this.db
      .insertInto('systemConfig')
      .values({ key, value: JSON.stringify(value) })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value: JSON.stringify(value) }))
      .execute();
  }

  async getFacialRecognitionConfig(): Promise<FacialRecognitionConfig> {
    const stored = await this.get<Partial<FacialRecognitionConfig>>(SystemConfigKey.FacialRecognition);
    return { ...FACIAL_RECOGNITION_DEFAULTS, ...stored };
  }

  async getEventRetentionConfig(): Promise<EventRetentionConfig> {
    const stored = await this.get<Partial<EventRetentionConfig>>(SystemConfigKey.EventRetention);
    return { ...EVENT_RETENTION_DEFAULTS, ...stored };
  }

  async getGpuAutostartConfig(): Promise<GpuAutostartConfig> {
    const stored = await this.get<Partial<GpuAutostartConfig>>(SystemConfigKey.GpuAutostart);
    return { ...GPU_AUTOSTART_DEFAULTS, ...stored };
  }

  async getGpuLifecycleState(): Promise<GpuLifecycleState> {
    const stored = await this.get<Partial<GpuLifecycleState>>(SystemConfigKey.GpuLifecycle);
    return { ...GPU_LIFECYCLE_INITIAL, ...stored };
  }

  async setGpuLifecycleState(state: GpuLifecycleState): Promise<void> {
    await this.set(SystemConfigKey.GpuLifecycle, state);
  }
}
