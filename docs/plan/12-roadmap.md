# 12 — Build Roadmap & Risk Register

## 1. Milestones

Dependencies flow downward; M5 is parallelizable with M3/M4 once M2 lands.

### M1 — Foundation
Monorepo scaffold (pnpm workspaces); backend skeleton with ported `config.repository`, `job.repository` (+ role gating), `crypto.repository`, decorators; boot roles from `EL_WORKERS_INCLUDE`; schema migration 0001 (all tables incl. vector index); auth (sessions, bcrypt login, super-admin flag, org roles); super-admin org CRUD + org/event CRUD APIs; web shell: login, Immich theme, `/admin/organizations`, `/events` list; docker-compose.main.yml boots end-to-end.
**Acceptance:** super admin creates an org; org owner logs in and creates an event. No media yet.

### M2 — Media pipeline (upload → R2 → processed)
R2 `StorageRepository`; upload interceptor (inline SHA-1) + dedupe + `bulk-upload-check`; `mediaProcess` (`AssetProcess`: exif → preview → thumb → thumbhash) + `videoTranscode` on the GPU-role worker (can run on the main VM during dev — role env makes placement a deploy choice); event gallery grid with presigned URLs + upload manager port; staging sweeps; docker-compose.gpu.yml.
**Acceptance:** 500-photo upload lands in R2 with thumbnails visible in the event gallery; duplicate re-upload returns `duplicate`.

### M3 — Face pipeline
`apps/ml` verbatim copy builds with `DEVICE=cuda` and runs as sidecar; ported `machine-learning.repository`; `faceDetection` (detect + IoU reconcile + `refreshFaces`) ; `facialRecognition` clustering (event-scoped `searchFaces`, concurrency 1) ; `personThumbnail`; People review UI (`/events/[id]/people`).
**Acceptance:** processed event shows sensible person clusters; **cross-event isolation test passes** (risk R2 — same person in two events → disjoint clusters, zero cross-event query results).

### M4 — Participant flow
Public `/e/[slug]` page + selfie intake endpoint (rate limits, upsert, token); `SelfieProcess` (embed + inline match); face-level `matchParticipant` + `ParticipantRematch` debounce + `ParticipantMatchSweep` cron; `/g/[token]` gallery (token auth branch in guard, presigned URLs, 403-refresh); email pipeline (react-email templates: gallery-ready / gallery-update / no-face) + `email_log` + resend; participant dashboard for orgs; selfie retention sweep.
**Acceptance:** end-to-end demo — upload event photos, submit selfie, receive email, open personal gallery, see exactly own photos; later uploads appear + digest respects 6 h throttle.

### M5 — Cloud imports (parallel with M3/M4 after M2)
OAuth flows + AES-GCM token storage; folder browser endpoints + wizard UI; `ImportFolder`/`ImportFile` fan-out with counters; incremental re-sync; `Retry-After` handling; progress UI with per-item failures; cancel.
**Acceptance:** import a 1 000-file Drive folder and a OneDrive folder into an event; re-running the import skips everything; files also present via manual upload dedupe to the same asset.

### M6 — Hardening & polish
Super-admin queue dashboard + stats; gallery "download all" (zip streaming); storage reconciliation + hard-delete sweeps; rate-limit tuning; multi-GPU scale-out validation (`EL_QUEUES_EXCLUDE` on VM #2); monitoring/alerts ([11-deployment.md](11-deployment.md) §6); load test: 10 k-photo event, 500 participants.

## 2. Risk register

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | **`facialRecognition` concurrency must be 1 globally.** Multiple workers each get concurrency-1 → global N → duplicate persons per identity. | Corrupted clustering | Single consumer by deployment: the queue runs under `ingest` on the API host, so extra **API** instances set `EL_QUEUES_EXCLUDE=facialRecognition` (GPU VMs never run it); documented in the scaling playbook; asserted in `test/queue-placement.spec.ts` and the R1 load test. |
| R2 | **Missed `ownerId`→`eventId` scoping** in any ported face query silently matches faces across events. | Privacy breach | Scope inside SQL CTEs; `eventId`-first repository signatures; **mandated cross-event integration test** (M3 acceptance). |
| R3 | **Cluster-based matching would drop low-frequency guests** (`minFaces: 3`). | Missing participant photos | Face-level matching is the design (D6). Do not "simplify" back to cluster matching. |
| R4 | **sharp/ffmpeg need local files**; crashed jobs leak temp files; disk = concurrency × largest video. | Worker disk-full | Stage R2→`/cache`, delete in `finally`; hourly orphan sweep; disk alert. |
| R5 | **Through-API upload makes the main VM a bandwidth/disk chokepoint** at very large scale. | Slow uploads | Acceptable now; streamed multipart to R2 + staging sweep; revisit presigned PUT only if saturation is measured. |
| R6 | **BullMQ Python client lacks Node parity** — tempting to make the ML service consume queues directly. | Fragile rewrite of the pipeline | ML stays an HTTP sidecar (D4). |
| R7 | **VectorChord lock-in**: ported `searchFaces` sets `vchordrq.probes`; plain-pgvector Postgres throws. | Startup/query failure on wrong image | Pin `ghcr.io/immich-app/postgres`; documented HNSW fallback diff ([03-database-schema.md](03-database-schema.md) §4). |
| R8 | **Model cold start**: first boot downloads ~300 MB; without preload the first job pays load latency or times out. | First-event flakiness | `MACHINE_LEARNING_PRELOAD__*` + `MODEL_TTL=0`; persistent `model-cache` volume; worker gates on `/ping`. |
| R9 | **Redis/Postgres over WAN**: BullMQ is chatty; exposed Redis is RCE-adjacent. | Latency / compromise | Tailnet-only binding + firewall; <50 ms placement guidance; `requirepass` regardless. |
| R10 | **Presigned URL expiry** in long-open gallery tabs. | Broken images | 403-triggered listing refetch in the grid ([10-web-app.md](10-web-app.md) §5); emails never embed media URLs. |
| R11 | **`EL_TOKEN_ENCRYPTION_KEY` loss** = every org must reconnect Drive/OneDrive (no rotation designed in v1). | Org friction | Back up like a DB credential; note rotation as future work. |
| R12 | **Drive/Graph throttling** on 10 k+ file folders. | Slow/failed imports | Honor `Retry-After`; `ImportFile` concurrency 4 (configurable); per-item failure surfacing + retry, never job-fatal. |

## 3. Definition of done (project-level)

1. All M1–M4 acceptance criteria pass on a real two-VM deployment (main + GPU) with Tailscale, R2, and SMTP live.
2. Cross-event isolation test (R2) green in CI.
3. 10 k-photo / 500-participant load test completes with zero duplicate persons (R1) and every participant emailed exactly once + digests.
4. `C:\Projects\immich` untouched (reference only).
