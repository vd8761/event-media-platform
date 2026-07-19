# EventLens

Event media management platform: organizations create events and ingest photos/videos (upload, Google Drive, OneDrive); a GPU worker runs Immich's facial classification pipeline; participants submit a selfie on a public event link and receive a tokenized personal gallery of every photo they appear in.

Derived from [Immich](https://immich.app) (reference checkout `C:\Projects\immich`, read-only — code is copied out, never modified).

## Layout

- `apps/backend` — NestJS; one codebase deployed as `backend` (main VM, `EL_WORKERS_INCLUDE=api,ingest`) and `backend-worker` (GPU VM, `EL_WORKERS_INCLUDE=media`)
- `apps/ml` — verbatim copy of `immich:machine-learning` (RetinaFace + ArcFace, FastAPI)
- `apps/web` — SvelteKit static SPA, Immich theme
- `packages/sdk` — typed client generated from the backend OpenAPI spec
- `docker/` — compose files for both VMs
- `docs/plan/` — full implementation plan (start at [docs/plan/README.md](docs/plan/README.md))

## Development

```sh
pnpm install
docker compose -f docker/docker-compose.dev.yml up -d   # Postgres (VectorChord) + Redis + MinIO + mailpit + ML
pnpm --filter backend start:dev
pnpm --filter web dev                                   # http://localhost:5173
```

Dev logins: `admin@eventlens.test` / `superadmin1` (super admin), `owner@acme.test` / `ownerpass1` (org owner).

## Production deployment

Two VMs, one backend image, an ML sidecar, and a static web build. Private connectivity between the VMs is via Tailscale/WireGuard — **Postgres and Redis are never exposed publicly**.

```
                 Internet (HTTPS)
                       │
              ┌────────▼─────────┐            tailnet (private)         ┌─────────────────────┐
              │     Main VM       │◄──────────────────────────────────►│      GPU VM          │
              │  docker-compose.  │   Postgres 5432 · Redis 6379        │  docker-compose.     │
              │      main.yml     │                                     │      gpu.yml         │
              │                   │                                     │                      │
              │  caddy (80/443)   │                                     │  backend-worker      │
              │  backend api,ingest│                                    │   (media role)       │
              │  postgres · redis │                                     │  ml sidecar :3003    │
              └───────────────────┘                                     └─────────────────────┘
```

Per-service deploy guides — build steps, exact env vars, and defaults for each:

| Service | Guide | Runs on |
|---|---|---|
| **backend** (`api,ingest` and `media` roles) | [apps/backend/README.md](apps/backend/README.md) | Main VM + GPU VM |
| **ml** (facial recognition sidecar) | [apps/ml/DEPLOY.md](apps/ml/DEPLOY.md) | GPU VM |
| **web** (static SPA served by Caddy) | [apps/web/README.md](apps/web/README.md) | Main VM (via Caddy) |

Order of operations:

1. **Main VM** — copy `docker/example.env` → `docker/.env` (`chmod 600`), fill it in, set your domain in `docker/Caddyfile`, build & bring up: see [apps/backend/README.md](apps/backend/README.md#deploy--main-vm-backend) and [apps/web/README.md](apps/web/README.md). Migrations run automatically at first boot.
2. **GPU VM** — build the CUDA ML image, set `DB_HOSTNAME`/`REDIS_HOSTNAME` to the main VM's tailnet IP and `DB_SKIP_MIGRATIONS=true`, then bring up: see [apps/ml/DEPLOY.md](apps/ml/DEPLOY.md) and [apps/backend/README.md](apps/backend/README.md#deploy--gpu-vm-backend-worker).

Full reference and the network/security checklist: [docs/plan/11-deployment.md](docs/plan/11-deployment.md). A ready-to-fill env template is at [docker/example.env](docker/example.env).

**Secrets that must be backed up:** `EL_TOKEN_ENCRYPTION_KEY` (losing it forces every org to reconnect Drive/OneDrive), the Postgres password, and the R2 tokens.
