# 04 — Cloudflare R2 Storage Design

Immich stores everything on a local filesystem via `immich:server/src/cores/storage.core.ts` — it has **no object-storage support**. EventLens replaces that layer entirely with an S3-compatible repository against **Cloudflare R2**. Only the derivative *specifications* (sizes, formats, quality) are carried over from Immich.

## 1. `StorageRepository` (new)

`apps/backend/src/repositories/storage.repository.ts`, built on `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/lib-storage`:

```ts
interface StorageRepository {
  putFile(localPath: string, key: string, contentType: string): Promise<void>;    // lib-storage multipart for large files
  putBuffer(buf: Buffer, key: string, contentType: string): Promise<void>;
  downloadToFile(key: string, localPath: string): Promise<void>;
  presignGet(key: string, opts: { expiresIn: number; filename?: string }): Promise<string>;
  deleteKeys(keys: string[]): Promise<void>;       // DeleteObjects, batches of 1000
  deletePrefix(prefix: string): Promise<void>;     // ListObjectsV2 + batch delete loop
}
```

Client config: `endpoint: R2_ENDPOINT` (`https://<account_id>.r2.cloudflarestorage.com`), `region: 'auto'`, `forcePathStyle: true`, credentials `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` (bucket-scoped API token, object read/write only). Bucket: `R2_BUCKET` (default `eventlens-media`).

Presigning is a **local HMAC computation** (no network round-trip) — safe to do inline for every asset in a list response.

## 2. Key scheme (single private bucket)

```
org/{orgId}/event/{eventId}/original/{assetId}{.ext}     # as-uploaded original
org/{orgId}/event/{eventId}/preview/{assetId}.jpeg       # 1440px JPEG q80   (Immich preview spec)
org/{orgId}/event/{eventId}/thumb/{assetId}.webp         # 250px  WebP q80   (Immich thumbnail spec)
org/{orgId}/event/{eventId}/video/{assetId}.mp4          # transcoded playback copy (H.264 720p, Immich ffmpeg defaults)
org/{orgId}/event/{eventId}/person/{personId}.jpeg       # 250px face crop   (FACE_THUMBNAIL_SIZE, immich:server/src/constants.ts)
org/{orgId}/event/{eventId}/selfie/{participantId}.jpg   # participant selfie
```

Rationale: org/event prefixing makes cascade deletion a single `deletePrefix` call and keeps the blast radius of any mistake obvious. Derivative specs come from `immich:server/src/config.ts` image defaults (thumbnail WebP 250 q80, preview JPEG 1440 q80) and `immich:server/src/services/media.service.ts`.

## 3. Upload path: through-API (Decision D5)

Uploads go **through the backend** as multipart POSTs — Immich's exact flow — not browser→R2 presigned PUTs:

1. The ported multer storage (`immich:server/src/middleware/file-upload.interceptor.ts`) streams the request body to a **local staging file** (`/staging/{uuid}`) while computing **SHA-1 inline** — a *trusted* checksum. A presigned PUT cannot reliably enforce SHA-1 server-side on R2.
2. The web SHA-1 preflight ports unchanged: browser hashes the file in a web worker (`immich:web/src/lib/workers/hash-file.ts`) and calls `POST /api/events/{eventId}/assets/bulk-upload-check`; known duplicates are never sent.
3. No R2 CORS configuration, no browser-visible credentials, no orphaned-object reconciliation for half-finished PUTs.

**Flow** (`upload.service.ts`, pattern `immich:server/src/services/asset-media.service.ts`):

```
POST /api/events/{eventId}/assets  (multipart: assetData + metadata fields)
 ├─ multer streams → /staging/{uuid}, SHA-1 computed inline
 ├─ dedupe: select asset where (event_id, checksum) → hit: delete staging,
 │    respond 200 { status:'duplicate', id: existingId }        (Immich DUPLICATE pattern)
 ├─ miss: putFile → org/…/original/{assetId}{.ext}   (streamed multipart for large videos)
 ├─ insert asset row (status 'stored', source 'upload')
 ├─ delete staging file
 └─ enqueue mediaProcess:AssetProcess {assetId} → respond 201 { id }
```

Race safety: the DB unique constraint `(event_id, checksum)` is the final arbiter — on unique-violation the handler answers `duplicate` (constraint-detection helper ported from `immich:server/src/utils/database.ts`).

Sizing: main VM needs ~50 GB `/staging` disk. A `background:StagingSweep` job deletes staging files older than 24 h (crashed uploads).

*Revisit presigned PUT only if the API VM's bandwidth saturates (risk R5 in [12-roadmap.md](12-roadmap.md)).*

## 4. GPU worker I/O

Job payloads carry **IDs only**. Every media handler on the GPU worker:

```
downloadToFile(asset.storage_key, /cache/{assetId})     # stage original from R2
→ sharp / ffmpeg / ML sidecar on the local file          # both need real files, not streams
→ putFile derivatives → R2 (preview/thumb/video/person keys)
→ insert asset_file rows / update person.thumbnail_key
→ delete /cache temp files (finally-block + orphan sweep)
```

The `/cache` volume must hold `concurrency × largest-expected-video`. R2 → GPU-VM egress is **free** (R2 has zero egress fees), so the GPU VM can live in any cloud.

## 5. Serving media

- **Private bucket, presigned GETs everywhere.** Event photos are private to the org and matched participants — never a public bucket, no public custom domain.
- **List endpoints** (org gallery, participant gallery) embed `thumbUrl` / `previewUrl` per asset, presigned with **1 h expiry**. The web layer refetches the listing when an `<img>` gets a 403 (expired) — see [10-web-app.md](10-web-app.md).
- **Original download**: `GET .../assets/{id}/download` → **302 redirect** to a presigned GET with `response-content-disposition: attachment; filename="…"`, 15 min expiry. The backend never proxies media bytes after upload.
- **Emails contain no media URLs** — only the tokenized gallery link (presigned URLs would be dead in the inbox within an hour).

## 6. Deletion lifecycle

1. API soft-deletes rows immediately (`deleted_at`), which hides them from all queries.
2. Enqueue on `storageCleanup` (ingest role): `CleanupKeys {keys}` for single assets (original + preview + thumb + video), `CleanupPrefix {prefix}` for event/org deletion (`org/{orgId}/event/{eventId}/`).
3. After a 7-day grace period a nightly `background` job hard-deletes soft-deleted rows and runs a **reconciliation sweep**: list R2 prefixes of hard-deleted events and remove any stragglers (covers cleanup jobs lost to crashes).
4. Selfie retention is stricter — see [07-participant-flow.md](07-participant-flow.md) §6 (`SelfieRetentionSweep`).

## 7. Env vars

| Var | Example | Notes |
|---|---|---|
| `R2_ENDPOINT` | `https://<account_id>.r2.cloudflarestorage.com` | |
| `R2_BUCKET` | `eventlens-media` | single bucket |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | — | bucket-scoped token; separate tokens for main VM and GPU VM |

Full env reference: [11-deployment.md](11-deployment.md).
