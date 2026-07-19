# `web` — SvelteKit SPA (production)

A **static single-page app** (SvelteKit + `@sveltejs/adapter-static`, `fallback: index.html`). There is no Node server for the web tier: `vite build` emits plain files that the **Caddy proxy on the main VM serves directly**, routing `/api/*` to the backend. All data loading happens in the browser against the same-origin API.

Because it's static, "deploying the web" means: build the files, then make them available to Caddy at `/srv/web`.

## Build

```sh
pnpm install
pnpm --filter web build
# output: apps/web/build/  (index.html + hashed JS/CSS/font assets)
```

The build has no runtime environment variables. It calls the API at the same origin under `/api` (the Caddyfile proxies that to `backend:3001`), so the only thing that determines the public URL is where Caddy serves it and the backend's `EL_PUBLIC_BASE_URL`.

## Serve via Caddy (main VM)

The main VM's `proxy` service (Caddy) already routes `/api/*` and serves static files from `/srv/web` — see [../../docker/Caddyfile](../../docker/Caddyfile):

```
handle {
    root * /srv/web
    try_files {path} /index.html   # SPA fallback
    file_server
}
```

**One wiring step is required:** the `proxy` service in `docker-compose.main.yml` does not yet mount the built output into the container. Add a read-only bind mount of the build directory to `/srv/web`:

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

Caddy provisions TLS automatically via ACME for the domain in the Caddyfile. To ship a new frontend build, re-run `pnpm --filter web build` and `docker compose restart proxy` (or reload — the files are read on request; a restart is only needed if the mount was just added).

### Alternative: bake into an image

If you'd rather not bind-mount, build a tiny static image and point Caddy at a shared volume, or serve with nginx:

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

The Caddy-serves-static approach above is the documented default; this image is only if you prefer a self-contained web container.

## Configuration

| Concern | Where it's set |
|---|---|
| Public URL / TLS | `docker/Caddyfile` site address (the domain), + the backend's `EL_PUBLIC_BASE_URL` for email links and OAuth redirects. |
| API location | Hard-wired to same-origin `/api`; Caddy proxies to `backend:3001`. No build-time API URL. |
| Upload size ceiling | `request_body max_size` in the Caddyfile (default 5 GB for video uploads). |

The web tier itself takes **no** environment variables — everything is decided by the proxy config and the backend.

## Local development

```sh
pnpm --filter web dev        # Vite on http://localhost:5173, proxies /api -> http://localhost:3001
```

See the repo root [README](../../README.md) for the full local stack (Postgres, Redis, MinIO, mailpit, ML) via `docker-compose.dev.yml`.
