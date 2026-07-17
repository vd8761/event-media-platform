# 08 — Google Drive & OneDrive Import

Net-new subsystem — Immich has **no** cloud import (its "external libraries" feature only scans local disk paths and is not reused). Runs entirely on the **ingest role** (main VM): network-bound listing + downloading, then hands assets to the standard processing pipeline.

## 1. OAuth 2.0 (authorization-code, server-side)

Per-organization connections stored in `cloud_account` ([03-database-schema.md](03-database-schema.md)).

| | Google Drive | OneDrive (Microsoft Graph) |
|---|---|---|
| Authorize URL | `https://accounts.google.com/o/oauth2/v2/auth` | `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` |
| Scopes | `https://www.googleapis.com/auth/drive.readonly` | `Files.Read.All offline_access User.Read` |
| Extras | `access_type=offline`, `prompt=consent` (forces refresh token) | — |
| Token URL | `https://oauth2.googleapis.com/token` | `https://login.microsoftonline.com/common/oauth2/v2.0/token` |
| App registration | Google Cloud Console (`GOOGLE_CLIENT_ID/SECRET`) | Entra ID app (`MS_CLIENT_ID/SECRET`) |

Flow:
1. `GET /api/orgs/{orgId}/cloud/{provider}/authorize` → 302 to provider. `state` = short-lived signed JWT `{orgId, userId, nonce}` (10 min).
2. `GET /api/cloud/{provider}/callback?code&state` → verify state, exchange code, fetch account email (Drive `about.get` / Graph `/me`), **upsert `cloud_account`** with AES-256-GCM-encrypted tokens (`EL_TOKEN_ENCRYPTION_KEY`, 32 bytes; `iv||tag||ciphertext`, random IV per value). Redirect to org cloud-accounts settings page.
3. Access tokens refreshed lazily (in-process cache until `token_expires_at - 60s`). Refresh failure (revoked consent) → set `revoked_at`, fail active imports with an actionable "reconnect" error.
4. Disconnect: `DELETE /api/orgs/{orgId}/cloud/accounts/{accountId}` → best-effort provider token revocation + row soft-delete.

Note: this OAuth is **import-only**. Org user *login* remains password/session auth ([09-api-surface.md](09-api-surface.md)).

## 2. Folder browsing (server-mediated picker)

`GET /api/orgs/{orgId}/cloud/accounts/{accountId}/folders?parentId=…` → `[{id, name, hasChildren}]`

- **Drive**: `drive.files.list` with `q = "'{parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"`, `fields id,name`, root = `root`.
- **Graph**: `GET /me/drive/items/{id}/children` (root: `/me/drive/root/children`), keep entries with the `folder` facet.

Server-mediated tree-drill (no Google Picker JS) keeps everything behind our API and one consistent UI for both providers.

## 3. Import pipeline

State machine in `import_job` / `import_item`; queue flow in [05-job-orchestration.md](05-job-orchestration.md) §3.

**`ImportFolder {importJobId}`** (concurrency 1):
1. Page the listing, recursing subfolders when `recursive`:
   - Drive: `files.list` `q="'{folder}' in parents and trashed=false"`, `pageSize=1000`, `fields=nextPageToken,files(id,name,size,md5Checksum,mimeType)`.
   - Graph: `/me/drive/items/{id}/children` following `@odata.nextLink`; hashes from `file.hashes` (`sha1Hash` or `quickXorHash`).
2. Keep `image/*` and `video/*` mimetypes only.
3. Upsert `import_item` on **`unique(event_id, provider, remote_id)`**:
   - existing `done` with same `remote_checksum` → `skipped_duplicate` (**incremental re-sync** — re-importing a folder only fetches new/changed files);
   - changed checksum → new `pending` item (event photos are effectively immutable; the changed file imports as a **new asset**, no versioning);
   - new → `pending`.
4. Set `total_files`, flip job → `importing`, enqueue `ImportFile` per pending item.

**`ImportFile {importItemId}`** (concurrency 4):
1. Fresh access token; stream download — Drive `files/{id}?alt=media`, Graph `/items/{id}/content` (302 to a pre-authenticated URL) — into `/staging`, computing **SHA-1 inline** (same hashing utility as browser upload, [04-storage-r2.md](04-storage-r2.md) §3).
2. Dedupe on `(event_id, checksum)`: hit → item `skipped_duplicate` with `asset_id` linked to the existing asset (covers "file was also uploaded manually").
3. Miss → R2 `putFile` original, insert `asset` (`source: 'gdrive' | 'onedrive'`), enqueue `mediaProcess:AssetProcess`.
4. Update job counters atomically; the last finished item flips job → `done` (with `failed_files`/`skipped_files` totals).

Cancel: `POST /api/imports/{id}/cancel` → job `cancelled`; in-flight `ImportFile` jobs check status before download.

## 4. Rate limits, retries, failure surfacing

- BullMQ 5 attempts, exponential backoff. On **429/403-rate-limit**, honor the provider's `Retry-After` by re-queueing with exactly that delay.
- Budgets: Drive ≈ 12 k queries/user/60 s (listing is cheap, `alt=media` downloads count); Graph throttles dynamically per app+tenant. `ImportFile` concurrency 4 stays well under both; make it a config knob.
- Large folders (10 k+ files): listing pages are processed incrementally (items upserted per page) so progress is visible during `listing`.
- Failures are **per-item**, never job-fatal: `import_item.status='failed'` + error string, shown in the import progress UI with per-item retry; the job completes with counts.

## 5. Progress UI contract

`GET /api/imports/{id}` → `{status, totalFiles, doneFiles, skippedFiles, failedFiles, error?}` — polled by the web import screen ([10-web-app.md](10-web-app.md)). `GET /api/events/{eventId}/imports` lists history.

## 6. Env vars

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `EL_TOKEN_ENCRYPTION_KEY`, `EL_PUBLIC_BASE_URL` (OAuth redirect URIs: `{EL_PUBLIC_BASE_URL}/api/cloud/{provider}/callback`). Full reference: [11-deployment.md](11-deployment.md).
