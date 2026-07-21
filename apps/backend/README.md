# `backend` — API + workers

One NestJS image, two deployables selected by `EL_WORKERS_INCLUDE`:

| Deployable | Where | `EL_WORKERS_INCLUDE` | Runs |
|---|---|---|---|
| `backend` | API host / main VM | `api,ingest` | HTTP API **and** the ingest queues (import, match, notification, storage-cleanup, background) + cron |
| `backend-worker` | GPU host | `media` | GPU queues only (media-process, video-transcode, face-detection, facial-recognition, person-thumbnail, selfie). No HTTP server. |

Both run `node dist/main.js`; the role env decides what starts. Architecture: [../../docs/plan/11-deployment.md](../../docs/plan/11-deployment.md).

---

## Local development

```sh
pnpm install
cp apps/backend/.env.example apps/backend/.env
docker compose -f docker/docker-compose.dev.yml up -d
pnpm --filter backend start:dev          # all roles in one process, :3001
```

On boot the process loads `apps/backend/.env` via Node's built-in env-file support (`src/env-file.ts`). **Real environment variables always win** over the file, so exporting a var in your shell overrides it. Deployed environments have no `.env` and inject config directly — a missing file is not an error.

The defaults already target `docker-compose.dev.yml`, so `DATABASE_URL` and `REDIS_URL` can be omitted entirely when developing. See the [local column](#environment-reference) in the env reference below for everything else.

Create the first super admin (only works while no users exist):

```sh
curl -X POST http://localhost:3001/api/auth/admin-signup \
  -H 'content-type: application/json' \
  -d '{"email":"admin@eventlens.test","password":"superadmin1","name":"Admin"}'
```

### Tests

```sh
pnpm --filter backend test
```

`test/config-resolution.spec.ts` and `test/super-admin-scope.spec.ts` are pure unit tests. The face, import and scale specs create throwaway databases on the compose Postgres — point them elsewhere with `DATABASE_URL` if needed.

---

## Build

From the **repo root** (the build context is the whole workspace — the image is based on Immich's base-server images, which ship the ffmpeg/libvips/sharp/libraw toolchain):

```sh
docker build -f apps/backend/Dockerfile -t eventlens-backend .
```

The same image runs both roles — build once, push to a registry both hosts can reach, or build on each.

Outside Docker: `pnpm --filter backend build` then `node dist/main.js`. Requires Node ≥ 22 plus the native deps `sharp` and `ffmpeg` on the host.

---

## Deploy — API host (`api,ingest`)

Runs the API and the ingest workers.

```sh
cd docker
cp example.env .env          # fill in — see the ENV reference below
chmod 600 .env

# self-hosted only: bind Postgres/Redis to localhost + the tailnet interface
#   database.ports: ["127.0.0.1:5432:5432", "100.x.y.z:5432:5432"]
docker compose -f docker-compose.main.yml up -d
```

Migrations run automatically at boot under a Postgres advisory lock ([../../docs/plan/03-database-schema.md](../../docs/plan/03-database-schema.md) §5). First boot creates the schema; there is no separate migrate step.

On a PaaS instead of compose, set the same env vars in the platform's dashboard and use:

- **Build:** `pnpm install --frozen-lockfile && pnpm --filter backend build`
- **Start:** `node apps/backend/dist/main.js`
- **Health check:** `GET /api/docs` → 200

Verify:

```sh
docker compose -f docker-compose.main.yml logs -f backend   # "EventLens API running on port 3001 [roles: api,ingest]"
curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/docs   # -> 200
```

> The API process also owns the **cron schedules** (participant match sweep, staging sweep, session cleanup, storage reconcile). If your host sleeps idle services, those stop too — keep it always-on, or move the `ingest` role to the GPU host.

## Deploy — GPU host (`media`)

Runs the media workers next to the ML sidecar.

```sh
cd docker
cp example.env .env
chmod 600 .env
# point DATABASE_URL / REDIS_URL at the main VM's tailnet IP (100.x.y.z),
# or at your Neon/Upstash endpoints if those are managed.
docker compose -f docker-compose.gpu.yml up -d
```

`docker-compose.gpu.yml` already sets `EL_WORKERS_INCLUDE=media`, `EL_ML_DEVICE=cuda` and `DB_SKIP_MIGRATIONS=true`.

**Boot order:** bring the API host up first so the schema exists, then the GPU host. The advisory lock makes a race safe, but skipping migrations on the worker is cleaner and lets it start while the API is mid-migration.

**Second and later GPU hosts:** add `EL_QUEUES_EXCLUDE=facialRecognition`. Clustering must have exactly one consumer globally (risk R1); every other queue load-balances across hosts automatically via BullMQ.

**GPU telemetry:** the compose file reserves the NVIDIA device on `backend-worker` as well as on `ml`, purely so `nvidia-smi` exists in the worker container and its heartbeat can report GPU utilisation to the admin System panel. Drop that `deploy:` block if you would rather not expose the device twice — the panel then shows CPU only for that machine.

---

## Environment reference

Config is resolved once at boot in `src/repositories/config.repository.ts`. Unset values fall back to the **Default** shown; defaults describe **local development**, so every deployed environment sets the production column explicitly. Keep `.env` at `0600`.

### Roles

| Var | Default | Production | Local |
|---|---|---|---|
| `EL_WORKERS_INCLUDE` | `api,ingest` | `api,ingest` on the API host, `media` on the GPU host | `api,ingest,media` to run everything in one process |
| `EL_WORKERS_EXCLUDE` | — | Rarely used; subtracts roles from the include set. | — |
| `EL_QUEUES_EXCLUDE` | — | `facialRecognition` on the 2nd..Nth GPU host only. Also used to hand `selfie` over to the API host. | — |
| `EL_QUEUES_INCLUDE` | — | Run a queue outside this process's role — e.g. `selfie` on the API host so participant intake does not wait on the GPU box. Requires a reachable `MACHINE_LEARNING_URL`. | — |

`EL_QUEUES_EXCLUDE` always wins over `EL_QUEUES_INCLUDE`; naming the same queue in both is a startup error rather than a silent precedence rule.

### Database

One connection string covers every environment — local compose, self-hosted Postgres, or a managed provider like Neon.

| Var | Default | Production | Local |
|---|---|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5433/eventlens` | `postgres://user:pw@ep-xxx.neon.tech/eventlens?sslmode=require`, or `postgres://postgres:pw@database:5432/eventlens` in compose. Must match the DB container's `POSTGRES_*`. | Default is correct — the dev compose publishes Postgres on `5433`. |
| `DB_VECTOR_EXTENSION` | `vectorchord` | **`pgvector` on Neon** and any other managed Postgres — VectorChord cannot be installed there and migration `0001` fails without this. Leave as-is on the self-hosted image, which ships VectorChord. | Default — the dev image ships VectorChord. |
| `DB_SKIP_MIGRATIONS` | `false` | `true` on the GPU host. | Default. |

TLS is decided from the URL: `sslmode` is honoured when present, and **any non-local host requires TLS even without it**, so credentials are never sent in the clear by accident. Use `?sslmode=no-verify` for a self-signed certificate and `?sslmode=disable` to turn it off.

```bash
# Neon
DATABASE_URL=postgres://user:pw@ep-xxx.us-east-2.aws.neon.tech/eventlens?sslmode=require
DB_VECTOR_EXTENSION=pgvector
```

> Local uses VectorChord and Neon falls back to pgvector's HNSW index, so face-match ordering can differ slightly between the two environments.

### Redis / Valkey

| Var | Default | Production | Local |
|---|---|---|---|
| `REDIS_URL` | — | Preferred. `redis://` or `rediss://`; the db index rides in the path (`/2`). Takes precedence over the discrete vars. | `redis://localhost:6379` (or omit — see `REDIS_HOSTNAME`). |
| `REDIS_HOSTNAME` | `localhost` | Used only when `REDIS_URL` is unset. GPU host: tailnet IP of the main VM. | Default is correct. |
| `REDIS_PORT` | `6379` | | Default. |
| `REDIS_PASSWORD` | — | **Set one** (`requirepass`); an open Redis is RCE-adjacent. Must match the Redis container. | Not needed. |
| `REDIS_USERNAME` | — | Optional (Redis ACLs); Upstash uses `default`. | — |
| `REDIS_DBINDEX` | `0` | | |
| `REDIS_TLS` | `false` | Enables TLS for the discrete vars. `rediss://` already implies it. | — |

```bash
# Upstash — TLS is mandatory, so the scheme must be rediss://
REDIS_URL=rediss://default:<token>@<endpoint>.upstash.io:6379
```

> BullMQ workers hold blocking reads open and poll continuously, so on a command-metered plan (Upstash's free tier) they consume quota even while the queues are idle. An always-on Redis/Valkey is the cheaper fit at any real volume.

### Storage — S3 API

| Var | Default | Production | Local |
|---|---|---|---|
| `R2_ENDPOINT` | — | `https://<account_id>.r2.cloudflarestorage.com` | `http://localhost:9000` (MinIO) |
| `R2_BUCKET` | `eventlens-media` | | Default — the dev compose creates it automatically. |
| `R2_ACCESS_KEY_ID` | — | Use **separate bucket-scoped tokens per host** so they revoke independently. | `eventlens` |
| `R2_SECRET_ACCESS_KEY` | — | | `eventlens-secret` |

MinIO and R2 are both reached through `@aws-sdk/client-s3`, so local development exercises the real storage path.

### Email

Either provider works. With `EMAIL_PROVIDER` unset, Resend is chosen when `RESEND_API_KEY` is present and SMTP otherwise.

| Var | Default | Production | Local |
|---|---|---|---|
| `EMAIL_PROVIDER` | auto | `resend` or `smtp`. Explicit setting wins over autodetection. | `smtp` (Mailpit) |
| `EMAIL_FROM` | `EventLens <noreply@eventlens.local>` | `EventLens <no-reply@yourdomain>` — must be a verified sender on Resend. | Anything. |
| `RESEND_API_KEY` | — | Required when the provider is `resend`. | — |
| `SMTP_HOST` | — | Required when the provider is `smtp`. | `localhost` |
| `SMTP_PORT` | `587` | `465` for implicit TLS, `587` for STARTTLS. | `1025` |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | — | | Not needed — Mailpit takes no auth. |
| `SMTP_SECURE` | `true` on port `465` | Set explicitly to override the port heuristic. | Leave unset. |
| `SMTP_FROM` | — | Deprecated alias for `EMAIL_FROM`. | — |

```bash
# Resend over its HTTP API
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxx
EMAIL_FROM="EventLens <no-reply@yourdomain>"

# The same Resend account over SMTP instead
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USERNAME=resend
SMTP_PASSWORD=re_xxxxxxxx
```

Bootstrap values; editable at runtime in `system_config`. Locally, every message is caught by Mailpit at http://localhost:8025 and nothing is actually sent.

### Machine learning

| Var | Default | Production | Local |
|---|---|---|---|
| `MACHINE_LEARNING_URL` | `http://ml:3003` | Default inside the GPU compose network. A comma-separated list is allowed; the client health-maps and fails over. | `http://localhost:3003` |
| `EL_ML_DEVICE` | `cpu` | `cuda` on the GPU host. Reported (not detected) on the admin System panel. | `cpu` |

### Cloud-import OAuth (optional, M5)

| Var | Production | Local |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Redirect URI: `${EL_PUBLIC_BASE_URL}/api/cloud/gdrive/callback` | Only needed to test Drive import; requires a real Google app. |
| `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | Redirect URI: `${EL_PUBLIC_BASE_URL}/api/cloud/onedrive/callback` | Same for OneDrive. |

Cloud import is disabled until these are set; connect buttons return "provider is not configured". Everything else works without them, so local development can skip this entirely.

### App

| Var | Default | Production | Local |
|---|---|---|---|
| `EL_PUBLIC_BASE_URL` | `http://localhost:3001` | **Your public HTTPS origin** (e.g. `https://events.example.com`). Used for email links and OAuth redirects. | `http://localhost:5173` — the Vite origin, so gallery links in Mailpit are clickable. |
| `EL_TOKEN_ENCRYPTION_KEY` | — | **32-byte hex, required.** Encrypts gallery tokens and Drive/OneDrive refresh tokens. Generate with `openssl rand -hex 32` and **back it up like a DB credential** — losing it forces every org to reconnect (risk R11). | Optional; derived automatically when `EL_ENV=development`. |
| `EL_SESSION_TTL_DAYS` | `90` | | |
| `EL_PORT` | `3001` | Optional on a PaaS — falls back to the injected `PORT` when unset. | |
| `RESEND_WEBHOOK_SECRET` | — | Svix signing secret for `POST /api/webhooks/resend`. Without it the endpoint 401s everything. | Not needed. |
| `EL_HOST` | — | Bind address; leave unset to listen on all interfaces inside the container. | |
| `EL_ENV` | `production` | `production` | `development` |
| `EL_LOG_LEVEL` | `log` | `verbose`\|`debug`\|`log`\|`warn`\|`error`\|`fatal` | `debug` is useful. |
| `EL_STAGING_FOLDER` | `/staging` | Upload/import scratch (API host). Provision ≥ ~50 GB. | A writable relative path — the container default is not writable on a dev host. |
| `EL_CACHE_FOLDER` | `/cache` | R2 download scratch (GPU host). ≥ concurrency × largest video. | Same. |
| `EL_ENV_FILE` | `./.env` | Not used — deployed environments inject config directly. | Override to load a different env file. |

---

## Operations

- **Logs / health:** `docker compose logs -f backend`. Queue depth, ML health and per-machine CPU/GPU at `GET /api/admin/system` and `GET /api/admin/queues` (super-admin only).
- **Machine telemetry:** every process publishes its host stats to Redis on a 60s TTL, and the API aggregates them. A machine missing from the System panel means its process cannot reach Redis.
- **Backups:** nightly `pg_dump` + R2 bucket versioning (media already lives in R2). Also back up `EL_TOKEN_ENCRYPTION_KEY`.
- **Scale during an event:** boot a second GPU host with `docker-compose.gpu.yml` + `EL_QUEUES_EXCLUDE=facialRecognition`. Workers are stateless — jobs wait in Redis while none are up, so you can create the GPU host when an event starts and destroy it after.
