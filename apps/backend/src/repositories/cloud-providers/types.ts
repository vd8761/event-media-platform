// Provider abstraction for cloud imports (docs/plan/08). Both providers
// normalize to these shapes; the import pipeline never sees provider APIs.

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresInSec: number;
}

export interface RemoteFile {
  id: string;
  name: string;
  size: number | null;
  // Drive md5Checksum / Graph sha1Hash-or-quickXorHash (docs/plan/03
  // import_item.remote_checksum) — only used for incremental re-sync equality
  checksum: string | null;
  mimeType: string;
}

export interface RemoteFolder {
  id: string;
  name: string;
  hasChildren: boolean;
}

export interface RemoteListingPage {
  files: RemoteFile[];
  subfolderIds: string[];
  nextPageToken?: string;
}

// thrown on provider 429/rate-limit responses; the import queue honors
// Retry-After exactly (docs/plan/08 §4)
export class ProviderRateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super(`Provider rate limit — retry after ${retryAfterMs} ms`);
  }
}

export interface CloudProviderClient {
  authorizeUrl(redirectUri: string, state: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>;
  refresh(refreshToken: string): Promise<OAuthTokens>;
  getAccountEmail(accessToken: string): Promise<string>;
  listFolders(accessToken: string, parentId?: string): Promise<RemoteFolder[]>;
  listFilesPage(accessToken: string, folderId: string, pageToken?: string): Promise<RemoteListingPage>;
  downloadToFile(accessToken: string, fileId: string, destPath: string): Promise<void>;
  readonly scopes: string[];
}

export function throwIfRateLimited(response: Response): void {
  if (response.status === 429 || response.status === 403) {
    const retryAfter = response.headers.get('retry-after');
    if (response.status === 429 || retryAfter) {
      const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : 30;
      throw new ProviderRateLimitError((Number.isNaN(seconds) ? 30 : seconds) * 1000);
    }
  }
}
