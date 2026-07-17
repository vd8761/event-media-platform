# EventLens — Implementation Plan

Implementation plan for a standalone **event media management platform** derived from [Immich](https://immich.app) (reference checkout: `C:\Projects\immich`, read-only — code is copied out, never modified). Working codename **EventLens**; rename freely.

**One-paragraph summary:** Super Admins manage Organizations; organizations create Events and ingest photos/videos via manual upload, Google Drive, or OneDrive; a GPU worker VM processes all media (thumbnails, transcodes, and Immich's exact facial classification pipeline — RetinaFace + ArcFace 512-d embeddings with cosine-KNN clustering); participants submit a selfie on a public event link and receive an email with a tokenized personal gallery of every photo they appear in. Storage is Cloudflare R2; state is Postgres (+VectorChord) and Redis (BullMQ); the `backend` (API, main VM) and `backend-worker` (GPU VM) are one NestJS codebase deployed in two roles.

## Documents

| # | Document | Contents |
|---|---|---|
| 00 | [Overview](00-overview.md) | Concept, actors, architecture diagram, stack, decisions log, requirements traceability |
| 01 | [Architecture](01-architecture.md) | backend vs backend-worker split, roles, ML sidecar, connectivity/security, scaling |
| 02 | [Monorepo & code reuse](02-monorepo-and-code-reuse.md) | Repo layout, full Immich→EventLens copy map, not-copied list, porting rules |
| 03 | [Database schema](03-database-schema.md) | All tables, multi-tenancy rules, VectorChord decision + pgvector fallback, migrations |
| 04 | [R2 storage](04-storage-r2.md) | StorageRepository, key scheme, through-API upload, presigned serving, deletion lifecycle |
| 05 | [Job orchestration](05-job-orchestration.md) | Queue catalog, payloads, pipelines (upload/import/selfie), retries, crons |
| 06 | [Face pipeline](06-face-pipeline.md) | Verbatim ML sidecar, detection→clustering port, event-scoping invariant, tuning knobs |
| 07 | [Participant flow](07-participant-flow.md) | Selfie intake, face-level matching, tokenized gallery, email cadence, retention |
| 08 | [Cloud imports](08-cloud-imports.md) | Drive/Graph OAuth, folder browser, import fan-out, incremental re-sync, throttling |
| 09 | [API surface](09-api-surface.md) | Auth model + endpoint groups (super-admin, org, public) |
| 10 | [Web app](10-web-app.md) | SvelteKit SPA, verbatim Immich theme, route map, ported components |
| 11 | [Deployment](11-deployment.md) | docker-compose for both VMs, env reference, security checklist, scaling playbook |
| 12 | [Roadmap & risks](12-roadmap.md) | Milestones M1–M6 with acceptance criteria, 12-item risk register, definition of done |

**Reading order:** 00 → 01 → 02 → 03 → 05 → 04 → 06 → 07 → 08 → 09 → 10 → 11 → 12.

## Conventions used throughout

- `immich:server/src/...` = path inside the read-only Immich checkout at `C:\Projects\immich`.
- Env prefix `EL_`; Bull prefix `el_bull`; queue/table/env names are identical in every document (see 05/03/11 respectively as the authoritative lists).
- All settled decisions are logged in [00-overview.md](00-overview.md) §4 (D1–D10) — do not re-open them during implementation.
