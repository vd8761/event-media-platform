// Hand-written typed client for the EventLens API. Sessions ride on the
// HttpOnly cookie (same-origin via the vite proxy / production reverse proxy).
// A generated packages/sdk client (docs/plan/10 §4) can replace this later.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    // Full parsed error body. A 410 from an expired gallery carries the event
    // name and dates, which the participant-facing page needs to explain what
    // happened rather than just saying "invalid link".
    public body?: Record<string, unknown>,
  ) {
    super(message);
  }
}

// Shape of the 410 an expired event returns (see public.service resolveGallery).
export interface ExpiredEventInfo {
  eventName: string;
  expiredAt: string | null;
  purged: boolean;
}

export const asExpiredEvent = (error: unknown): ExpiredEventInfo | null => {
  if (error instanceof ApiError && error.status === 410 && error.body) {
    return {
      eventName: String(error.body.eventName ?? 'This event'),
      expiredAt: (error.body.expiredAt as string) ?? null,
      purged: Boolean(error.body.purged),
    };
  }
  return null;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    let message = response.statusText;
    let body: Record<string, unknown> | undefined;
    try {
      body = await response.json();
      message = Array.isArray(body?.message) ? body.message.join(', ') : ((body?.message as string) ?? message);
    } catch {
      // not json
    }
    throw new ApiError(response.status, message, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const put = <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
const del = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'DELETE', body: body === undefined ? undefined : JSON.stringify(body) });

// --- types (mirror backend responses) ---

export interface Me {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  organizations: { id: string; name: string; slug: string; role: 'owner' | 'admin' | 'member' }[];
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  plan: OrgPlan;
  // Null means "use the plan's own limit". Only Enterprise may carry values.
  storageLimitBytes: number | null;
  eventLimit: number | null;
}

export interface EventItem {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: 'draft' | 'active' | 'closed';
  participantPageEnabled: boolean;
  participantsSeeAllPhotos: boolean;
  participantsCanDownloadAll: boolean;
  config: { matchMaxDistance?: number; minScore?: number; minFaces?: number };
  // Sidebar thumbnail. null means "use the event's most recent photo".
  coverAssetId: string | null;
  // Expiration. expiresAt closes the guest links; purgeAfter is when the media
  // leaves R2. purgedAt being set means the photos are gone for good and
  // extending can no longer bring them back.
  expiresAt: string | null;
  expiryNotifiedAt: string | null;
  expiryAcknowledgedAt: string | null;
  purgeAfter: string | null;
  purgedAt: string | null;
  orgName?: string;
}

export interface AssetItem {
  id: string;
  type: string;
  status: string;
  originalFilename: string;
  capturedAt: string | null;
  createdAt: string;
  width: number | null;
  height: number | null;
  thumbhash: string | null;
  thumbUrl: string | null;
  previewUrl: string | null;
  // null until face detection has run on this asset (migration 0003)
  facesDetectedAt: string | null;
  faceCount: number;
}

export interface PersonItem {
  id: string;
  name: string;
  isHidden: boolean;
  faceCount: number;
  thumbnailUrl: string | null;
}

export interface FaceBoxDto {
  id: string;
  personId: string | null;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isCover: boolean;
}

export interface AssetDetail extends AssetItem {
  faces: FaceBoxDto[];
  fileSize: number;
  mimeType: string;
  checksum: string;
  durationSeconds: number | null;
  source: string;
  exif: {
    make: string | null;
    model: string | null;
    lens: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
  people: { id: string; name: string; thumbnailUrl: string | null }[];
}

export interface ProcessingStatus {
  assets: {
    total: number;
    processed: number;
    failed: number;
    pendingMedia: number;
    images: number;
    facesDetected: number;
    pendingDetection: number;
    withFaces: number;
    withoutFaces: number;
  };
  faces: { total: number; assigned: number; unassigned: number; people: number };
}

export interface JobQueue {
  name: string;
  label: string;
  description: string;
  role: string;
  concurrency: number;
  isPaused: boolean;
  counts: QueueCounts;
  pending: number;
  ratePerMinute: number;
  etaSeconds: number | null;
  history: number[];
  jobs: string[];
  active: { name: string; data: Record<string, unknown>; startedAt: number | null }[];
}

// Counts only, by design: a super admin administers organizations but cannot
// see inside their events, so no event name ever reaches this payload.
export interface OrgStatsRow {
  orgId: string;
  name: string;
  slug: string;
  eventCount: number;
  assetCount: number;
  storageBytes: number;
  personCount: number;
  participantCount: number;
  personsPerEvent: number;
}

export interface AdminStats {
  organizations: number;
  users: number;
  events: number;
  assets: number;
  storageBytes: number;
  people: number;
  participants: number;
  byOrganization: OrgStatsRow[];
}

export interface GpuStatus {
  index: number;
  name: string;
  utilizationPercent: number | null;
  memoryUsedMb: number | null;
  memoryTotalMb: number | null;
  temperatureC: number | null;
}

// One entry per process currently heartbeating into Redis — this is how the
// GPU machine's figures reach an API running somewhere else entirely.
export interface InstanceStatus {
  instanceId: string;
  hostname: string;
  roles: string[];
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
  gpuError: string | null;
  reportedAt: string;
}

// --- app shell ---

export interface SidebarEvent {
  id: string;
  name: string;
  slug: string;
  status: 'draft' | 'active' | 'closed';
  startsAt: string | null;
  expiresAt: string | null;
  purgedAt: string | null;
  assetCount: number;
  // Falls back to the event's newest photo when no cover has been picked.
  coverUrl: string | null;
}

export interface OrgShell {
  // Includes media belonging to soft-deleted events — those bytes are still
  // in R2 until the purge sweep runs.
  storage: { bytes: number; assets: number };
  events: SidebarEvent[];
}

// Account usage statistics, per organisation. Modelled on Immich's
// UserUsageStatistic: headline tiles plus a per-event breakdown.
export interface OrgUsage {
  events: { eventId: string; eventName: string; photos: number; videos: number; bytes: number }[];
  totals: { events: number; photos: number; videos: number; bytes: number };
}

// A support message in the super-admin inbox.
export interface SupportTicket {
  id: string;
  source: 'organization' | 'public';
  status: 'open' | 'resolved';
  message: string;
  name: string | null;
  email: string | null;
  createdAt: string;
  resolvedAt: string | null;
  orgId: string | null;
  orgName: string | null;
  eventId: string | null;
  eventName: string | null;
  userName: string | null;
  userEmail: string | null;
}

export interface OrgNotification {
  id: string;
  level: 'info' | 'warning';
  title: string;
  body: string;
  eventId: string;
  at: string;
}

// Timeline item carrying its event, so the org-wide view can label and link.
export interface OrgTimelineAsset {
  id: string;
  eventId: string;
  eventName: string;
  type: string;
  status: string;
  originalFilename: string;
  capturedAt: string | null;
  createdAt: string | null;
  width: number | null;
  height: number | null;
  thumbhash: string | null;
  thumbUrl: string | null;
  previewUrl: string | null;
}

// Map marker: one geotagged photo (Immich MapMarkerResponseDto, minus the
// reverse-geocoded place fields we don't populate yet).
export interface MapMarker {
  id: string;
  eventId: string;
  lat: number;
  lon: number;
  thumbUrl: string | null;
}

// Org-wide person: a cluster carrying its event, for the People grid.
export interface OrgPerson {
  id: string;
  eventId: string;
  eventName: string;
  name: string | null;
  faceCount: number;
  thumbnailUrl: string | null;
}

// 'webhook' POSTs to start/stop URLs; 'jarvislabs' runs the `jl` CLI on the
// API host (JarvisLabs has no REST API).
export type GpuProvider = 'webhook' | 'jarvislabs';

export interface GpuAutostartConfig {
  enabled: boolean;
  provider: GpuProvider;
  pendingThreshold: number;
  maxPendingAgeMinutes: number;
  idleShutdownMinutes: number;
  startTimeoutMinutes: number;
  startWebhookUrl: string;
  stopWebhookUrl: string;
  webhookAuthHeader: string;
  jarvislabsMachineId: string;
  jarvislabsGpuType: string;
}

export interface GpuLifecycleState {
  state: 'off' | 'starting' | 'running' | 'stopping';
  since: string;
  holdUntil: string | null;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
  lastError: string | null;
  // JarvisLabs only — resume can hand back a different instance id.
  machineId: string | null;
}

export interface GpuQueueSummary {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  oldestWaitingAgeSeconds: number | null;
}

export interface GpuStatusResponse {
  config: GpuAutostartConfig;
  state: GpuLifecycleState;
  queues: GpuQueueSummary[];
  pending: number;
  workerOnline: boolean;
  // The API's clock. The hold countdown is computed against this rather than
  // the browser's, so a skewed local clock cannot show a wrong remaining time.
  serverNow: string;
  oldestPendingAgeSeconds: number | null;
  // Why the box is or is not running, so the panel never leaves an operator
  // guessing at the thresholds.
  trigger: { shouldStart: boolean; reason: string };
  // Whether the selected provider is actually usable from the API host.
  providerReady: boolean;
}

export interface SystemStatus {
  machineLearning: {
    device: 'cpu' | 'cuda';
    deviceIsConfigured: boolean;
    // False on an api/ingest host: it never calls ML, so a health check there
    // would fail by design and mean nothing.
    usedByThisProcess: boolean;
    servers: { url: string; healthy: boolean; latencyMs: number | null }[];
  };
  host: {
    platform: string;
    arch: string;
    cpuModel: string;
    cpuCount: number;
    cpuPercent: number;
    memoryTotal: number;
    memoryUsed: number;
    uptimeSeconds: number;
  };
  process: {
    uptimeSeconds: number;
    rssBytes: number;
    heapUsedBytes: number;
    nodeVersion: string;
    workers: string[];
    excludedQueues: string[];
  };
  instances: InstanceStatus[];
  database: { vectorExtension: string; version: string };
}

export interface ParticipantItem {
  id: string;
  email: string;
  status: string;
  matchCount: number;
  notifiedFirstAt: string | null;
  lastNotifiedAt: string | null;
  createdAt: string;
  lastEmailStatus: string | null;
  lastEmailAt: string | null;
}

export interface CloudAccountItem {
  id: string;
  provider: 'gdrive' | 'onedrive';
  accountEmail: string;
  createdAt: string;
}

export interface ImportProgress {
  id: string;
  provider: string;
  folderName: string;
  status: 'listing' | 'importing' | 'done' | 'failed' | 'cancelled';
  totalFiles: number;
  doneFiles: number;
  skippedFiles: number;
  failedFiles: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  failedItems?: { remoteName: string; error: string | null }[];
}

export interface QueueCounts {
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  waiting: number;
  paused: number;
  isPaused: boolean;
}

export interface GalleryAsset {
  id: string;
  type: string;
  originalFilename?: string;
  capturedAt: string | null;
  createdAt: string;
  width: number | null;
  height: number | null;
  thumbhash: string | null;
  thumbUrl: string | null;
  previewUrl: string | null;
}

export interface GalleryResponse {
  organization: { name: string | null };
  event: {
    id: string;
    name: string;
    startsAt: string | null;
    endsAt: string | null;
    showAllPhotos: boolean;
    canDownloadAllPhotos: boolean;
  };
  status: string;
  name: string;
  assets: GalleryAsset[];
}

// --- auth ---

export type SelfieProgress =
  | { mode: 'email' }
  | {
      mode: 'live';
      status: 'processing' | 'no_face' | 'pending_match' | 'matched';
      position: number | null;
      etaSeconds: number | null;
      matchedCount: number;
    };

export type OrgPlan = 'starter' | 'pro' | 'enterprise';

export interface QuotaStatus {
  plan: OrgPlan;
  storage: { usedBytes: number; limitBytes: number; remainingBytes: number };
  events: { used: number; limit: number; remaining: number };
  // A super admin has negotiated limits for this org, so the plan's own figures
  // do not apply and the UI should not quote them.
  hasCustomLimits: boolean;
}

export type AuditRetention = 'same_day' | 'thirty_days' | 'never';
export type AuditLevel = 'info' | 'warning' | 'error';

export interface AuditEntry {
  id: string;
  createdAt: string;
  category: string;
  retention: AuditRetention;
  level: AuditLevel;
  action: string;
  message: string;
  detail: unknown | null;
  orgId: string | null;
  userId: string | null;
}

export interface AuditSummary {
  total: number;
  oldest: string | null;
  byRetention: Record<AuditRetention, number>;
}

export const api = {
  login: (email: string, password: string) =>
    post<{ accessToken: string; userId: string }>('/auth/login', { email, password }),
  logout: () => post<void>('/auth/logout'),
  me: () => get<Me>('/auth/me'),
  changePassword: (password: string, newPassword: string) => put<void>('/auth/password', { password, newPassword }),

  // --- super admin ---
  admin: {
    listOrgs: () => get<Organization[]>('/admin/organizations'),
    createOrg: (body: { name: string; slug: string; owner: { email: string; name: string; password?: string } }) =>
      post<Organization>('/admin/organizations', body),
    updateOrg: (orgId: string, body: Partial<{ name: string; slug: string; status: string }>) =>
      put<Organization>(`/admin/organizations/${orgId}`, body),
    removeOrg: (orgId: string) => del<void>(`/admin/organizations/${orgId}`),
    stats: () => get<AdminStats>('/admin/stats'),
    queues: () => get<Record<string, QueueCounts>>('/admin/queues'),
    queueAction: (name: string, action: string) => post<void>(`/admin/queues/${name}/${action}`),
    jobs: () => get<{ queues: JobQueue[] }>('/admin/jobs'),
    failedJobs: (name: string) =>
      get<{ id: string; name: string; data: Record<string, unknown>; reason: string; failedAt: number | null }[]>(
        `/admin/queues/${name}/failed`,
      ),
    system: () => get<SystemStatus>('/admin/system'),
    gpu: () => get<GpuStatusResponse>('/admin/gpu'),
    updateGpuConfig: (body: Partial<GpuAutostartConfig>) => put<GpuAutostartConfig>('/admin/gpu/config', body),
    // Read-only provider check (runs `jl get` for JarvisLabs).
    testGpuProvider: () => post<{ ok: boolean; detail: string }>('/admin/gpu/test', {}),
    // Audit trail (migration 0012). `after` is the live tail: send the newest
    // timestamp already on screen and an idle poll comes back empty.
    audit: (query: { category?: string; level?: string; limit?: number; before?: string; after?: string } = {}) => {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') {
          search.set(key, String(value));
        }
      }
      const qs = search.toString();
      return get<AuditEntry[]>(`/admin/audit${qs ? `?${qs}` : ''}`);
    },
    auditSummary: () => get<AuditSummary>('/admin/audit/summary'),
    flushAudit: (retention?: string) => post<{ removed: number }>('/admin/audit/flush', { retention }),

    updatePlan: (
      orgId: string,
      body: { plan?: OrgPlan; storageLimitBytes?: number | null; eventLimit?: number | null },
    ) => put<unknown>(`/admin/organizations/${orgId}/plan`, body),

    startGpu: () => post<GpuLifecycleState>('/admin/gpu/start', {}),
    // Pause the idle-shutdown timer for a window. Does not start the box.
    holdGpu: (minutes = 60) => post<GpuLifecycleState>('/admin/gpu/hold', { minutes }),
    clearGpuHold: () => del<GpuLifecycleState>('/admin/gpu/hold'),
    stopGpu: () => post<GpuLifecycleState>('/admin/gpu/stop', {}),
    // --- support inbox ---
    supportTickets: (status?: 'open' | 'resolved') =>
      get<SupportTicket[]>(`/admin/support${status ? `?status=${status}` : ''}`),
    updateSupportTicket: (id: string, status: 'open' | 'resolved') =>
      put<void>(`/admin/support/${id}`, { status }),
    updateRetention: (body: { purgeGraceHours: number }) =>
      put<{ purgeGraceHours: number }>('/admin/retention', body),
  },

  // --- orgs & events ---
  orgs: {
    quota: (orgId: string) => get<QuotaStatus>(`/orgs/${orgId}/quota`),
    // Everything the app shell needs in one call: sidebar events with covers
    // plus the storage footer.
    shell: (orgId: string) => get<OrgShell>(`/orgs/${orgId}/shell`),
    usage: (orgId: string) => get<OrgUsage>(`/orgs/${orgId}/usage`),
    submitSupport: (orgId: string, message: string) =>
      post<{ id: string }>(`/orgs/${orgId}/support`, { message }),
    notifications: (orgId: string) => get<{ items: OrgNotification[]; unread: number }>(`/orgs/${orgId}/notifications`),
    assets: (orgId: string, cursor?: string, limit = 120) =>
      get<{ assets: OrgTimelineAsset[]; nextCursor: string | null }>(
        `/orgs/${orgId}/assets?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      ),
    people: (orgId: string) => get<OrgPerson[]>(`/orgs/${orgId}/people`),
    mapMarkers: (orgId: string) => get<MapMarker[]>(`/orgs/${orgId}/map-markers`),
    members: (orgId: string) =>
      get<{ userId: string; email: string; name: string; role: string }[]>(`/orgs/${orgId}/members`),
    addMember: (orgId: string, body: { email: string; name?: string; password?: string; role: string }) =>
      post<void>(`/orgs/${orgId}/members`, body),
  },

  events: {
    listMine: () => get<EventItem[]>('/events'),
    listByOrg: (orgId: string) => get<EventItem[]>(`/orgs/${orgId}/events`),
    create: (orgId: string, body: { name: string; slug: string; description?: string }) =>
      post<EventItem>(`/orgs/${orgId}/events`, body),
    get: (eventId: string) => get<EventItem>(`/events/${eventId}`),
    update: (eventId: string, body: Partial<EventItem>) => put<EventItem>(`/events/${eventId}`, body),
    remove: (eventId: string) => del<void>(`/events/${eventId}`),
    processing: (eventId: string) => get<ProcessingStatus>(`/events/${eventId}/processing`),
    reprocessFaces: (eventId: string, force = false) =>
      post<{ queued: number }>(`/events/${eventId}/reprocess-faces`, { force }),
    // Expiration. `extend` with null clears the expiry entirely and cancels
    // any scheduled purge; `purge` skips the grace period and is irreversible.
    extendExpiry: (eventId: string, expiresAt: string | null) =>
      post<EventItem>(`/events/${eventId}/expiry/extend`, { expiresAt }),
    acknowledgeExpiry: (eventId: string) => post<EventItem>(`/events/${eventId}/expiry/acknowledge`, {}),
    setCover: (eventId: string, assetId: string | null) =>
      put<EventItem>(`/events/${eventId}/cover`, { assetId }),
    purgeExpired: (eventId: string) => post<EventItem>(`/events/${eventId}/expiry/purge`, {}),
  },

  // --- assets ---
  assets: {
    get: (eventId: string, assetId: string) => get<AssetDetail>(`/events/${eventId}/assets/${assetId}`),
    list: (eventId: string, cursor?: string, limit = 100, faceStatus?: 'pending' | 'found' | 'none') =>
      get<{ assets: AssetItem[]; nextCursor: string | null }>(
        `/events/${eventId}/assets?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}${
          faceStatus ? `&faceStatus=${faceStatus}` : ''
        }`,
      ),
    bulkUploadCheck: (eventId: string, assets: { id: string; checksum: string }[]) =>
      post<{ results: { id: string; action: 'accept' | 'reject'; assetId?: string }[] }>(
        `/events/${eventId}/assets/bulk-upload-check`,
        { assets },
      ),
    remove: (eventId: string, ids: string[]) => del<{ deleted: number }>(`/events/${eventId}/assets`, { ids }),
    random: (eventId: string, limit = 15) => get<AssetItem[]>(`/events/${eventId}/assets/random?limit=${limit}`),
    // CLIP nearest-neighbours for "view similar photos", ranked most-similar
    // first. Empty until the asset's embedding has been computed.
    similar: (eventId: string, assetId: string) => get<AssetItem[]>(`/events/${eventId}/assets/${assetId}/similar`),
    downloadUrl: (eventId: string, assetId: string) => `/api/events/${eventId}/assets/${assetId}/download`,
    // Same-origin bytes for canvas-reading viewer features (copy image, the
    // editor's crop export) — the presigned R2 URL is cross-origin with no
    // CORS headers, which taints any canvas drawn from it.
    imageUrl: (eventId: string, assetId: string) => `/api/events/${eventId}/assets/${assetId}/image`,
    downloadManyUrl: (eventId: string) => `/api/events/${eventId}/assets/download`,
    runJob: (eventId: string, assetId: string, name: string, force?: boolean) =>
      post<void>(`/events/${eventId}/assets/${assetId}/jobs`, { name, force }),
  },

  // --- people ---
  people: {
    list: (eventId: string) => get<PersonItem[]>(`/events/${eventId}/people`),
    get: (eventId: string, personId: string) =>
      get<{ id: string; name: string; isHidden: boolean; thumbnailUrl: string | null }>(
        `/events/${eventId}/people/${personId}`,
      ),
    update: (eventId: string, personId: string, body: { name?: string; isHidden?: boolean }) =>
      put<PersonItem>(`/events/${eventId}/people/${personId}`, body),
    // folds `ids` into `personId` (Immich-style merge)
    merge: (eventId: string, personId: string, ids: string[]) =>
      post<{ id: string; mergedCount: number; facesMoved: number }>(
        `/events/${eventId}/people/${personId}/merge`,
        { ids },
      ),
    // choose which detected face is cropped for this person's portrait
    setCover: (eventId: string, personId: string, faceId: string) =>
      put<{ id: string; faceAssetFaceId: string }>(`/events/${eventId}/people/${personId}/cover`, { faceId }),
    assets: (eventId: string, personId: string) =>
      get<AssetItem[]>(`/events/${eventId}/people/${personId}/assets`),
  },

  // --- participants (org) ---
  participants: {
    list: (eventId: string) => get<ParticipantItem[]>(`/events/${eventId}/participants`),
    resend: (eventId: string, participantId: string) =>
      post<void>(`/events/${eventId}/participants/${participantId}/resend`),
    remove: (eventId: string, participantId: string) =>
      del<void>(`/events/${eventId}/participants/${participantId}`),
  },

  // --- cloud imports (M5) ---
  cloud: {
    authorizeUrl: (orgId: string, provider: 'gdrive' | 'onedrive') =>
      `/api/orgs/${orgId}/cloud/${provider}/authorize`,
    listAccounts: (orgId: string) => get<CloudAccountItem[]>(`/orgs/${orgId}/cloud/accounts`),
    disconnect: (orgId: string, accountId: string) => del<void>(`/orgs/${orgId}/cloud/accounts/${accountId}`),
    listFolders: (orgId: string, accountId: string, parentId?: string) =>
      get<{ id: string; name: string; hasChildren: boolean }[]>(
        `/orgs/${orgId}/cloud/accounts/${accountId}/folders${parentId ? `?parentId=${encodeURIComponent(parentId)}` : ''}`,
      ),
  },

  imports: {
    create: (eventId: string, body: { accountId: string; folderId: string; folderName: string; recursive: boolean }) =>
      post<ImportProgress>(`/events/${eventId}/imports`, body),
    list: (eventId: string) => get<ImportProgress[]>(`/events/${eventId}/imports`),
    get: (eventId: string, importId: string) => get<ImportProgress>(`/events/${eventId}/imports/${importId}`),
    cancel: (eventId: string, importId: string) => post<void>(`/events/${eventId}/imports/${importId}/cancel`),
  },

  // --- public ---
  public: {
    event: (slug: string) =>
      get<{
        organization: { name: string | null };
        id: string;
        name: string;
        description: string | null;
        startsAt: string | null;
        endsAt: string | null;
      }>(`/public/events/${slug}`),
    // 1–3 photos of the same person; the backend treats them as one identity.
    submitSelfie: (slug: string, body: { email: string; name: string; phone?: string; selfies: File[] }) => {
      const form = new FormData();
      form.append('email', body.email);
      form.append('name', body.name);
      if (body.phone) {
        form.append('phone', body.phone);
      }
      for (const selfie of body.selfies) {
        form.append('selfie', selfie);
      }
      return request<{ message: string; progressTicket: string }>(`/public/events/${slug}/participants`, {
        method: 'POST',
        body: form,
      });
    },
    // Queue position while the guest waits on the page. `mode: 'email'` means
    // the GPU box is off, starting, or too loaded for an estimate to be honest
    // — fall back to telling them to watch their inbox.
    selfieProgress: (ticket: string) => get<SelfieProgress>(`/public/selfie-progress/${ticket}`),
    // Public help form. Name and email are optional — a guest who cannot get
    // into their gallery should not have to identify themselves to say so.
    submitSupport: (body: { message: string; name?: string; email?: string; eventId?: string }) =>
      post<{ id: string }>('/public/support', body),
    gallery: (token: string) => get<GalleryResponse>(`/public/gallery/${token}`),
    // whole-event gallery — 404s unless the organiser shared it
    eventAssets: (token: string, cursor?: string, limit = 100) =>
      get<{ assets: GalleryAsset[]; nextCursor: string | null }>(
        `/public/gallery/${token}/event-assets?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      ),
    galleryDownloadUrl: (token: string, assetId: string) => `/api/public/gallery/${token}/assets/${assetId}/download`,
    galleryDownloadAllUrl: (token: string) => `/api/public/gallery/${token}/download`,
    assetFaces: (token: string, assetId: string) =>
      get<{ faces: FaceBoxDto[] }>(`/public/gallery/${token}/assets/${assetId}/faces`),
    person: (token: string, personId: string) =>
      get<{ person: { id: string; name: string }; assets: AssetItem[] }>(
        `/public/gallery/${token}/people/${personId}`,
      ),
  },
};

// Saves a blob response under `filename`. Used for every download in the app:
// fetching rather than navigating keeps the presigned redirect from opening the
// image in a tab, and keeps the original filename.
export async function saveBlob(response: Response, filename: string) {
  if (!response.ok) {
    throw new ApiError(response.status, `Download failed (${response.status})`);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function downloadSelectionZip(url: string, ids: string[], filename: string) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  await saveBlob(response, filename);
}

// SHA-1 preflight hash (browser) — hex string matching the backend's inline
// hash (docs/plan/04 §3).
export async function sha1Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-1', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// XHR upload with progress events (fetch has no upload progress).
export function uploadAsset(
  eventId: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<{ id: string; status: 'created' | 'duplicate' }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/events/${eventId}/assets`);
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        let message = xhr.statusText;
        try {
          message = JSON.parse(xhr.responseText).message ?? message;
        } catch {
          // ignore
        }
        reject(new ApiError(xhr.status, message));
      }
    });
    xhr.addEventListener('error', () => reject(new ApiError(0, 'Network error')));
    const form = new FormData();
    form.append('assetData', file);
    xhr.send(form);
  });
}
