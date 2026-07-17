# 01 — System Architecture

Companion docs: [02-monorepo-and-code-reuse.md](02-monorepo-and-code-reuse.md) (what code comes from where), [05-job-orchestration.md](05-job-orchestration.md) (queue catalog), [11-deployment.md](11-deployment.md) (compose files, env).

## 1. One codebase, two deployables

The user requirement is **two backends**:

1. **`backend`** — "performs the upload, download, queuing, etc." (main VM)
2. **`backend-worker`** — "solely for GPU … processes images and stores them back to the storage" (GPU VM)

This is satisfied at the **deployment level with a single NestJS codebase**, which is exactly how Immich splits its API from its background workers:

- Immich reads `IMMICH_WORKERS_INCLUDE` / `IMMICH_WORKERS_EXCLUDE` in `immich:server/src/repositories/config.repository.ts` (~line 185) and boots only the selected workers from `immich:server/src/main.ts` (`server/src/workers/api.ts`, `server/src/workers/microservices.ts`).
- Only the microservices worker ever starts BullMQ consumers: `JobRepository.startWorkers()` in `immich:server/src/repositories/job.repository.ts` is called solely when the process role is `microservices`. The API process only **enqueues**.
- Job handlers are registered via the `@OnJob({ name, queue })` decorator (`immich:server/src/decorators.ts`); at startup the registry validates every `JobName` has exactly one handler. Splitting into two codebases would break this registry and force duplicating repositories/schema — hence one codebase.

### EventLens roles

`EL_WORKERS_INCLUDE` selects one or more roles per process:

| Role | Runs where | What starts |
|---|---|---|
| `api` | Main VM | Nest HTTP server (controllers, AuthGuard, upload interceptor). Enqueues jobs; never consumes. |
| `ingest` | Main VM (same process as `api`) | BullMQ consumers for network/CPU-light queues: `import`, `match`, `notification`, `storageCleanup`, `background`. |
| `media` | GPU VM | BullMQ consumers for heavy queues: `mediaProcess`, `videoTranscode`, `faceDetection`, `facialRecognition`, `personThumbnail`, `selfie`. No HTTP server. |

**Required change to the ported `JobRepository.startWorkers()`**: Immich starts a Worker for *every* `QueueName`; EventLens adds a static map

```ts
const QUEUE_ROLES: Record<QueueName, 'ingest' | 'media'> = { ... } // see 05-job-orchestration.md
```

and starts only the queues whose role is included in `EL_WORKERS_INCLUDE`. A second env `EL_QUEUES_EXCLUDE` lets additional GPU workers opt out of single-consumer queues (see §4).

Deployments:

- **Main VM**: `EL_WORKERS_INCLUDE=api,ingest`
- **GPU VM**: `EL_WORKERS_INCLUDE=media`

The two deployables share **Postgres** (state) and **Redis** (BullMQ job hand-off). There is **no direct RPC** between backend and backend-worker — the queue is the contract. Job payloads carry IDs only; the worker loads rows from Postgres and bytes from R2.

## 2. The GPU VM: worker + ML sidecar

The GPU VM runs two containers ([11-deployment.md](11-deployment.md) `docker-compose.gpu.yml`):

1. **`backend-worker`** — the NestJS image with `EL_WORKERS_INCLUDE=media`. Does sharp thumbnailing, ffmpeg transcodes, orchestrates face detection/clustering, reads/writes R2. Needs a local scratch volume `/cache` (sharp and ffmpeg require real files, not streams — every handler stages R2 → `/cache`, processes, uploads results, deletes temp).
2. **`ml`** — the **verbatim copy of `immich:machine-learning/`** built with Docker build-arg `DEVICE=cuda` (onnxruntime-gpu, `CUDAExecutionProvider` — `immich:machine-learning/immich_ml/sessions/ort.py`). Exposes:
   - `POST /predict` — multipart (`entries` JSON + `image` bytes) → face boxes + 512-d embeddings (`immich:machine-learning/immich_ml/main.py`)
   - `GET /ping` — health
   Listens on 3003, reachable **only** from the worker over the compose network (`MACHINE_LEARNING_URL=http://ml:3003`). Never exposed publicly.

The worker calls it through a near-verbatim port of `immich:server/src/repositories/machine-learning.repository.ts` (keep `detectFaces`, the multi-URL failover and the healthy-server map; delete CLIP/OCR methods). Keeping the ML service an HTTP sidecar (instead of merging into a Python queue worker) is Decision **D4** — zero-diff ML copy, and BullMQ's Python client lacks Node parity.

**Model warm-up:** first boot downloads `buffalo_l` (~300 MB) from HuggingFace `immich-app/*` into the persistent `model-cache` volume. Set `MACHINE_LEARNING_PRELOAD__FACIAL_RECOGNITION__DETECTION=buffalo_l`, `MACHINE_LEARNING_PRELOAD__FACIAL_RECOGNITION__RECOGNITION=buffalo_l`, and `MACHINE_LEARNING_MODEL_TTL=0` (supported by `immich:machine-learning/immich_ml/config.py`) so models load at boot and never unload.

## 3. Connectivity & security

The GPU worker needs exactly three upstreams:

| Upstream | Protocol | Path |
|---|---|---|
| Redis (BullMQ) | TCP 6379 | **Private tunnel only** |
| Postgres | TCP 5432 | **Private tunnel only** |
| Cloudflare R2 | HTTPS 443 | Public internet (scoped API token) |

**Recommended: WireGuard via Tailscale** between the main VM and GPU VM(s):

- Postgres and Redis bind to the tailnet interface + localhost only; host firewall drops 5432/6379 on public interfaces. **Never expose Redis publicly** — an open Redis is remote-code-execution-adjacent.
- Keep Redis `requirepass` and Postgres password auth enabled anyway (defense in depth). The tailnet provides transport encryption, so no separate TLS certificates are needed.
- GPU VM env simply points at tailnet IPs: `DB_HOSTNAME=100.x.y.z`, `REDIS_HOSTNAME=100.x.y.z`.
- If both VMs live in one cloud, VPC private networking + security groups is an equivalent substitute; app config is identical.

**Latency budget:** BullMQ is chatty — keep GPU VM ↔ Redis round-trip under ~50 ms. Same-region or same-continent placement is fine; R2's **zero egress fees** mean the GPU VM can be rented anywhere cheap (RunPod, Lambda Labs, Hetzner GPU) without bandwidth cost.

R2 access uses a bucket-scoped API token (object read/write on the single bucket only), distinct tokens per VM so either can be revoked independently.

## 4. Scaling model

- **More GPU capacity** = boot another GPU VM with the same `docker-compose.gpu.yml` pointed at the same Redis/Postgres. BullMQ distributes jobs across consumers automatically.
- **Hard constraint:** the `facialRecognition` queue must have **exactly one consumer globally** (concurrency 1). Immich enforces per-process concurrency 1 for this queue (it is in the non-concurrent set in `immich:server/src/services/queue.service.ts`); concurrent clustering races create duplicate persons for one identity. With N workers, BullMQ would give N× concurrency — so every **additional** GPU VM sets `EL_QUEUES_EXCLUDE=facialRecognition`. Same treatment for the `match` queue on the ingest side (idempotent, but single-consumer keeps ordering clean).
- The ML sidecar scales 1:1 with its worker (localhost URL). A shared ML pool is possible later — the ported `machine-learning.repository.ts` already supports multiple URLs with failover.
- The API tier can scale to multiple `api,ingest` instances behind the reverse proxy; sessions are DB-backed so no sticky sessions are needed. Exclude `match` on extras as above.

## 5. Process/data flow summary

```
Org upload:      browser ─POST multipart→ backend(api) ─SHA-1+dedupe→ R2 original
                 └─ enqueue mediaProcess ─Redis→ backend-worker ─→ thumbs/preview → R2
                    └─ faceDetection → ml sidecar → asset_face + face_search(embedding)
                       └─ facialRecognition (KNN cluster) → person
                          └─ match:ParticipantRematch ─Redis→ backend(ingest) → participant_match
                             └─ notification → SMTP (gallery link email)

Drive/OneDrive:  backend(ingest) ImportFolder/ImportFile → staging → R2 → same pipeline

Participant:     browser ─POST selfie→ backend(api) → R2 → selfie queue → backend-worker
                 └─ ml embed → match inline → email
```

Full payload shapes and per-queue concurrency: [05-job-orchestration.md](05-job-orchestration.md).
