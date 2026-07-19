// Hand-written typed client for the EventLens API. Sessions ride on the
// HttpOnly cookie (same-origin via the vite proxy / production reverse proxy).
// A generated packages/sdk client (docs/plan/10 §4) can replace this later.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

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
    try {
      const body = await response.json();
      message = Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? message);
    } catch {
      // not json
    }
    throw new ApiError(response.status, message);
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
  config: { matchMaxDistance?: number; minScore?: number };
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

export interface AssetDetail extends AssetItem {
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

export interface SystemStatus {
  machineLearning: {
    device: 'cpu' | 'cuda';
    deviceIsConfigured: boolean;
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

export interface GalleryResponse {
  event: { name: string; startsAt: string | null; endsAt: string | null };
  status: string;
  assets: {
    id: string;
    type: string;
    capturedAt: string | null;
    createdAt: string;
    width: number | null;
    height: number | null;
    thumbhash: string | null;
    thumbUrl: string | null;
    previewUrl: string | null;
  }[];
}

// --- auth ---

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
    stats: () =>
      get<{ organizations: number; users: number; events: number; assets: number; storageBytes: number; participants: number }>(
        '/admin/stats',
      ),
    queues: () => get<Record<string, QueueCounts>>('/admin/queues'),
    queueAction: (name: string, action: string) => post<void>(`/admin/queues/${name}/${action}`),
    jobs: () => get<{ queues: JobQueue[] }>('/admin/jobs'),
    failedJobs: (name: string) =>
      get<{ id: string; name: string; data: Record<string, unknown>; reason: string; failedAt: number | null }[]>(
        `/admin/queues/${name}/failed`,
      ),
    system: () => get<SystemStatus>('/admin/system'),
  },

  // --- orgs & events ---
  orgs: {
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
    downloadUrl: (eventId: string, assetId: string) => `/api/events/${eventId}/assets/${assetId}/download`,
    runJob: (eventId: string, assetId: string, name: string, force?: boolean) =>
      post<void>(`/events/${eventId}/assets/${assetId}/jobs`, { name, force }),
  },

  // --- people ---
  people: {
    list: (eventId: string) => get<PersonItem[]>(`/events/${eventId}/people`),
    update: (eventId: string, personId: string, body: { name?: string; isHidden?: boolean }) =>
      put<PersonItem>(`/events/${eventId}/people/${personId}`, body),
    assets: (eventId: string, personId: string) =>
      get<{ id: string; originalFilename: string; capturedAt: string | null; thumbUrl: string | null }[]>(
        `/events/${eventId}/people/${personId}/assets`,
      ),
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
      get<{ name: string; description: string | null; startsAt: string | null; endsAt: string | null }>(
        `/public/events/${slug}`,
      ),
    submitSelfie: (slug: string, email: string, selfie: File) => {
      const form = new FormData();
      form.append('email', email);
      form.append('selfie', selfie);
      return request<{ message: string }>(`/public/events/${slug}/participants`, { method: 'POST', body: form });
    },
    gallery: (token: string) => get<GalleryResponse>(`/public/gallery/${token}`),
    galleryDownloadUrl: (token: string, assetId: string) => `/api/public/gallery/${token}/assets/${assetId}/download`,
    galleryDownloadAllUrl: (token: string) => `/api/public/gallery/${token}/download`,
  },
};

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
