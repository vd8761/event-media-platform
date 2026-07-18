// OneDrive / Microsoft Graph client (docs/plan/08 §1-3): Files.Read.All +
// offline_access, /children paging via @odata.nextLink, /content download
// (302 to a pre-authenticated URL — fetch follows it).
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

const AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const API = 'https://graph.microsoft.com/v1.0';

interface DriveItem {
  id: string;
  name: string;
  size?: number;
  folder?: { childCount?: number };
  file?: { mimeType?: string; hashes?: { sha1Hash?: string; quickXorHash?: string } };
}

export class OneDriveProvider implements CloudProviderClient {
  readonly scopes = ['Files.Read.All', 'offline_access', 'User.Read'];

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
    const response = await this.get(accessToken, `${API}/me`);
    const body = (await response.json()) as { mail?: string; userPrincipalName?: string };
    const email = body.mail ?? body.userPrincipalName;
    if (!email) {
      throw new Error('Microsoft Graph: could not resolve account email');
    }
    return email;
  }

  async listFolders(accessToken: string, parentId?: string): Promise<RemoteFolder[]> {
    const base = parentId ? `${API}/me/drive/items/${parentId}/children` : `${API}/me/drive/root/children`;
    const response = await this.get(accessToken, `${base}?$select=id,name,folder&$top=200`);
    const body = (await response.json()) as { value: DriveItem[] };
    return body.value
      .filter((item) => item.folder)
      .map((item) => ({ id: item.id, name: item.name, hasChildren: (item.folder?.childCount ?? 0) > 0 }));
  }

  async listFilesPage(accessToken: string, folderId: string, pageToken?: string): Promise<RemoteListingPage> {
    // pageToken carries the full @odata.nextLink
    const url =
      pageToken ??
      `${API}/me/drive/items/${folderId}/children?$select=id,name,size,file,folder&$top=200`;
    const response = await this.get(accessToken, url);
    const body = (await response.json()) as { value: DriveItem[]; '@odata.nextLink'?: string };

    return {
      files: body.value
        .filter((item) => item.file)
        .map((item) => ({
          id: item.id,
          name: item.name,
          size: item.size ?? null,
          checksum: item.file?.hashes?.sha1Hash ?? item.file?.hashes?.quickXorHash ?? null,
          mimeType: item.file?.mimeType ?? 'application/octet-stream',
        })),
      subfolderIds: body.value.filter((item) => item.folder).map((item) => item.id),
      nextPageToken: body['@odata.nextLink'],
    };
  }

  async downloadToFile(accessToken: string, fileId: string, destPath: string): Promise<void> {
    const response = await this.get(accessToken, `${API}/me/drive/items/${fileId}/content`);
    await pipeline(Readable.fromWeb(response.body as any), createWriteStream(destPath));
  }

  private async tokenRequest(params: Record<string, string>): Promise<OAuthTokens> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    if (!response.ok) {
      throw new Error(`Microsoft token request failed (${response.status}): ${await response.text()}`);
    }
    const body = (await response.json()) as { access_token: string; refresh_token?: string; expires_in: number };
    return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresInSec: body.expires_in };
  }

  private async get(accessToken: string, url: string): Promise<Response> {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    throwIfRateLimited(response);
    if (!response.ok) {
      throw new Error(`Microsoft Graph request failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    }
    return response;
  }
}
