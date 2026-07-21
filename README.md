# EventLens

Event media management platform: organizations create events and ingest photos/videos (upload, Google Drive, OneDrive); a GPU worker runs Immich's facial classification pipeline; participants submit a selfie on a public event link and receive a tokenized personal gallery of every photo they appear in.

---

## Stack

| Layer | Technology | Production | Local (offline) |
|---|---|---|---|
| API + workers | NestJS 11, Kysely, BullMQ | one image, two roles | same process, all roles |
| Database | Postgres 14 + pgvector / VectorChord | Neon, or self-hosted | Postgres container, port `5433` |
| Queue / cache | Redis (ioredis + BullMQ) | Upstash (`rediss://`), or self-hosted | Valkey 8, port `6379` |
| Object storage | S3 API (`@aws-sdk/client-s3`) | Cloudflare R2 | MinIO, port `9000` |
| Email | Resend API **or** SMTP | Resend | Mailpit, UI on `8025` |
| Face pipeline | RetinaFace + ArcFace (`buffalo_l`, 512-dim) | CUDA sidecar on a GPU host | CPU sidecar, port `3003` |
| Web | Svelte 5 + SvelteKit 2 (`adapter-static`), Tailwind 4 | static files behind a CDN or Caddy | Vite dev server, port `5173` |

Every managed service has a local stand-in that speaks the same protocol, so the app runs its **real** storage and email code paths offline — there are no mocks and no offline-only branches.

### Repository layout

- `apps/backend` — NestJS. One codebase, two deployables selected by `EL_WORKERS_INCLUDE` (`api,ingest` and `media`). See [apps/backend/README.md](apps/backend/README.md).
- `apps/ml` — verbatim copy of `immich:machine-learning`. Deploy guide in [apps/ml/DEPLOY.md](apps/ml/DEPLOY.md); `apps/ml/README.md` is upstream's and is kept byte-for-byte.
- `apps/web` — SvelteKit static SPA. See [apps/web/README.md](apps/web/README.md).
- `docker/` — compose files for local dev and both production VMs.
- `docs/plan/` — full implementation plan (start at [docs/plan/README.md](docs/plan/README.md)).
- `packages/` — reserved for a generated OpenAPI SDK ([docs/plan/10-web-app.md](docs/plan/10-web-app.md) §4). **Not built yet** — the web app uses the hand-written client in `apps/web/src/lib/api.ts`.

---

## Running locally

Fully offline. Nothing leaves the machine after the first image pull and the ~300 MB model download.

**Prerequisites:** Node ≥ 22, pnpm, Docker.

```sh
pnpm install
cp apps/backend/.env.example apps/backend/.env

# Postgres (VectorChord) + Valkey + MinIO + Mailpit + ML sidecar
docker compose -f docker/docker-compose.dev.yml up -d

pnpm --filter backend start:dev     # API + all workers on :3001
pnpm --filter web dev               # http://localhost:5173
```

The backend reads `apps/backend/.env` on boot. Its defaults already point at the compose stack, so only the R2 and SMTP endpoints actually need values — and `.env.example` has them filled in.

| Local service | Address | Notes |
|---|---|---|
| Web (Vite) | http://localhost:5173 | proxies `/api` → `:3001` |
| API + Swagger | http://localhost:3001/api/docs | |
| Mailpit | http://localhost:8025 | every outbound email lands here |
| MinIO console | http://localhost:9001 | `eventlens` / `eventlens-secret` |

### First run — create the super admin

There is no seeded account and no signup screen. The first user is created through a one-shot endpoint that only works while the database has no users:

```sh
curl -X POST http://localhost:3001/api/auth/admin-signup \
  -H 'content-type: application/json' \
  -d '{"email":"admin@eventlens.test","password":"superadmin1","name":"Admin"}'
```

That account is a **super admin**: it can create and administer organizations but cannot open events or view photos (see [Roles](#roles)). Sign in at http://localhost:5173, create an organization, and give it an owner — that owner is the account you use for event work.

### Windows one-shot

`scripts/dev-backend.ps1` runs a built backend with all three roles in one process against the same compose stack:

```powershell
pnpm --filter backend build
powershell -File scripts/dev-backend.ps1
```

### Tests

```sh
pnpm --filter backend test          # needs docker-compose.dev.yml up (Postgres)
```

`config-resolution` and `super-admin-scope` need no services; the face, import and scale specs create their own throwaway databases on the compose Postgres.

---

## Roles

| Role | Can | Cannot |
|---|---|---|
| **Super admin** | Create, rename, delete and recover organizations; manage their members; see platform-wide and per-organization counts; see queue and machine status. | Open any event, view photos, people, or participants. Event routes are refused even for the account that created the org. |
| **Org owner / admin** | Everything inside their own organizations: events, uploads, imports, people, participants. | Anything in an organization they are not a member of. |
| **Org member** | Read-only access to their organizations' events. | Mutating event data. |
| **Participant** | Their own tokenized gallery via a public link. | Anything else. |

The super-admin boundary is enforced fail-closed in `AuthService.verifyOrgRole`: the membership bypass applies only to routes that opt in *and* are not event-scoped. Pinned by `apps/backend/test/super-admin-scope.spec.ts`.

---

## Production deployment

Two supported topologies. The code is identical — only where the four backing services live differs.

### A. Managed services

API and workers run wherever you like; Postgres, Redis, storage and email are managed. This is the lowest-ops option and the one the env defaults are written for.

```
      Browser
         │  HTTPS
         ▼
   ┌─────────────┐   static SPA (Vercel / Cloudflare Pages / any CDN)
   │     web     │   rewrites /api/* ──────────────┐
   └─────────────┘                                 │
                                                   ▼
   ┌──────────────────┐                    ┌──────────────────┐
   │  backend         │◄──── Redis ───────►│  backend-worker  │
   │  api,ingest      │      Postgres      │  media  + ml     │
   │  (PaaS)          │      R2 · Resend   │  (GPU host)      │
   └──────────────────┘                    └──────────────────┘
```

| Concern | Setting |
|---|---|
| Database | `DATABASE_URL=postgres://…@…neon.tech/eventlens?sslmode=require` **and `DB_VECTOR_EXTENSION=pgvector`** — VectorChord cannot be installed on Neon, and migration `0001` fails without this. |
| Redis | `REDIS_URL=rediss://default:<token>@<endpoint>.upstash.io:6379`. TLS is mandatory; the `rediss://` scheme enables it. |
| Storage | `R2_*` — use separate bucket-scoped tokens per host so they revoke independently. |
| Email | `EMAIL_PROVIDER=resend` + `RESEND_API_KEY`, or point SMTP at `smtp.resend.com:465`. |
| Web | Static build; add a rewrite from `/api/*` to the backend so the session cookie stays same-origin. Do **not** switch to cross-origin URLs — that needs CORS *and* `SameSite=None`. |
| Workers | The GPU host runs `EL_WORKERS_INCLUDE=media` with `DB_SKIP_MIGRATIONS=true`. |

Two things worth knowing before you commit to this shape:

- **The API process also runs the ingest queues and the cron schedules.** If your host sleeps idle services, those stop with it. Either keep the service always-on, or move `ingest` to the GPU host so the API can sleep harmlessly.
- **BullMQ polls Redis continuously**, so a command-metered plan burns quota even while queues are idle. An always-on Redis is cheaper at any real volume.

### B. Self-hosted, two VMs

Everything on your own hosts, with Postgres and Redis reachable only over a Tailscale/WireGuard tailnet — **never exposed publicly**.

```
                 Internet (HTTPS)
                       │
              ┌────────▼──────────┐          tailnet (private)         ┌──────────────────────┐
              │      Main VM      │◄─────────────────────────────────►│       GPU VM         │
              │ docker-compose.   │   Postgres 5432 · Redis 6379       │  docker-compose.     │
              │     main.yml      │                                    │      gpu.yml         │
              │                   │                                    │                      │
              │ caddy (80/443)    │                                    │  backend-worker      │
              │ backend api,ingest│                                    │   (media role)       │
              │ postgres · redis  │                                    │  ml sidecar :3003    │
              └───────────────────┘                                    └──────────────────────┘
```

```sh
# 1 — Main VM
cd docker
cp example.env .env && chmod 600 .env     # fill it in
# set your domain in docker/Caddyfile, and bind Postgres/Redis to
# localhost + the tailnet interface only
docker compose -f docker-compose.main.yml up -d

# 2 — GPU VM (after the main VM, so the schema exists)
docker build --build-arg DEVICE=cuda -t eventlens-ml:cuda apps/ml
cd docker
cp example.env .env && chmod 600 .env     # DATABASE_URL / REDIS_URL → main VM tailnet IP
docker compose -f docker-compose.gpu.yml up -d
```

Migrations run automatically at first boot under a Postgres advisory lock; there is no separate migrate step. `docker-compose.gpu.yml` sets `DB_SKIP_MIGRATIONS` so the worker never races the API.

**Second and later GPU VMs:** add `EL_QUEUES_EXCLUDE=facialRecognition`. Clustering must have exactly one consumer globally; every other queue load-balances automatically.

### Per-service guides

Build steps, the full env reference, and local-vs-production values for each:

| Service | Guide | Runs on |
|---|---|---|
| **backend** (`api,ingest` and `media` roles) | [apps/backend/README.md](apps/backend/README.md) | API host + GPU host |
| **ml** (facial recognition sidecar) | [apps/ml/DEPLOY.md](apps/ml/DEPLOY.md) | GPU host |
| **web** (static SPA) | [apps/web/README.md](apps/web/README.md) | CDN, or Caddy on the main VM |

Ready-to-fill templates: [docker/example.env](docker/example.env) (production) and [apps/backend/.env.example](apps/backend/.env.example) (local). Network and security checklist: [docs/plan/11-deployment.md](docs/plan/11-deployment.md) §4.

### Verify a deployment

```sh
curl -fsS -o /dev/null -w '%{http_code}\n' https://your-host/api/docs   # -> 200
```

Then sign in as the super admin and open **System**: it lists every process currently heartbeating into Redis, with CPU, memory, and GPU utilisation per machine. If the GPU host does not appear, its worker cannot reach Redis.

### Secrets to back up

- `EL_TOKEN_ENCRYPTION_KEY` — losing it forces every organization to reconnect Google Drive / OneDrive.
- The Postgres credentials and the R2 tokens.
