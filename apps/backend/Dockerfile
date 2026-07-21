# EventLens backend — one image for both deployables (`backend` on the main VM
# with EL_WORKERS_INCLUDE=api,ingest, `backend-worker` on the GPU VM with
# EL_WORKERS_INCLUDE=media). Based on Immich's base images, which ship the
# exact ffmpeg/libvips/sharp/libraw toolchain (docs/plan/02 §2.2) needed from
# M2 onward. Build from the repo root:
#   docker build -f apps/backend/Dockerfile -t eventlens-backend .
FROM ghcr.io/immich-app/base-server-dev:202607132058 AS builder

ENV CI=1
RUN npm install --global pnpm@10

WORKDIR /usr/src/app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/backend/package.json apps/backend/
RUN pnpm install --filter backend --frozen-lockfile

COPY apps/backend apps/backend
RUN pnpm --filter backend build && \
    pnpm --filter backend --prod deploy /output/backend

FROM ghcr.io/immich-app/base-server-prod:202607132058

# JarvisLabs instance control. JarvisLabs has no REST API — only the `jl` CLI —
# so GpuLifecycleService pauses/resumes the GPU box by running this binary as a
# child process (src/repositories/jarvislabs.repository.ts).
#
# Installed into its own virtualenv rather than the system Python: Debian marks
# the system interpreter externally-managed (PEP 668), so a plain `pip install`
# is refused. The venv sidesteps that without `--break-system-packages` and
# keeps the CLI's dependency tree away from anything else on the image. Only
# `jl` is symlinked onto PATH.
#
# Auth is the JL_API_KEY env var — the CLI reads it directly, so no `jl setup`
# and no writable config file are needed, which is what makes this work on
# Render's read-only container filesystem.
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-venv && \
    python3 -m venv /opt/jarvislabs && \
    /opt/jarvislabs/bin/pip install --no-cache-dir --upgrade pip && \
    /opt/jarvislabs/bin/pip install --no-cache-dir jarvislabs && \
    ln -sf /opt/jarvislabs/bin/jl /usr/local/bin/jl && \
    rm -rf /var/lib/apt/lists/*
# NB: python3 is deliberately kept — the venv's interpreter symlinks to it, so
# purging it would break `jl` at runtime.

WORKDIR /usr/src/app
ENV NODE_ENV=production
COPY --from=builder /output/backend ./

VOLUME /staging
VOLUME /cache
EXPOSE 3001
ENTRYPOINT ["node", "dist/main.js"]
