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
docker compose -f docker/docker-compose.dev.yml up -d   # Postgres (VectorChord) + Redis
pnpm --filter backend start:dev
```
