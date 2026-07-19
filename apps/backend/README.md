# `backend` — API + worker (production)

One NestJS image, two deployables selected by `EL_WORKERS_INCLUDE`:

| Deployable | Where | `EL_WORKERS_INCLUDE` | Runs |
|---|---|---|---|
| `backend` | Main VM | `api,ingest` | HTTP API **and** the ingest queues (import, match, notification, storage-cleanup, background) + cron |
| `backend-worker` | GPU VM | `media` | GPU queues only (media-process, video-transcode, face-detection, facial-recognition, person-thumbnail, selfie). No HTTP server. |

Both run `node dist/main.js`; the role env decides what starts. See [../../docs/plan/11-deployment.md](../../docs/plan/11-deployment.md).

## Build

From the **repo root** (the build context is the whole workspace — the image is based on Immich's base-server images, which ship the ffmpeg/libvips/sharp/libraw toolchain):

```sh
docker build -f apps/backend/Dockerfile -t eventlens-backend .
```

The same image is used on both VMs — build once, push to a registry both hosts can reach, or build on each.

## Deploy — Main VM (`backend`)

Runs the API + ingest workers alongside Postgres, Redis, and the Caddy proxy.

```sh
cd docker
cp example.env .env          # fill in — see the ENV reference below
chmod 600 .env

# bind Postgres/Redis to localhost + the tailnet interface ONLY (never public):
#   database.ports: ["127.0.0.1:5432:5432", "100.x.y.z:5432:5432"]
#   redis: same treatment
docker compose -f docker-compose.main.yml up -d
```

Migrations run automatically at boot under a Postgres advisory lock ([../../docs/plan/03-database-schema.md](../../docs/plan/03-database-schema.md) §5). First boot creates the schema; there is no separate migrate step.

Verify:

```sh
docker compose -f docker-compose.main.yml logs -f backend   # look for "EventLens API running on port 3001 [roles: api,ingest]"
curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/docs   # -> 200 (Swagger UI)
```

## Deploy — GPU VM (`backend-worker`)

Runs the media workers next to the ML sidecar. Reaches Postgres/Redis over the tailnet.

```sh
cd docker
cp example.env .env
chmod 600 .env
# In .env set DB_HOSTNAME / REDIS_HOSTNAME to the main VM's tailnet IP (100.x.y.z),
# and DB_SKIP_MIGRATIONS=true (the main VM owns migrations — see below).
docker compose -f docker-compose.gpu.yml up -d
```

**Boot order:** bring the main VM up first so the schema exists, then the GPU VM. Every container runs migrations at boot unless told not to; set `DB_SKIP_MIGRATIONS=true` on the GPU VM so the worker never races the API on schema changes. The advisory lock makes a race safe, but skipping is cleaner and lets the worker start while the API is mid-migration.

**Second and later GPU VMs:** add `EL_QUEUES_EXCLUDE=facialRecognition`. Clustering must have exactly one consumer globally (risk R1); every other queue load-balances across VMs automatically via BullMQ.

## Environment reference

`.env` is loaded via compose `env_file`. All values below are read by the backend; unset values fall back to the **Default** shown. Keep `.env` at `0600`.

### Roles

| Var | Default | Notes |
|---|---|---|
| `EL_WORKERS_INCLUDE` | — | `api,ingest` (main VM) or `media` (GPU VM). Set by the compose file, not `.env`. |
| `EL_WORKERS_EXCLUDE` | — | Rarely used; subtracts roles from the include set. |
| `EL_QUEUES_EXCLUDE` | — | `facialRecognition` on the 2nd..Nth GPU VM only. |

### Database (Postgres + VectorChord)

| Var | Default | Notes |
|---|---|---|
| `DB_HOSTNAME` | `database` | GPU VM: tailnet IP of the main VM. |
| `DB_PORT` | `5432` | |
| `DB_USERNAME` | `postgres` | |
| `DB_PASSWORD` | `postgres` | **Set a real password in production.** Must match the DB container's `POSTGRES_PASSWORD`. |
| `DB_DATABASE_NAME` | `eventlens` | |
| `DB_URL` | — | Full connection string; overrides the discrete `DB_*` above if set. |
| `DB_SKIP_MIGRATIONS` | `false` | Set `true` on the GPU VM. |
| `DB_VECTOR_EXTENSION` | `vectorchord` | Leave as-is; the pinned Postgres image ships VectorChord. |

### Redis / Valkey

| Var | Default | Notes |
|---|---|---|
| `REDIS_HOSTNAME` | `redis` | GPU VM: tailnet IP of the main VM. |
| `REDIS_PORT` | `6379` | |
| `REDIS_PASSWORD` | — | **Set one** (`requirepass`); an open Redis is RCE-adjacent. Must match the Redis container. |
| `REDIS_USERNAME` | — | Optional (Redis ACLs). |
| `REDIS_DBINDEX` | `0` | |

### Storage — Cloudflare R2 (S3-compatible)

| Var | Default | Notes |
|---|---|---|
| `R2_ENDPOINT` | — | `https://<account_id>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | `eventlens-media` | |
| `R2_ACCESS_KEY_ID` | — | Use **separate bucket-scoped tokens per VM** so they revoke independently. |
| `R2_SECRET_ACCESS_KEY` | — | |

### Machine learning (GPU VM only)

| Var | Default | Notes |
|---|---|---|
| `MACHINE_LEARNING_URL` | `http://ml:3003` | Comma-separated list is allowed; the client health-maps and fails over. |
| `EL_ML_DEVICE` | `cpu` | Reported (not detected) on the admin System panel. Set `cuda` on the GPU VM. |

### Cloud-import OAuth (optional, M5)

| Var | Default | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Redirect URI: `${EL_PUBLIC_BASE_URL}/api/cloud/gdrive/callback` |
| `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | — | Redirect URI: `${EL_PUBLIC_BASE_URL}/api/cloud/onedrive/callback` |

Cloud import is disabled until these are set; connect buttons return "provider is not configured".

### Email (SMTP)

| Var | Default | Notes |
|---|---|---|
| `SMTP_HOST` | — | Required for participant emails to send. |
| `SMTP_PORT` | `587` | |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | — | |
| `SMTP_FROM` | — | e.g. `EventLens <no-reply@yourdomain>` |

Bootstrap values; editable at runtime in `system_config`.

### App

| Var | Default | Notes |
|---|---|---|
| `EL_PUBLIC_BASE_URL` | `http://localhost:3001` | **Set to your public HTTPS origin** (e.g. `https://events.example.com`). Used for email links and OAuth redirects. |
| `EL_TOKEN_ENCRYPTION_KEY` | — | **32-byte hex, required in production.** Encrypts gallery tokens and Drive/OneDrive refresh tokens. **Back it up like a DB credential** — losing it forces every org to reconnect their cloud accounts (risk R11). Generate: `openssl rand -hex 32`. |
| `EL_SESSION_TTL_DAYS` | `90` | Session lifetime. |
| `EL_PORT` | `3001` | HTTP port (api role). |
| `EL_HOST` | — | Bind address; leave unset to listen on all interfaces inside the container. |
| `EL_ENV` | `production` | |
| `EL_LOG_LEVEL` | `log` | `verbose`\|`debug`\|`log`\|`warn`\|`error`\|`fatal` |
| `EL_STAGING_FOLDER` | `/staging` | Upload/import scratch (main VM). Provision ≥ ~50 GB. |
| `EL_CACHE_FOLDER` | `/cache` | R2 download scratch (GPU VM). ≥ concurrency × largest video. |

> In production `EL_TOKEN_ENCRYPTION_KEY` **must** be set. In `EL_ENV=development` only, a key is derived automatically if it's missing.

## Operations

- **Logs / health:** `docker compose logs -f backend`; queue depth and ML health at `GET /api/admin/queues` (super-admin dashboard).
- **Backups:** nightly `pg_dump` + R2 bucket versioning (media already lives in R2). Also back up `EL_TOKEN_ENCRYPTION_KEY`.
- **Scale during an event:** boot a second GPU VM with `docker-compose.gpu.yml` + `EL_QUEUES_EXCLUDE=facialRecognition`. Workers are stateless — jobs wait in Redis while none are up, so you can create the GPU VM when an event starts and destroy it after.
