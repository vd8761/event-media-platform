# `ml` — machine-learning sidecar (production deploy)

> `README.md` in this directory is the **verbatim upstream Immich ML README** and is kept byte-for-byte identical to `immich:machine-learning`. This file (`DEPLOY.md`) is the EventLens-specific deployment guide; the upstream README is left untouched on purpose.

A verbatim copy of `immich:machine-learning` (RetinaFace detection + ArcFace recognition, FastAPI). Runs on the **GPU host** only, next to `backend-worker`, reached over the compose-internal network at `http://ml:3003`. It has no database or Redis access and holds no state beyond the model cache. The backend's media workers call it; participants and organisers never reach it.

---

## Local development

You don't build anything for local work. `docker-compose.dev.yml` pulls the upstream prebuilt **CPU** image and exposes the identical API:

```sh
docker compose -f docker/docker-compose.dev.yml up -d ml
curl -fsS http://localhost:3003/ping     # -> "pong"
```

Then point the backend at it with `MACHINE_LEARNING_URL=http://localhost:3003` and `EL_ML_DEVICE=cpu` (already set in `apps/backend/.env.example`).

| | Local | Production |
|---|---|---|
| Image | `ghcr.io/immich-app/immich-machine-learning:release` (pulled) | `eventlens-ml:cuda` (built from this directory) |
| Device | CPU | CUDA |
| Address | `http://localhost:3003` (published) | `http://ml:3003` (compose network only, never published) |
| First boot | Downloads `buffalo_l` (~300 MB) into the `model-cache` volume | Same, then preloads onto the GPU |

Face detection on CPU is materially slower but functionally identical, so the full pipeline can be developed and tested offline.

---

## Build

Build context is `apps/ml`. The `DEVICE` build-arg selects the runtime:

```sh
# GPU VM (production):
docker build --build-arg DEVICE=cuda -t eventlens-ml:cuda apps/ml

# CPU fallback (no GPU host, slower — fine for small events):
docker build --build-arg DEVICE=cpu  -t eventlens-ml:cpu  apps/ml
```

`docker-compose.gpu.yml` expects the tag `eventlens-ml:cuda`.

## Host prerequisites (CUDA build)

- NVIDIA driver
- `nvidia-container-toolkit`

GPU passthrough is declared in `docker-compose.gpu.yml` via `deploy.resources.reservations.devices` (`driver: nvidia`, `capabilities: [gpu]`) — the same mechanism as Immich's `hwaccel.ml.yml` cuda variant.

> `backend-worker` in the same compose file reserves the device too, with `capabilities: [gpu, utility]`. That is **not** for inference — it only puts `nvidia-smi` in the worker container so its heartbeat can report GPU utilisation to the admin System panel. All inference still happens here in `ml`. Removing that block costs you the GPU figures on the dashboard and nothing else.

## Deploy

Started as part of the GPU-VM stack:

```sh
cd docker
docker compose -f docker-compose.gpu.yml up -d          # brings up `ml` + `backend-worker`
```

**First boot:** `ml` downloads the `buffalo_l` model (~300 MB) from HuggingFace into the `model-cache` volume and preloads it onto the GPU. `backend-worker` polls `GET /ping` and only starts consuming `faceDetection`/`selfie` once the sidecar is healthy (the ported client's health map does this continuously). Expect the first startup to take a couple of minutes; later boots are fast because the model is cached.

Verify:

```sh
docker compose -f docker-compose.gpu.yml logs -f ml
docker compose -f docker-compose.gpu.yml exec ml python3 healthcheck.py   # image also ships a HEALTHCHECK
```

## Environment reference

Set on the `ml` service (see `docker-compose.gpu.yml`). These are upstream Immich ML variables, not EventLens ones.

| Var | Value | Notes |
|---|---|---|
| `MACHINE_LEARNING_MODEL_TTL` | `0` | Keep models resident (never unload) — this is a dedicated event box. |
| `MACHINE_LEARNING_PRELOAD__FACIAL_RECOGNITION__DETECTION` | `buffalo_l` | Preload the detection model at boot. |
| `MACHINE_LEARNING_PRELOAD__FACIAL_RECOGNITION__RECOGNITION` | `buffalo_l` | Preload the recognition model at boot. |
| `MACHINE_LEARNING_CACHE_FOLDER` | `/cache` | Model cache location (already set in the image; back it with the `model-cache` volume). |

`DEVICE` is baked in at build time (`cuda`/`cpu`), not set at runtime.

The service listens on **port 3003**. Do **not** publish it — it must be reachable only on the GPU VM's compose network. `backend-worker` addresses it as `MACHINE_LEARNING_URL=http://ml:3003`.

## Volumes

| Volume | Mount | Purpose |
|---|---|---|
| `model-cache` | `/cache` | Persists the ~300 MB `buffalo_l` download so restarts don't re-fetch it. |

## Notes

- The model must match what the pipeline was tuned against — `buffalo_l` (512-dim ArcFace embeddings, matching `face_search.embedding vector(512)`). Don't swap it without re-tuning match distances.
- Scaling ML for very large events: point multiple workers' `MACHINE_LEARNING_URL` at a comma-separated list of sidecar URLs; the backend client fails over across them.
- Keep `apps/ml` a zero-diff copy of upstream. To update, re-copy from a newer Immich checkout rather than editing in place.
