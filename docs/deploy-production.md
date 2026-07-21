# Production deployment — managed services

Target topology:

| Piece | Where |
|---|---|
| `web` (Svelte SPA) | Vercel |
| `backend` — roles `api,ingest` | Render (Docker) |
| `backend-worker` — role `media` + `ml` sidecar | JarvisLabs GPU VM, via Coolify |
| Postgres | Neon |
| Redis | Upstash |
| Object storage | Cloudflare R2 |
| Email | Resend |

> **Never commit real credentials.** Every value below is a placeholder; put the real ones only in each platform's environment settings.

---

## 0. Before you start

### 0.1 Two containers go on the GPU VM, not one

The Python ML sidecar cannot run alone. `ml` only does inference over HTTP — the thing that consumes GPU queues, pulls originals from R2, calls `ml`, and writes results back is **`backend-worker`**, the same Node image as Render runs, started with `EL_WORKERS_INCLUDE=media`.

So the JarvisLabs box runs **both**:

```
JarvisLabs VM (Coolify)
├── ml               eventlens-ml:cuda      (GPU, port 3003, never public)
└── backend-worker   eventlens-backend      (EL_WORKERS_INCLUDE=media)
```

Running `media` on Render instead would pull every full-size photo down to Render and POST it to JarvisLabs — slow and expensive. Keep them adjacent.

### 0.2 Generate the encryption key

Required in production. Losing it forces every organization to reconnect Google Drive / OneDrive.

```sh
openssl rand -hex 32
```

Store it in a password manager **and** in Render + Coolify. It must be identical in both.

### 0.3 Value corrections

Three of the values as commonly written will not work:

| Given | Use instead | Why |
|---|---|---|
| `REDIS_URL=redis://…upstash.io:6379` | `REDIS_URL=rediss://…upstash.io:6379` | Upstash only accepts TLS. `redis://` fails to connect. |
| `R2_ACCOUNT_ID` / `R2_BUCKET_NAME` | `R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com` and `R2_BUCKET=<bucket>` | The app reads `R2_ENDPOINT`/`R2_BUCKET`; the other two names are ignored. |
| *(missing)* | `DB_VECTOR_EXTENSION=pgvector` | Neon cannot install VectorChord. Without this, migration `0001` runs `CREATE EXTENSION vchord` and boot fails. |

`RESEND_WEBHOOK_SECRET` is now wired — see [§9](#9-email-delivery-tracking).

---

## 1. Neon (Postgres)

1. Create the project and database. Region should match Render's region to keep latency low.
2. Copy the **direct** connection string — the host **without** `-pooler`:
   ```
   postgresql://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/DBNAME?sslmode=require
   ```
   > **Do not use the `-pooler` URL.** Migrations take a session-level `pg_advisory_lock`, which does not survive PgBouncer's transaction pooling — the lock is silently released and concurrent boots can race the schema.
3. Confirm pgvector is available:
   ```sql
   SELECT * FROM pg_available_extensions WHERE name = 'vector';
   ```
   If that returns no row, the app cannot run on this database.
4. Note that migrations run automatically on the first Render boot. There is no separate migrate step.

**Env produced:** `DATABASE_URL`, plus `DB_VECTOR_EXTENSION=pgvector`.

---

## 2. Cloudflare R2

1. Create the bucket (e.g. `face-group`).
2. **R2 → Manage API tokens → Create token**, permission *Object Read & Write*, scoped to that bucket. Save the Access Key ID and Secret.
   - Create **two** tokens — one for Render, one for the GPU VM — so either can be revoked alone.
3. Build the endpoint from your account ID:
   ```
   https://<account_id>.r2.cloudflarestorage.com
   ```
4. **Configure CORS on the bucket.** This step is easy to miss and breaks downloads.

   Single-asset download is `GET /api/…/download` → `302` → a presigned R2 URL. The browser follows that redirect **inside a `fetch()`**, so it becomes a cross-origin request and R2 must allow your web origin:

   ```json
   [
     {
       "AllowedOrigins": ["https://your-app.vercel.app"],
       "AllowedMethods": ["GET"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["Content-Disposition", "Content-Length"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Add your custom domain to `AllowedOrigins` too once you have one. Thumbnails render in `<img>` tags and are unaffected; multi-select ZIP streams through the backend and is unaffected. It is specifically the per-photo download — including the participant gallery — that needs this.

**Env produced:** `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

---

## 3. Upstash (Redis)

1. Create a **Redis** database (not Vector/QStash). Pick the region closest to Render.
2. In the database page, take the credentials from the **Redis / TCP** connect tab — **not** the REST API tab.

   > **This trips people up.** Upstash shows two credential pairs:
   >
   > | Shown as | Looks like | Works with BullMQ? |
   > |---|---|---|
   > | `UPSTASH_REDIS_REST_URL` / `..._REST_TOKEN` | `https://…upstash.io` + a long token | ❌ **No** |
   > | Redis connection string | `rediss://default:PASSWORD@…upstash.io:6379` | ✅ Yes |
   >
   > The REST pair is an HTTP API for edge runtimes. BullMQ and ioredis speak the **Redis wire protocol over TCP** and cannot use it at all — there is no adapter, no setting, no workaround. If `REDIS_URL` starts with `https://`, the app will reject it at boot.

3. Confirm the scheme is **`rediss://`** (double `s`). Upstash requires TLS; plain `redis://` will not connect.
   ```
   rediss://default:PASSWORD@your-endpoint.upstash.io:6379
   ```
3. Enable eviction: **off**. BullMQ job state must not be evicted under memory pressure.

> BullMQ workers hold blocking reads and poll continuously, so they consume commands even when idle. On a command-metered plan this burns quota around the clock. If the bill looks wrong, that is why — an always-on Redis is cheaper at volume.

**Env produced:** `REDIS_URL`.

---

## 4. Resend (email)

1. **Domains → Add domain**, add the DNS records, wait for verification.
2. Create an API key with send permission.
3. `EMAIL_FROM` must use the verified domain, e.g. `EventLens <no-reply@yourdomain.com>`. An unverified sender is rejected at send time, which surfaces as failed jobs in the `notification` queue rather than an obvious error.

**Env produced:** `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`.

---

## 5. Render — `backend` (`api,ingest`)

### 5.1 Create the service

**New → Web Service → Build from a Git repository.**

| Setting | Value |
|---|---|
| Runtime | **Docker** |
| Dockerfile path | `apps/backend/Dockerfile` |
| Docker build context | `.` (repo root — the Dockerfile copies the pnpm workspace) |
| Health check path | `/api/docs` |

### 5.2 Environment

```sh
EL_WORKERS_INCLUDE=api,ingest
EL_ENV=production
EL_LOG_LEVEL=log
# Optional — see §10 for running selfie intake here instead of on the GPU box:
# EL_QUEUES_INCLUDE=selfie

DATABASE_URL=postgresql://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/DBNAME?sslmode=require
DB_VECTOR_EXTENSION=pgvector

REDIS_URL=rediss://default:TOKEN@your-endpoint.upstash.io:6379

R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
R2_BUCKET=face-group
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...

EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
EMAIL_FROM=EventLens <no-reply@yourdomain.com>

EL_TOKEN_ENCRYPTION_KEY=<openssl rand -hex 32>
EL_PUBLIC_BASE_URL=https://your-app.vercel.app    # set in §7, after Vercel exists
EL_SUPPORT_EMAIL=support@yourdomain.com             # optional: inbox for the Help form
EL_STAGING_FOLDER=/tmp/staging                     # writable on Render
EL_SESSION_TTL_DAYS=90

# Pause/resume the JarvisLabs GPU box from the admin panel (see §6.4).
JL_API_KEY=<jarvislabs.ai/settings/api-keys>
```

Notes:

- **`EL_PORT` is optional.** The app now falls back to Render's injected `PORT`, so you can drop `EL_PORT` entirely and let the platform decide. Set it only if you want to pin a specific port.
- Leave `EL_HOST` unset — Express then binds `0.0.0.0`, which is what Render needs.
- `EL_STAGING_FOLDER=/tmp/staging` rather than the image's `/staging`: staging is transient scratch for in-flight uploads, and `/tmp` is unambiguously writable. Anything in flight is lost on restart either way.
- `EL_SUPPORT_EMAIL` is optional. Support messages from the Help dialog are always stored and shown in the super-admin **Support** tab; this only adds an email notification on top. Leave it unset and nothing is lost.
- `EL_PUBLIC_BASE_URL` is a chicken-and-egg with Vercel. Deploy Render first with a placeholder, then come back and set it in §7.

### 5.3 Deploy and verify

First boot runs migrations. Watch the log for:

```
EventLens API running on port 10000 [roles: api,ingest]
```

```sh
curl -fsS -o /dev/null -w '%{http_code}\n' https://your-service.onrender.com/api/docs   # 200
```

If boot fails on `CREATE EXTENSION vchord`, `DB_VECTOR_EXTENSION=pgvector` is missing.
If it hangs on Redis, the scheme is `redis://` instead of `rediss://`.

> This service also owns the **cron schedules** (participant match sweep, staging sweep, session cleanup, storage reconcile) and the ingest queues. If the instance sleeps when idle, those stop with it. Either keep it always-on, or move `ingest` to the GPU VM by setting `EL_WORKERS_INCLUDE=api` here and `media,ingest` there.

---

## 6. JarvisLabs + Coolify — `ml` + `backend-worker`

### 6.1 Host prerequisites

NVIDIA driver and `nvidia-container-toolkit` on the VM. Confirm the Docker daemon can see the GPU:

```sh
docker run --rm --gpus all nvidia/cuda:12.4.0-base-ubuntu22.04 nvidia-smi
```

### 6.2 Build the ML image

Build on the GPU VM (the CUDA image is large):

```sh
git clone <your-repo> && cd event-media-platform
docker build --build-arg DEVICE=cuda -t eventlens-ml:cuda apps/ml
docker build -f apps/backend/Dockerfile -t eventlens-backend .
```

Or build once in CI, push to a registry, and have Coolify pull both.

### 6.3 Coolify stack

Create a **Docker Compose** resource with both services. Adapted from `docker/docker-compose.gpu.yml` — env comes from Coolify's UI rather than a `.env` file:

```yaml
services:
  ml:
    image: eventlens-ml:cuda
    environment:
      MACHINE_LEARNING_MODEL_TTL: "0"
      MACHINE_LEARNING_PRELOAD__FACIAL_RECOGNITION__DETECTION: buffalo_l
      MACHINE_LEARNING_PRELOAD__FACIAL_RECOGNITION__RECOGNITION: buffalo_l
    volumes:
      - model-cache:/cache
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    restart: always
    # do NOT publish 3003 — it must stay on the internal network

  backend-worker:
    image: eventlens-backend
    environment:
      EL_WORKERS_INCLUDE: media
      EL_ENV: production
      EL_ML_DEVICE: cuda
      DB_SKIP_MIGRATIONS: "true"
      MACHINE_LEARNING_URL: http://ml:3003
      EL_CACHE_FOLDER: /cache
      DATABASE_URL: ${DATABASE_URL}
      DB_VECTOR_EXTENSION: pgvector
      REDIS_URL: ${REDIS_URL}
      R2_ENDPOINT: ${R2_ENDPOINT}
      R2_BUCKET: ${R2_BUCKET}
      R2_ACCESS_KEY_ID: ${R2_ACCESS_KEY_ID}
      R2_SECRET_ACCESS_KEY: ${R2_SECRET_ACCESS_KEY}
      EL_TOKEN_ENCRYPTION_KEY: ${EL_TOKEN_ENCRYPTION_KEY}
      EL_PUBLIC_BASE_URL: ${EL_PUBLIC_BASE_URL}
    volumes:
      - worker-cache:/cache
    # optional: lets the worker report GPU utilisation to the admin panel
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu, utility]
    depends_on: [ml]
    restart: always

volumes:
  model-cache:
  worker-cache:
```

Key points:

- **`DB_SKIP_MIGRATIONS=true`** — Render owns the schema. Bring Render up first.
- **`EL_TOKEN_ENCRYPTION_KEY` must be byte-identical to Render's**, or the worker cannot decrypt cloud-account tokens.
- **No `EL_PORT`, no public ingress.** This service has no HTTP server; it only consumes queues. Don't attach a Coolify domain to it.
- `ml` must not be publicly reachable. It has no authentication.
- The second `deploy:` block on `backend-worker` is only so `nvidia-smi` exists in that container for telemetry. Inference happens in `ml`. Remove it and you lose GPU figures on the dashboard, nothing else.
- **First boot downloads `buffalo_l` (~300 MB)** from HuggingFace into `model-cache`. Expect a couple of minutes; later boots are fast.

### 6.4 Verify

```sh
docker compose logs -f ml              # model preloaded
docker compose logs -f backend-worker  # "EventLens worker running [roles: media]"
docker compose exec backend-worker sh -c 'wget -qO- http://ml:3003/ping'   # pong
```

**Scaling to a second GPU VM:** identical stack plus `EL_QUEUES_EXCLUDE=facialRecognition`. Clustering must have exactly one consumer globally; every other queue load-balances via BullMQ automatically.

### 6.5 Pausing and resuming the box from EventLens

The GPU box is billed per second, so it should only be up when there is work. **Admin → GPU worker** decides when that is, and can pause/resume the JarvisLabs instance itself.

JarvisLabs publishes **no REST API** — only the `jl` CLI and a Python SDK. So the API service controls the instance by running `jl` as a child process ([`jarvislabs.repository.ts`](../apps/backend/src/repositories/jarvislabs.repository.ts)) rather than calling a webhook. The backend image already ships the CLI: it is installed into an isolated virtualenv at `/opt/jarvislabs` and symlinked to `/usr/local/bin/jl`. A venv rather than a system `pip install` because Debian marks the system interpreter externally-managed (PEP 668), which refuses the plain install.

Setup:

1. Get a token from [jarvislabs.ai/settings/api-keys](https://jarvislabs.ai/settings/api-keys) and set `JL_API_KEY` on the **Render** service (§5.2). The CLI reads that variable directly, so no `jl setup` and no writable config file are needed — which is what makes this work on Render's read-only filesystem.
2. Find the instance id with `jl list` locally.
3. In **Admin → GPU worker → Autostart**, set **Control method** to **JarvisLabs CLI**, paste the **Instance ID**, and optionally a GPU type to resume with (blank keeps the original).
4. Press **Test connection**. This runs `jl get` read-only and proves the binary, the token and the id all work before autostart depends on them.

**This works on Render's Docker runtime — verified, not assumed.** Building the image's `jl` layer and running it with the rootfs mounted read-only, as a non-root user, with `HOME` pointing at a path that does not exist, still returns a correct `jl list` / `jl get`. Nothing is written to disk at any point, because `JL_API_KEY` is read from the environment and there is no `jl setup` step and no config file. That is the property the whole approach depends on, so re-run that check if you ever bump the base image or the `jarvislabs` package.

Two behaviours worth knowing:

- **Resume can reassign the instance id.** The CLI documents this, so the id returned by `jl resume` is persisted into the lifecycle state and used for the subsequent pause. Pausing the stale id would leave the real machine running and billing — which is exactly the failure this avoids.
- **Resume is region-locked.** An instance always resumes in the region it was created in; asking for a GPU type that region does not offer fails. Leave the GPU field blank unless you have a reason.

A failed pause is not a runaway bill: the box also polls `/api/webhooks/gpu/heartbeat` and shuts *itself* down when the API says so or becomes unreachable. The CLI is the fast path; the heartbeat is the backstop.

---

## 7. Vercel — `web`

### 7.1 Project settings

The build is a static SPA (`adapter-static`), inside a pnpm workspace.

| Setting | Value |
|---|---|
| Framework preset | **Other** (not SvelteKit — that preset expects `adapter-vercel`) |
| Root directory | repo root |
| Install command | `pnpm install --frozen-lockfile` |
| Build command | `pnpm --filter web build` |
| Output directory | `apps/web/build` |

The web tier takes **no environment variables**.

### 7.2 The API rewrite — required

Sessions ride an `HttpOnly`, `SameSite=Lax`, `Secure` cookie and the client calls a relative `/api` path. The API must appear on the **same origin**. Commit `vercel.json` at the repo root:

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://your-service.onrender.com/api/:path*" }
  ]
}
```

Without this, every request 404s. With a cross-origin URL instead, the cookie is dropped — `SameSite=Lax` is not sent on cross-site requests, and you would additionally need CORS and `SameSite=None`. Keep the rewrite.

### 7.3 Close the loop

1. Note the Vercel URL.
2. Set `EL_PUBLIC_BASE_URL=https://your-app.vercel.app` on **Render** and on **Coolify**, then redeploy both. Emailed gallery links and OAuth redirects are built from it.
3. Add that origin to the **R2 CORS policy** (§2.4).

> Check Vercel's request-body limit against your largest upload. Uploads pass through this rewrite; if the edge caps bodies below your largest video they fail before reaching Render. Never route uploads through a serverless function — its body limit is far smaller than a photo.

---

## 8. First run

No account is seeded and there is no signup screen. Create the first super admin — this endpoint only works while the user table is empty:

```sh
curl -X POST https://your-app.vercel.app/api/auth/admin-signup \
  -H 'content-type: application/json' \
  -d '{"email":"you@yourdomain.com","password":"<strong-password>","name":"Admin"}'
```

That account administers organizations but **cannot open events or view photos**. Sign in, create an organization, and assign an owner — that owner does the event work.

### Verification checklist

- [ ] `GET /api/docs` → 200 through the Vercel domain (proves the rewrite works)
- [ ] Sign in as super admin → lands on **Organizations**
- [ ] **System** panel lists **two machines** — Render and the GPU VM — with the GPU showing utilisation. One machine means the worker cannot reach Redis.
- [ ] Create an org and an event, upload a photo → it appears, and the `mediaProcess` / `faceDetection` queues advance
- [ ] Submit a selfie on the public event link → participant receives the gallery email (check Resend's dashboard for delivery)
- [ ] Download a single photo → succeeds. A CORS error in the browser console means §2.4 is missing.

---

## 9. Email delivery tracking

`POST /api/webhooks/resend` records delivery outcomes against `email_log`.

1. Set `RESEND_WEBHOOK_SECRET` on **Render** (the `ingest` role owns the `notification` queue, so that is where mail is sent from and where the log rows live).
2. In Resend → **Webhooks**, add an endpoint pointing at:
   ```
   https://your-app.vercel.app/api/webhooks/resend
   ```
   Subscribe to `email.delivered`, `email.bounced`, `email.complained`, and `email.failed`. Copy the signing secret (`whsec_…`) into `RESEND_WEBHOOK_SECRET`.

How it behaves:

- The request is verified against Resend's Svix signature (`svix-id`, `svix-timestamp`, `svix-signature`) using `node:crypto` — HMAC-SHA256 over `${id}.${timestamp}.${rawBody}`, constant-time compared.
- Anything unverified gets **401**, including when the secret is unset. A wrong secret therefore shows up as failed deliveries in Resend's dashboard rather than silently doing nothing.
- Replays are rejected outside a ±5 minute window, and a signature is bound to its message id and body, so a captured request cannot be retargeted at another email.
- Webhooks are not ordered, so a late event cannot overwrite a newer one (`status_at` guards the update).
- `email.opened` / `email.clicked` are accepted and ignored — engagement, not deliverability.

Status flow: `queued` → `sent` (provider accepted) → `delivered` | `bounced` | `complained`. `failed` means the message could not be handed over at all.

> The webhook must reach the backend. Because it is under `/api/*`, the Vercel rewrite already forwards it — you can equally point Resend straight at the Render URL if you would rather it not traverse the CDN.

---

## 9a. GPU box — on-demand lifecycle

The GPU box is woken when there is work and shut down when there is not. Configured under **Admin → GPU worker**.

### How it decides

| Setting | Default | Meaning |
|---|---|---|
| `pendingThreshold` | 25 | Wake once this many jobs are queued across the GPU queues. |
| `maxPendingAgeMinutes` | 120 | …or once the oldest waiting job has sat this long. This is what rescues a single job stuck below the threshold. |
| `idleShutdownMinutes` | 10 | Stop this long after the queues go quiet. |
| `startTimeoutMinutes` | 20 | Give up and stop if the box never reports in. |

"Process all" on the admin page starts the box immediately regardless of thresholds, and holds it up for one idle window so a manual run is not cut short by a lull between jobs.

### Start and stop

Provider-agnostic: configure a **start webhook URL** and **stop webhook URL** plus an `Authorization` header. The backend POSTs `{"action":"start"|"stop","reason":"…"}`. Point these at whatever the provider exposes — a JarvisLabs API endpoint, a Coolify deploy hook, or your own script.

### Keeping it alive — the direction matters

The box is **not** pushed to. It polls:

```
GET /api/webhooks/gpu/heartbeat
Authorization: Bearer $EL_GPU_HEARTBEAT_TOKEN
→ { "keepAlive": true|false, "reason": "...", "pending": 3 }
```

Install [scripts/gpu-autoshutdown.sh](../scripts/gpu-autoshutdown.sh) on the VM:

```sh
sudo cp scripts/gpu-autoshutdown.sh /usr/local/bin/
sudo chmod +x /usr/local/bin/gpu-autoshutdown.sh
# via systemd, with EL_API_URL and EL_GPU_HEARTBEAT_TOKEN in the unit's Environment=
```

Set `EL_GPU_HEARTBEAT_TOKEN` to the same value on Render and on the VM.

The polling direction is deliberate. The VM needs no inbound access, and **if the API is unreachable the VM shuts itself down** after `FAILURE_GRACE` attempts. The expensive resource fails closed: an outage, a bad deploy, or a bug costs you an idle machine for a few minutes, not a weekend of GPU time. `keepAlive` stays true while any job is in flight, so a shutdown never lands mid-job.

---

## 9c. Live selfie progress on the public page

By default a guest submits a selfie, gets a "check your email" acknowledgement, and leaves. When the GPU box happens to be **awake and keeping up**, they instead stay on the page and watch their place in the queue, refreshed every 10 seconds, with an estimate.

The server decides which of the two they see — the page only renders `mode`:

| `mode` | When | What the guest sees |
|---|---|---|
| `live` | GPU worker online **and** total GPU pending ≤ 100 | Spinner, "You're number 4 in the queue", "Roughly about 2 minutes to go". Flips to a result if it finishes while they watch. |
| `email` | Box off, starting, or busier than that | The existing "we've emailed you a private link" alert. |

**The email is sent either way.** The live view is a convenience and never the only route to the photos — a guest who closes the tab loses nothing.

Why the cutoff is *total* GPU pending rather than the selfie queue's own depth: the selfie queue can be nearly empty while an import has thousands of faces queued ahead of it on the same GPU. Total depth is the honest signal for whether an estimate means anything. The threshold is `LIVE_MODE_MAX_PENDING` in [selfie-progress.service.ts](../apps/backend/src/services/selfie-progress.service.ts).

**This interacts with `pendingThreshold` in [§9a](#9a-gpu-box--on-demand-lifecycle).** That setting decides when the box *wakes*; this one decides when guests are *shown* a countdown. If you raise `pendingThreshold` above 100, the box will routinely be asleep with work queued below the live cutoff, and guests will always get the email path — which is correct, just worth knowing you chose it.

Estimates come from BullMQ's own completed-per-minute metrics over the last 15 minutes, so they already reflect whatever else the GPU is doing. With no throughput history yet — the first submission after a wake — it falls back to a fixed per-selfie cost.

### The progress ticket

The submit response carries an opaque, AES-GCM ticket (same key as everything else, [§0.2](#02-generate-the-encryption-key)) that is valid for 30 minutes.

It is **not** a gallery token and deliberately unlocks nothing: every endpoint reading it returns a status and counts, never photos and never the gallery link. That is what makes it safe to hand straight back over HTTP. Gallery tokens still only ever reach the mailbox owner, so submitting someone else's address gains an attacker nothing. A forged or expired ticket returns `{ "mode": "email" }` rather than an error, so it cannot be used to probe for valid participants either.

### If you moved selfie intake to Render ([§10](#10-optional--run-selfie-intake-on-render))

Handled automatically. When the API process runs the `selfie` queue itself (`EL_QUEUES_INCLUDE=selfie`), the GPU box's state is irrelevant to how fast that guest is served, so the live view is offered regardless of whether the box is awake. No extra configuration.

---

## 9b. Event expiration and media retention

Two separate moments:

| | What happens |
|---|---|
| `expiresAt` (organizer-set, per event) | Guest gallery links close and selfie intake stops. **Nothing is deleted.** Both return `410 Gone`, and the guest sees "this event has closed" rather than a broken-link error. |
| `purgeAfter` = `expiresAt` + grace | The media is deleted from R2. |

The grace period is `purgeGraceHours` (default 24, super-admin configurable via `PUT /api/admin/retention`).

Flow:

1. Organizer sets an expiry date in **Event → Settings → Expiration**. The date is included in the "we got your selfie" email, so guests know the deadline from their first message.
2. Hourly sweep: once the date passes, the org **owners** are emailed — how many files, when they will be deleted, and what they can do.
3. Owners can **extend** (guest links come back immediately, purge cancelled), **delete now** (skips the grace period), or do nothing.
4. Daily sweep: after the grace period, the media is deleted from R2 and the event is marked purged.

Safety properties worth knowing:

- Expiry is **computed**, never a stored flag, so extending restores access instantly with no sweep to wait for.
- The purge sweep **re-reads each event** before deleting, so an extension between the query and the delete is honoured.
- Purging requires the event to already be expired, so nothing can destroy a live gallery in one click.
- Once purged the media is gone; extending afterwards is rejected rather than silently doing nothing.

---

## 10. Optional — run selfie intake on Render

Selfie processing is the one participant-facing job with a person waiting on it. By default it runs on the GPU box, so if that box is asleep between events, selfies queue and participants see "still processing".

`EL_QUEUES_INCLUDE` lets a deployment run a queue outside its role:

```sh
# Render
EL_WORKERS_INCLUDE=api,ingest
EL_QUEUES_INCLUDE=selfie
MACHINE_LEARNING_URL=https://<an ML endpoint Render can reach>

# GPU VM — hand the queue over, don't run it twice
EL_QUEUES_EXCLUDE=selfie
```

Include and exclude on the same queue is a startup error, so the handover cannot be half-applied.

Render still needs *some* ML endpoint, because embedding a selfie is a model call. Two ways:

| | How | Trade-off |
|---|---|---|
| **Second Render service, CPU ML** | Deploy `apps/ml` built with `DEVICE=cpu` as its own service; point `MACHINE_LEARNING_URL` at its internal URL | Fully independent of the GPU box — selfies work while it is off. Costs one more always-on service with ~1 GB RAM for the model. CPU embedding of a single selfie is well under a second. |
| **Reuse the GPU sidecar** | Expose `ml` publicly through Coolify **behind auth or an IP allowlist** and point Render at it | No extra cost, but selfie intake still depends on the GPU box being up, which is most of what this was meant to fix. `ml` has no authentication of its own — never expose it bare. |

Worth knowing either way: matching a selfie is embedding **plus** a KNN query against `face_search`, and that query only finds photos that have *already* been processed by the GPU box. Moving selfie intake to Render makes participant registration instant and independent; it does not let a gallery fill up before the photos have been through face detection.

---

## Environment matrix

| Var | Render (`api,ingest`) | Coolify (`media`) | Vercel |
|---|---|---|---|
| `EL_WORKERS_INCLUDE` | `api,ingest` | `media` | — |
| `EL_ENV` | `production` | `production` | — |
| `EL_PORT` | optional (falls back to `PORT`) | — | — |
| `EL_QUEUES_INCLUDE` | `selfie` (optional, §10) | — | — |
| `EL_QUEUES_EXCLUDE` | — | `selfie` if Render took it | — |
| `DATABASE_URL` | ✅ | ✅ | — |
| `DB_VECTOR_EXTENSION` | `pgvector` | `pgvector` | — |
| `DB_SKIP_MIGRATIONS` | — | `true` | — |
| `REDIS_URL` | ✅ `rediss://` | ✅ `rediss://` | — |
| `R2_*` | ✅ | ✅ | — |
| `EMAIL_PROVIDER` / `RESEND_API_KEY` / `EMAIL_FROM` | ✅ | — | — |
| `MACHINE_LEARNING_URL` | — | `http://ml:3003` | — |
| `EL_ML_DEVICE` | — | `cuda` | — |
| `EL_TOKEN_ENCRYPTION_KEY` | ✅ | ✅ (identical) | — |
| `JL_API_KEY` | ✅ (GPU pause/resume, §6.5) | — | — |
| `EL_SESSION_TTL_DAYS` | optional | — | — |
| `RESEND_WEBHOOK_SECRET` | ✅ | — | — |
| `EL_GPU_HEARTBEAT_TOKEN` | ✅ | ✅ (same value, used by the shutdown script) | — |
| `EL_PUBLIC_BASE_URL` | ✅ | ✅ | — |
| `EL_SUPPORT_EMAIL` | optional | — | — |
| `EL_STAGING_FOLDER` | `/tmp/staging` | — | — |
| `EL_CACHE_FOLDER` | — | `/cache` | — |

Email vars are only needed where the `notification` queue runs — the `ingest` role, i.e. Render.
