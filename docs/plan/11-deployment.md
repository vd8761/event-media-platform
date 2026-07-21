# 11 — Deployment & Orchestration

Two VMs, two compose files, one backend image. Private connectivity per [01-architecture.md](01-architecture.md) §3 (Tailscale/WireGuard; Redis & Postgres never public).

## 1. Main VM — `docker/docker-compose.main.yml`

```yaml
services:
  backend:                            # "backend" deployable
    image: eventlens-backend          # apps/backend/Dockerfile (ghcr.io/immich-app/base-images base)
    environment:
      EL_WORKERS_INCLUDE: api,ingest
      # DB_*, REDIS_*, R2_*, SMTP_*, GOOGLE_*, MS_*, EL_* — see §3
    volumes:
      - staging:/staging              # upload/import staging (~50 GB)
    depends_on: [database, redis]
    restart: always

  web:                                # built SPA; can also be served by backend or proxy
    image: eventlens-web              # nginx serving apps/web build output

  database:
    # pgvector + VectorChord preinstalled; tag pinned to what Immich ships today
    # (immich:docker/docker-compose.yml) — bump alongside VectorChord version checks
    image: ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0
    environment: { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB: eventlens }
    volumes: [ dbdata:/var/lib/postgresql/data ]
    shm_size: 128mb
    # bind/firewall: localhost + tailnet interface only
    restart: always

  redis:
    image: valkey/valkey:8
    command: valkey-server --requirepass ${REDIS_PASSWORD}
    # bind/firewall: localhost + tailnet interface only
    restart: always

  proxy:                              # caddy or traefik: TLS, serves web, routes /api → backend
    image: caddy:2
    ports: ["80:80", "443:443"]
```

Notes:
- The backend container runs **both** the HTTP API and the ingest queue consumers (one process, roles `api,ingest`) — Immich's single-container multi-worker pattern (`immich:server/src/main.ts`).
- Migrations run automatically at backend boot under an advisory lock ([03-database-schema.md](03-database-schema.md) §5); `DB_SKIP_MIGRATIONS=true` opt-out.
- Backups: nightly `pg_dump` + R2 bucket versioning is sufficient at this scale (media is already in R2).

## 2. GPU VM — `docker/docker-compose.gpu.yml`

```yaml
services:
  backend-worker:                     # "backend-worker" deployable — same image as backend
    image: eventlens-backend
    environment:
      EL_WORKERS_INCLUDE: media
      MACHINE_LEARNING_URL: http://ml:3003
      DB_SKIP_MIGRATIONS: "true"      # the main VM owns migrations
      # DATABASE_URL / REDIS_URL → tailnet IP of the main VM (from .env)
      # R2_* (GPU-VM-scoped token)
    volumes:
      - cache:/cache                  # R2 staging scratch: ≥ concurrency × largest video
    depends_on: [ml]
    restart: always

  ml:                                 # verbatim immich_ml, CUDA build
    image: eventlens-ml:cuda          # apps/ml/Dockerfile, build-arg DEVICE=cuda
    environment:
      MACHINE_LEARNING_MODEL_TTL: "0"
      MACHINE_LEARNING_PRELOAD__FACIAL_RECOGNITION__DETECTION: buffalo_l
      MACHINE_LEARNING_PRELOAD__FACIAL_RECOGNITION__RECOGNITION: buffalo_l
    volumes:
      - model-cache:/cache            # persists ~300 MB HuggingFace download
    deploy:
      resources:
        reservations:
          devices: [{ driver: nvidia, count: 1, capabilities: [gpu] }]
    restart: always
```

Prereqs: NVIDIA driver + `nvidia-container-toolkit` on the host (the compose `deploy.resources.reservations.devices` GPU passthrough is the same mechanism as Immich's `docker/hwaccel.ml.yml` cuda variant).

**First boot order**: `ml` starts → downloads `buffalo_l` from HuggingFace into `model-cache` → preloads onto GPU; `backend-worker` health-checks `GET /ping` before consuming `faceDetection`/`selfie` (the ported client's healthy-map does this continuously).

## 3. Environment variable reference

| Group | Vars |
|---|---|
| Roles | `EL_WORKERS_INCLUDE` (`api,ingest` \| `media`), `EL_QUEUES_EXCLUDE` (extra **API** instances: `facialRecognition`, `match`), `EL_QUEUES_INCLUDE` (run a queue outside its role) |
| Database | `DATABASE_URL` (one connection string for local, self-hosted and Neon alike; `sslmode` honoured, TLS required for any non-local host), `DB_SKIP_MIGRATIONS`, `DB_VECTOR_EXTENSION` (`pgvector` on Neon — VectorChord is not installable there) |
| Redis | `REDIS_URL` (`redis://` or `rediss://`; TLS is mandatory on Upstash), or the discrete `REDIS_HOSTNAME`/`REDIS_PORT`/`REDIS_PASSWORD`/`REDIS_TLS` |
| R2 | `R2_ENDPOINT`, `R2_BUCKET=eventlens-media`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` |
| ML | `MACHINE_LEARNING_URL=http://ml:3003` (worker); sidecar: `MACHINE_LEARNING_MODEL_TTL=0`, `MACHINE_LEARNING_PRELOAD__FACIAL_RECOGNITION__DETECTION/RECOGNITION=buffalo_l`, `MACHINE_LEARNING_CACHE_FOLDER=/cache` |
| OAuth import | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` |
| Email | `EMAIL_PROVIDER` (`resend` \| `smtp`; autodetected from which credential is set), `EMAIL_FROM`, then either `RESEND_API_KEY` or `SMTP_HOST`/`SMTP_PORT`/`SMTP_USERNAME`/`SMTP_PASSWORD`/`SMTP_SECURE` (bootstrap; runtime-editable in `system_config`) |
| App | `EL_PUBLIC_BASE_URL` (email links + OAuth redirect base), `EL_TOKEN_ENCRYPTION_KEY` (32-byte hex — **back up like a DB credential**; loss forces every org to reconnect Drive/OneDrive), `EL_SESSION_TTL` |

## 4. Network & security checklist

- [ ] Tailscale (or VPC peering) up on both VMs; Postgres/Redis bound to tailnet+localhost only; public 5432/6379 dropped by firewall.
- [ ] Redis `requirepass`, Postgres password auth (defense in depth inside the tunnel).
- [ ] Two R2 API tokens (main VM, GPU VM), bucket-scoped, object read/write only — revocable independently.
- [ ] `ml` port 3003 reachable only on the GPU VM's compose network.
- [ ] Proxy: TLS via ACME; HSTS; body-size limit high enough for video uploads (or chunk-free streaming pass-through).
- [ ] Secrets via `.env` files with 0600 perms (compose `env_file`), never baked into images.

## 5. Scaling playbook

| Need | Action |
|---|---|
| Faster processing during an event | Boot GPU VM #2 with the same `docker-compose.gpu.yml` — no extra env. GPU VMs no longer run clustering, so there is nothing to exclude and BullMQ load-balances the rest automatically. |
| GPU VM only during events | Workers are stateless: jobs wait in Redis while no worker is up; boot the GPU VM when an event starts, destroy it after — nothing is lost. |
| API saturation | Second `backend` instance (`api,ingest`) behind the proxy; sessions are DB-backed. Extras **must** set `EL_QUEUES_EXCLUDE=facialRecognition,match` — clustering is single-consumer globally, and a second consumer creates duplicate persons. |
| Shared ML pool | Point multiple workers' `MACHINE_LEARNING_URL` at a comma-separated URL list — the ported client already does health-mapped failover. |

## 6. Observability (M6)

- BullMQ queue counts in the super-admin dashboard (`GET /api/admin/queues`).
- Structured logs (Nest logger, Immich pattern); per-job start/finish/duration.
- Optional later: OTel metrics + Prometheus/Grafana (Immich ships this pattern in `immich:docker/docker-compose.prod.yml`).
- Alerts that matter: queue depth sustained growth, failed-job count, ML `/ping` unhealthy, R2 4xx/5xx rate, disk usage on `/staging` & `/cache`.
