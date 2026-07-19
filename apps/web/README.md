# `web` — SvelteKit SPA

A **static single-page app** (Svelte 5 + SvelteKit 2 with `@sveltejs/adapter-static`, `fallback: index.html`). There is no Node server for the web tier: `vite build` emits plain files that any static host or reverse proxy can serve. All data loading happens in the browser against the same-origin API.

Because it's static, "deploying the web" means: build the files, then put them somewhere that serves `index.html` as the SPA fallback and forwards `/api/*` to the backend.

---

## Local development

```sh
pnpm install
pnpm --filter web dev        # http://localhost:5173
```

Vite proxies `/api` to `http://localhost:3001`, so the backend must be running — see the repo root [README](../../README.md) for the full offline stack (Postgres, Redis, MinIO, Mailpit, ML).

| Command | Purpose |
|---|---|
| `pnpm --filter web dev` | Dev server with HMR on `:5173`. |
| `pnpm --filter web build` | Production build into `apps/web/build/`. |
| `pnpm --filter web preview` | Serve the built output locally to sanity-check it. |
| `pnpm --filter web check` | `svelte-check` type/a11y pass. |

There are **no** environment variables in either environment — see [Configuration](#configuration).

---

## Build

```sh
pnpm install
pnpm --filter web build
# output: apps/web/build/  (index.html + hashed JS/CSS/font assets)
```

The build takes no runtime configuration. It calls the API at the same origin under `/api`, so the public URL is decided entirely by where you serve the files and by the backend's `EL_PUBLIC_BASE_URL`.

---

## Deploy — static host / CDN

Vercel, Cloudflare Pages, Netlify, S3+CloudFront: upload `apps/web/build/` and add two rules.

| Setting | Value |
|---|---|
| Build command | `pnpm install --frozen-lockfile && pnpm --filter web build` |
| Output directory | `apps/web/build` |
| SPA fallback | Serve `index.html` for any unmatched path (adapter-static already emits it). |
| API rewrite | `/api/*` → `https://your-backend-host/api/*` |

The API rewrite is **not optional**. Sessions ride an `HttpOnly` cookie and the client calls a relative `/api` path, so the API has to appear on the same origin as the app. On Vercel:

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://your-backend-host/api/:path*" }
  ]
}
```

> Don't switch the client to absolute cross-origin URLs instead. That needs CORS enabled on the backend **and** `SameSite=None` cookies, which is strictly more moving parts and more attack surface for no benefit. The proxy rewrite keeps everything same-origin.

Set the backend's `EL_PUBLIC_BASE_URL` to the web app's public origin — that's what email links and OAuth redirects are built from.

## Deploy — Caddy on the main VM

The main VM's `proxy` service already routes `/api/*` and serves static files from `/srv/web` — see [../../docker/Caddyfile](../../docker/Caddyfile):

```
handle {
    root * /srv/web
    try_files {path} /index.html   # SPA fallback
    file_server
}
```

**One wiring step is required:** the `proxy` service in `docker-compose.main.yml` does not mount the built output into the container. Add a read-only bind mount:

```yaml
  proxy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ../apps/web/build:/srv/web:ro     # <-- add this line
      - caddydata:/data
    depends_on: [backend]
    restart: always
```

Then, from the repo root on the main VM:

```sh
pnpm --filter web build                  # produces apps/web/build/
# set your domain in docker/Caddyfile (replace events.example.com)
cd docker && docker compose -f docker-compose.main.yml up -d proxy
```

Caddy provisions TLS automatically via ACME for the domain in the Caddyfile. To ship a new build, re-run `pnpm --filter web build` — files are read per request, so no restart is needed unless you just added the mount.

### Alternative: bake into an image

If you'd rather not bind-mount:

```dockerfile
# apps/web/Dockerfile (optional — not currently in the repo)
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter web build

FROM nginx:alpine
COPY --from=build /app/apps/web/build /usr/share/nginx/html
# nginx.conf: try_files $uri /index.html;  (SPA fallback)
```

The Caddy-serves-static approach above is the documented default; this is only if you prefer a self-contained web container.

---

## Configuration

The web tier takes **no environment variables** in any environment — everything is decided by the proxy and the backend.

| Concern | Production | Local |
|---|---|---|
| API location | Same-origin `/api`, forwarded by the CDN rewrite or Caddy to the backend. | Same-origin `/api`, proxied by Vite to `http://localhost:3001`. |
| Public URL / TLS | The static host's domain, or the Caddyfile site address. Mirror it in the backend's `EL_PUBLIC_BASE_URL`. | `http://localhost:5173`; set `EL_PUBLIC_BASE_URL` to match so emailed gallery links work. |
| Upload size ceiling | `request_body max_size` in the Caddyfile (default 5 GB), or the CDN's body limit. | Not enforced by Vite. |

> Check your host's request-body limit before going live. Photo and video uploads go through this path, and if the edge caps bodies below your largest file they fail before ever reaching the backend. Serverless function limits in particular are far smaller than a video — route uploads through a straight proxy rewrite, never through a function. If your CDN can't pass bodies that large at all, serve the whole app from a proxy that can (the Caddy setup below) rather than splitting uploads onto a second origin — that would break the same-origin cookie the API depends on.

## What the super admin sees

The nav is driven by real organization memberships. A super admin has none, so **Events and Cloud accounts are hidden** and `/events` redirects to `/admin/organizations`. This mirrors the API, which refuses event routes for super admins — showing those links would only lead to 403s. See [Roles](../../README.md#roles).
