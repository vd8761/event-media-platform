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

WORKDIR /usr/src/app
ENV NODE_ENV=production
COPY --from=builder /output/backend ./

VOLUME /staging
VOLUME /cache
EXPOSE 3001
ENTRYPOINT ["node", "dist/main.js"]
