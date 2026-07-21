# 05 — Job & Queue Orchestration (backend ⇄ backend-worker)

BullMQ on Redis (Valkey), Bull prefix **`el_bull`**, default job options per Immich (`attempts` overridden per queue below, `removeOnComplete: true`, `removeOnFail: false` — `immich:server/src/repositories/config.repository.ts`). The ported `JobRepository` keeps Immich's `@OnJob` decorator registry and startup handler-completeness check (`immich:server/src/repositories/job.repository.ts`), plus the new `QUEUE_ROLES` gate ([01-architecture.md](01-architecture.md) §1).

**Rules:** payloads carry **IDs only, never bytes or file paths across machines**. Handlers are idempotent (safe to retry). The API role only enqueues; consumers run where `QUEUE_ROLES[queue]` matches the process role.

## 1. Queue catalog

| Queue | Role (VM) | Jobs (payload) | Concurrency | Notes |
|---|---|---|---|---|
| `mediaProcess` | `media` (GPU) | `AssetProcess {assetId}` | 3 | exif + preview + thumb + thumbhash (Immich `thumbnailGeneration` spec) |
| `videoTranscode` | `media` (GPU) | `VideoTranscode {assetId}` | 1 | Immich default (`immich:server/src/config.ts` job defaults) |
| `faceDetection` | `media` (GPU) | `FaceDetect {assetId}` | 2 | Immich default for `faceDetection` |
| `facialRecognition` | `ingest` (API host) | `FaceRecognize {faceId, deferred?}`, `FaceRecognizeQueueAll {eventId, force?}` | **1 — hard requirement, globally** | clustering races create duplicate persons. Despite the name it makes no ML call — it is a pgvector KNN loop, so it belongs next to the database, not on the GPU box. Keep the API service at one instance |
| `personThumbnail` | `media` (GPU) | `PersonThumbnail {personId}` | 2 | 250 px face crop |
| `selfie` | `media` (GPU) | `SelfieProcess {participantId}` | 2 | needs the ML sidecar |
| `import` | `ingest` (main) | `ImportFolder {importJobId}`, `ImportFile {importItemId}` | 1 folder / 4 file | network-bound (Drive/Graph) |
| `match` | `ingest` (main) | `ParticipantRematch {eventId}` (debounced), `ParticipantMatchSweep {}` (cron 15 min) | 1 | Postgres-only KNN work; single-consumer for ordering |
| `notification` | `ingest` (main) | `SendGalleryEmail {participantId}`, `SendDigest {participantId}`, `SendNoFaceEmail {participantId}` | 2 | SMTP; 3 attempts, exponential backoff |
| `storageCleanup` | `ingest` (main) | `CleanupKeys {keys[]}`, `CleanupPrefix {prefix}`, `SelfieRetentionSweep {}` | 2 | R2 deletes |
| `background` | `ingest` (main) | `StagingSweep {}`, token/session cleanup, R2 reconciliation | 2 | housekeeping crons |

Placement rationale — GPU side: everything that needs original/preview **bytes** or the **ML sidecar**. Main side: everything network-bound (Drive/Graph, SMTP, R2 delete APIs) or Postgres-only (rematch KNN).

Dedup/debounce (BullMQ `jobId` + delay, the pattern Immich uses for `FacialRecognitionQueueAll` in `immich:server/src/repositories/job.repository.ts#getJobOptions`):
- `ParticipantRematch` → `jobId: rematch:{eventId}`, delay 60 s — a burst of 500 uploads triggers **one** rematch.
- `SendDigest` → `jobId: digest:{participantId}`, delay aligned to the ≥6 h throttle.

## 2. Pipeline: upload → processed → faces → matches

```
API (api role)                          GPU worker (media role)                    Main (ingest role)
──────────────                          ───────────────────────                    ──────────────────
POST /events/:id/assets
  SHA-1 inline → dedupe
  → R2 original → asset row
  → enqueue AssetProcess ──────────────▶ AssetProcess {assetId}
                                          stage original → /cache
                                          exif → asset_exif (captured_at)
                                          sharp decode once →
                                            preview 1440 jpeg + thumb 250 webp
                                            + thumbhash → R2 + asset_file rows
                                          asset.status = 'processed'
                                          ├─ if video → enqueue VideoTranscode
                                          └─ enqueue FaceDetect {assetId}
                                        FaceDetect {assetId}
                                          preview file (re-stage if evicted)
                                          POST ml /predict (detectFaces)
                                          IoU>0.5 reconcile vs existing faces
                                          refreshFaces → asset_face + face_search
                                          ├─ per new face → enqueue FaceRecognize
                                          └─ enqueue ParticipantRematch ─────────▶ (debounced, see §4)
                                        FaceRecognize {faceId}   [concurrency 1]
                                          event-scoped KNN (maxDistance .5,
                                            numResults = minFaces)
                                          assign existing person │ defer once │
                                            create person (≥ minFaces)
                                          on create:
                                          ├─ enqueue PersonThumbnail {personId}
                                          └─ enqueue ParticipantRematch ─────────▶ (debounced)
```

Algorithm details and every Immich source line: [06-face-pipeline.md](06-face-pipeline.md).

## 3. Pipeline: Drive/OneDrive import

```
API: POST /events/:id/imports {accountId, folderId, recursive}
  → import_job (status 'listing') → enqueue ImportFolder
Main: ImportFolder {importJobId}
  page remote listing (recurse subfolders), filter image/* video/*
  upsert import_item on unique(event_id, provider, remote_id)
    already done + same remote_checksum → 'skipped_duplicate'   (incremental re-sync)
  job.status='importing', total_files set
  → enqueue ImportFile per pending item
Main: ImportFile {importItemId}      [concurrency 4]
  fresh access token → stream download → /staging (SHA-1 inline)
  dedupe (event_id, checksum) → hit: item 'skipped_duplicate' (links existing asset_id)
  miss: R2 original → asset row (source 'gdrive'|'onedrive') → enqueue AssetProcess
  update job counters; last finished item flips job → 'done'
```

Provider details, OAuth, throttling: [08-cloud-imports.md](08-cloud-imports.md).

## 4. Pipeline: selfie → match → email

```
API: POST /public/events/:slug/participants {email, selfie}
  selfie → R2, participant upsert (status 'processing') → enqueue SelfieProcess
GPU: SelfieProcess {participantId}
  stage selfie → ml /predict → faces
  ├─ none → status 'no_face' → enqueue SendNoFaceEmail
  └─ pick largest bbox → store selfie_embedding (512-d) on participant row
     run matchParticipant() inline → status 'matched' | 'pending_match'
     new matches? → enqueue SendGalleryEmail
Main: ParticipantRematch {eventId}     [debounced 60 s, jobId rematch:{eventId}]
  for each participant of event with selfie_embedding:
    event-scoped KNN selfie_embedding ⟷ face_search
      (threshold: event.config.matchMaxDistance ?? system default 0.5)
    insert participant_match (on conflict do nothing)
  participants gaining rows:
    never notified  → enqueue SendGalleryEmail {participantId}
    already notified → enqueue SendDigest {participantId} (≥6 h throttle)
Main: ParticipantMatchSweep            [cron every 15 min]
  rematch 'pending_match' participants of active events
  (covers selfie-submitted-before-any-photos ordering)
Main: SendGalleryEmail / SendDigest / SendNoFaceEmail
  render react-email template → SMTP → email_log row
  set notified_first_at / last_notified_at
```

`SelfieProcess` and `ParticipantRematch` share one service function (`matchParticipant(participantId)`) so behavior can't drift; matching model rationale (face-level, not cluster-level) in [07-participant-flow.md](07-participant-flow.md) §3.

## 5. Failure & retry policy

| Queue | Attempts | Backoff | Poison handling |
|---|---|---|---|
| `mediaProcess`, `videoTranscode`, `faceDetection`, `selfie`, `personThumbnail` | 3 | exponential 30 s | asset.status='failed' (or participant 'processing' stuck → sweep retries); surfaced in org UI |
| `facialRecognition` | 3 | exponential 10 s | face stays unassigned; next `FaceRecognizeQueueAll` re-covers it |
| `import` | 5 | exponential, honors provider `Retry-After` on 429 | per-item `failed` with error string; job completes with `failed_files` count |
| `match` | 3 | exponential 30 s | idempotent; sweep cron re-covers |
| `notification` | 3 | exponential 60 s | `email_log.status='failed'` + error; org UI "resend" |
| `storageCleanup`, `background` | 3 | exponential 60 s | nightly reconciliation sweep is the safety net |

Failed jobs are kept (`removeOnFail: false`) and visible in the super-admin queue dashboard (BullMQ `getJobCounts`, Immich queue-status pattern from `immich:server/src/services/queue.service.ts`).

## 6. Cron schedule (registered by ingest role under an advisory lock, Immich nightly-jobs pattern)

| Cron | Job | Interval |
|---|---|---|
| match sweep | `ParticipantMatchSweep` | every 15 min |
| staging sweep | `StagingSweep` (staging files >24 h) | hourly |
| selfie retention | `SelfieRetentionSweep` | daily |
| storage reconciliation + hard-delete | background | daily (7-day grace) |
| session cleanup | background | daily |
