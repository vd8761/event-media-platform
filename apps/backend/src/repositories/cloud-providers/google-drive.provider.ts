// Google Drive client (docs/plan/08 §1-3): drive.readonly OAuth with forced
// refresh token, files.list paging, alt=media streaming download.
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  CloudProviderClient,
  OAuthTokens,
  RemoteFolder,
  RemoteListingPage,
  throwIfRateLimited,
} from 'src/repositories/cloud-providers/types';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class GoogleDriveProvider implements CloudProviderClient {
  readonly scopes = ['https://www.googleapis.com/auth/drive.readonly'];

  constructor(
    private clientId: string,
    private clientSecret: string,
  ) {}

  authorizeUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: this.scopes.join(' '),
      access_type: 'offline', // forces a refresh token
      prompt: 'consent',
      state,
    });
    return `${AUTH_URL}?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    return this.tokenRequest({
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
  }

  async refresh(refreshToken: string): Promise<OAuthTokens> {
    return this.tokenRequest({
      refresh_token: refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'refresh_token',
    });
  }

  async getAccountEmail(accessToken: string): Promise<string> {
    const response = await this.get(accessToken, `${API}/about?fields=user(emailAddress)`);
    const body = (await response.json()) as { user?: { emailAddress?: string } };
    if (!body.user?.emailAddress) {
      throw new Error('Google Drive: could not resolve account email');
    }
    return body.user.emailAddress;
  }

  async listFolders(accessToken: string, parentId = 'root'): Promise<RemoteFolder[]> {
    const query = `'${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`;
    const params = new URLSearchParams({ q: query, fields: 'files(id,name)', pageSize: '1000' });
    const response = await this.get(accessToken, `${API}/files?${params}`);
    const body = (await response.json()) as { files: { id: string; name: string }[] };
    // knowing hasChildren would cost one query per folder — let the tree try
    return body.files.map((folder) => ({ id: folder.id, name: folder.name, hasChildren: true }));
  }

  async listFilesPage(accessToken: string, folderId: string, pageToken?: string): Promise<RemoteListingPage> {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken,files(id,name,size,md5Checksum,mimeType)',
      pageSize: '1000',
    });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }
    const response = await this.get(accessToken, `${API}/files?${params}`);
    const body = (await response.json()) as {
      nextPageToken?: string;
      files: { id: string; name: string; size?: string; md5Checksum?: string; mimeType: string }[];
    };

    return {
      files: body.files
        .filter((file) => file.mimeType !== FOLDER_MIME)
        .map((file) => ({
          id: file.id,
          name: file.name,
          size: file.size ? Number(file.size) : null,
          checksum: file.md5Checksum ?? null,
          mimeType: file.mimeType,
        })),
      subfolderIds: body.files.filter((file) => file.mimeType === FOLDER_MIME).map((folder) => folder.id),
      nextPageToken: body.nextPageToken,
    };
  }

  async downloadToFile(accessToken: string, fileId: string, destPath: string): Promise<void> {
    const response = await this.get(accessToken, `${API}/files/${fileId}?alt=media`);
    await pipeline(Readable.fromWeb(response.body as any), createWriteStream(destPath));
  }

  private async tokenRequest(params: Record<string, string>): Promise<OAuthTokens> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    if (!response.ok) {
      throw new Error(`Google token request failed (${response.status}): ${await response.text()}`);
    }
    const body = (await response.json()) as { access_token: string; refresh_token?: string; expires_in: number };
    return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresInSec: body.expires_in };
  }

  private async get(accessToken: string, url: string): Promise<Response> {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    throwIfRateLimited(response);
    if (!response.ok) {
      throw new Error(`Google Drive request failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    }
    return response;
  }
}
