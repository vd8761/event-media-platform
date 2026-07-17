# 02 — Monorepo Layout & Immich Code Reuse Map

Immich reference checkout: `C:\Projects\immich` (read-only). `immich:` prefixes below are paths inside it.

## 1. Monorepo layout

pnpm workspace (same tooling family as Immich's root):

```
event-media-platform/
├── pnpm-workspace.yaml
├── docs/plan/                     # this document set
├── apps/
│   ├── backend/                   # NestJS — ONE codebase, deployed as `backend` and `backend-worker`
│   │   ├── Dockerfile             # based on ghcr.io/immich-app/base-images (ffmpeg/libvips ready)
│   │   └── src/
│   │       ├── main.ts            # boots roles from EL_WORKERS_INCLUDE
│   │       ├── workers/           # api.ts, worker.ts entrypoints
│   │       ├── controllers/       # api role only
│   │       ├── services/          # business logic + @OnJob handlers
│   │       ├── repositories/      # kysely / bullmq / r2 / ml-client / email / crypto
│   │       ├── middleware/        # auth.guard.ts, file-upload.interceptor.ts
│   │       ├── emails/            # react-email .tsx templates
│   │       ├── schema/            # kysely DB types
│   │       ├── migrations/        # hand-written kysely migrations
│   │       ├── utils/  dtos/  enum.ts  config.ts  decorators.ts
│   ├── ml/                        # immich:machine-learning/** VERBATIM COPY
│   └── web/                       # SvelteKit 2 static SPA (Immich theme)
├── packages/
│   └── sdk/                       # TS client generated from backend OpenAPI spec
└── docker/
    ├── docker-compose.main.yml    # main VM
    ├── docker-compose.gpu.yml     # GPU VM
    └── example.env
```

## 2. Copy map — Immich → EventLens

Modes: **verbatim** (byte-identical or near), **ported** (copied then adapted — adaptations listed), **pattern** (re-implemented following the Immich file as spec).

### 2.1 ML service

| Immich source | Destination | Mode |
|---|---|---|
| `immich:machine-learning/**` (`immich_ml/**`, `Dockerfile`, `pyproject.toml`, `uv.lock`, `ann/`) | `apps/ml/**` | **Verbatim.** Keep package name `immich_ml`, port 3003, env prefix `MACHINE_LEARNING_*`. Zero diffs = free upstream model/runtime updates. Build with `DEVICE=cuda` for the GPU VM. |

### 2.2 Backend — infrastructure

| Immich source | Destination | Mode & adaptations |
|---|---|---|
| `immich:server/src/repositories/machine-learning.repository.ts` | `apps/backend/src/repositories/machine-learning.repository.ts` | **Ported.** Keep `detectFaces`, `predict`, multipart `getFormData`, `/ping` health map + multi-URL failover. Delete `encodeImage`/`encodeText` (CLIP) and `ocr`. |
| `immich:server/src/repositories/job.repository.ts` | same relative path | **Ported.** Keep `@OnJob` handler registry, startup completeness check, `queue`/`queueAll`. Add `QUEUE_ROLES` filter in `startWorkers()` + `EL_QUEUES_EXCLUDE` (see [01-architecture.md](01-architecture.md) §1). Bull prefix → `el_bull`. |
| `immich:server/src/decorators.ts` | `apps/backend/src/decorators.ts` | **Ported** (`@OnJob`, `@OnEvent`; drop unused). |
| `immich:server/src/repositories/config.repository.ts` | same | **Ported.** Env parsing for `DB_*`, `REDIS_*`, worker include/exclude (`IMMICH_WORKERS_INCLUDE` → `EL_WORKERS_INCLUDE`); add `R2_*`, OAuth, SMTP, `EL_TOKEN_ENCRYPTION_KEY`. |
| `immich:server/src/repositories/crypto.repository.ts` | same | **Verbatim-ish** — bcrypt hashing, SHA-256 token hashing, random bytes/UUID. |
| `immich:server/src/repositories/email.repository.ts` + `immich:server/src/emails/**` (components + layout) | same | **Ported.** nodemailer transport + react-email render pipeline; new templates ([07-participant-flow.md](07-participant-flow.md) §5). |
| `immich:server/src/middleware/auth.guard.ts` + `immich:server/src/services/auth.service.ts` | same | **Ported.** Keep credential priority order (public token → session); replace shared-link branch with **participant gallery-token** branch; roles become super-admin / org-role checks. |
| `immich:server/src/middleware/file-upload.interceptor.ts` | same | **Ported.** Custom multer storage streaming to `/staging` with **inline SHA-1**; field names simplified to `assetData`. |
| `immich:server/src/utils/database.ts` | `apps/backend/src/utils/database.ts` | **Ported.** `vectorIndexQuery` (VectorChord branch), Kysely config helpers, checksum-constraint detection (`asset_event_checksum` unique). |
| `immich:server/Dockerfile` (base image usage) | `apps/backend/Dockerfile` | **Pattern.** Reuse `ghcr.io/immich-app/base-images` — ships the exact ffmpeg/libvips/sharp/libraw toolchain; do not rebuild it. |
| `immich:server/src/cores/storage.core.ts` | — | **NOT copied.** Filesystem-only; replaced by the new R2 `StorageRepository` ([04-storage-r2.md](04-storage-r2.md)). Only the derivative *specs* (sizes/formats/quality) carry over. |

### 2.3 Backend — face pipeline (the heart of the port)

| Immich source | Destination | Mode & adaptations |
|---|---|---|
| `immich:server/src/services/person.service.ts` — `handleDetectFaces`, `handleQueueDetectFaces`, `iou()`, `handleRecognizeFaces` (clustering), `handleQueueRecognizeFaces`, `handlePersonCleanup` | `apps/backend/src/services/face.service.ts` | **Ported.** Every `ownerId`/`userIds` → **`eventId`**; drop birthDate/visibility/isHidden-source logic; preview path becomes an R2-staged local file. Full walkthrough: [06-face-pipeline.md](06-face-pipeline.md). |
| `immich:server/src/repositories/person.repository.ts` — `refreshFaces` (CTE insert asset_face + face_search + delete), `reassignFaces`, `create`, `getRandomFace` | `apps/backend/src/repositories/face.repository.ts` | **Ported.** `ownerId` → `eventId`. |
| `immich:server/src/repositories/search.repository.ts` — `searchFaces` (~line 316: `set local vchordrq.probes`, cosine `<=>` CTE, post-filter `distance <= maxDistance`) | `apps/backend/src/repositories/face-search.repository.ts` | **Ported.** `asset.ownerId = any(:userIds)` → `asset.eventId = :eventId`. Also add `searchFacesByEmbedding(eventId, embedding, …)` for selfie matching (same CTE, embedding passed directly). |
| `immich:server/src/services/media.service.ts` — `handleGenerateThumbnails` (decode-once → preview 1440 JPEG q80 + thumb 250 WebP q80 + thumbhash), `handleGeneratePersonThumbnail` (`getCrop` box math, 250 px, `FACE_THUMBNAIL_SIZE` in `immich:server/src/constants.ts`) | `apps/backend/src/services/media.service.ts` | **Ported.** Wrapped in R2 stage-in / upload-out. |
| `immich:server/src/repositories/media.repository.ts` — sharp decode/resize/thumbhash, fluent-ffmpeg transcode + ffprobe | same | **Ported.** Operates on `/cache` temp paths. |
| `immich:server/src/services/asset-media.service.ts` — `uploadAsset` dedupe flow (unique-violation → `DUPLICATE` response), `bulkUploadCheck` | `apps/backend/src/services/upload.service.ts` | **Pattern.** Constraint becomes `(event_id, checksum)`. |
| `immich:server/src/schema/tables/asset-face.table.ts`, `face-search.table.ts`, `person.table.ts` | `apps/backend/src/schema/` + migration | **Ported column-identical** for `asset_face`/`face_search` (so ported SQL runs unchanged); `person` slimmed + `event_id`. See [03-database-schema.md](03-database-schema.md). |
| `immich:server/src/services/notification.service.ts` | `apps/backend/src/services/notification.service.ts` | **Pattern.** Queue-driven email dispatch on the `notification` queue. |

### 2.4 Web

| Immich source | Destination | Mode & adaptations |
|---|---|---|
| `immich:web/src/app.css` + Tailwind v4 setup + `@immich/ui` dependency + fonts | `apps/web/src/app.css` etc. | **Verbatim** — the Immich look. |
| `immich:web/src/lib/managers/upload-manager.svelte.ts`, `immich:web/src/lib/utils/file-uploader.ts`, `immich:web/src/lib/utils/executor-queue.ts` (2-concurrent XHR), `immich:web/src/lib/workers/hash-file.ts` (SHA-1 preflight), `UploadPanel.svelte`, `UploadAssetPreview.svelte` | `apps/web/src/lib/...` | **Ported.** Target endpoint → `POST /api/events/{eventId}/assets`; preflight → `/assets/bulk-upload-check`. |
| `immich:web/src/lib/managers/timeline-manager/**` + photo-grid/viewer components | `apps/web/src/lib/...` | **Ported** — event gallery + participant gallery grids. |
| `immich:web/src/lib/components/faces-page/**` + `immich:web/src/routes/(user)/people/**` (PeopleCard, person detail patterns) | `apps/web/...` | **Ported** — org People/cluster-review UI. |
| `immich:web/src/routes/(user)/s/[slug]` shared-link pattern (auth key on every request, `auth-manager.svelte.ts` params) | public participant routes | **Pattern** — gallery token on every call. |
| `immich:open-api/**` generator + `immich:packages/sdk` shape | `packages/sdk/` | **Pattern** — typed client generated from the backend OpenAPI spec. |

## 3. Explicitly NOT copied

Albums & album sharing, memories, timeline buckets API, map/places, partners, stacks, tags, trash, duplicate detection (CLIP), smart search (CLIP), OCR, external libraries (local-disk scanning — irrelevant to R2), storage templates, workflows, sync/audit tables + mobile delta-sync, mobile apps, CLI, maintenance worker, HLS streaming (Phase-1 videos play the transcoded MP4 progressively), OAuth *login* for org users (password sessions first; Drive/OneDrive OAuth is only for imports).

Every removal is a feature EventLens does not need; nothing in the face pipeline depends on them.

## 4. Porting rules

1. **Never edit `C:\Projects\immich`** — copy out only.
2. Copy a file, then adapt; keep Immich's structure/naming so future upstream diffs remain readable.
3. `asset_face` / `face_search` stay **column-identical** to Immich — the ported face SQL must run unchanged.
4. All tenancy scoping changes (`ownerId` → `eventId`) are called out in [06-face-pipeline.md](06-face-pipeline.md) and covered by the cross-event isolation test ([12-roadmap.md](12-roadmap.md) risk R2).
5. Keep `apps/ml` at zero diffs. If a change seems needed there, the answer is almost always in the caller.
