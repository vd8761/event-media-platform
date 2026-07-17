# 09 — API Surface

NestJS controllers (api role only). Global `AuthGuard` + `@Authenticated({...})` decorator ported from `immich:server/src/middleware/auth.guard.ts` / `immich:server/src/services/auth.service.ts`. OpenAPI spec is generated from controllers and drives the typed web SDK (`packages/sdk`, Immich `open-api/` pattern).

## 1. Auth model

Credential resolution order per request (Immich's shared-link-first pattern):

1. **Gallery token** (query `token` or header `x-gallery-token`) → SHA-256 → `participant` lookup. Grants only: own participant record, matched assets, event public info.
2. **Session token** (HttpOnly cookie or bearer) → SHA-256 → `session` → user.

Authorization tiers via decorator: `@Authenticated()` (any user), `@Authenticated({ superAdmin: true })`, `@Authenticated({ orgRole: 'member' | 'admin' | 'owner' })` (resolved against the org in the route), `@Authenticated({ participant: true })` (gallery token allowed). Org-role routes resolve the org from `orgId`/`eventId` path params and verify membership + role — never from the body.

## 2. Endpoints

### Auth
| Method & path | Auth | Notes |
|---|---|---|
| `POST /api/auth/login` | — | email+password (bcrypt), sets session cookie |
| `POST /api/auth/logout` | user | deletes session |
| `GET /api/auth/me` | user | profile + memberships + superAdmin flag |
| `PUT /api/auth/password` | user | |

### Super admin (`superAdmin: true`)
| Method & path | Notes |
|---|---|
| `GET/POST /api/admin/organizations` | list/create org (+ initial owner user: create-or-invite by email) |
| `GET/PUT/DELETE /api/admin/organizations/{id}` | suspend via `status` |
| `GET /api/admin/stats` | orgs/events/assets/storage totals |
| `GET /api/admin/queues` | BullMQ `getJobCounts` per queue (Immich queue-status pattern, `immich:server/src/services/queue.service.ts`) |
| `POST /api/admin/queues/{name}/{action}` | pause / resume / clear-failed / retry-failed |

### Organization & events (org roles)
| Method & path | Role | Notes |
|---|---|---|
| `GET /api/orgs/{orgId}` | member | |
| `GET/POST /api/orgs/{orgId}/members` · `PUT/DELETE /api/orgs/{orgId}/members/{userId}` | owner | invite by email, set role |
| `GET/POST /api/orgs/{orgId}/events` | member / admin | |
| `GET/PUT/DELETE /api/events/{eventId}` | member / admin / admin | slug, dates, status, `participant_page_enabled`, `config` overrides |

### Assets (org)
| Method & path | Role | Notes |
|---|---|---|
| `POST /api/events/{eventId}/assets` | member | multipart upload → SHA-1 → dedupe → R2 → `AssetProcess`; `201 {id}` or `200 {status:'duplicate', id}` ([04-storage-r2.md](04-storage-r2.md) §3) |
| `POST /api/events/{eventId}/assets/bulk-upload-check` | member | `{assets:[{checksum, filename}]}` → per-item exists/new (Immich preflight) |
| `GET /api/events/{eventId}/assets?cursor&limit` | member | sorted `captured_at`; presigned `thumbUrl`/`previewUrl` inline (1 h) |
| `GET /api/events/{eventId}/assets/{id}` | member | full detail + faces summary |
| `GET /api/events/{eventId}/assets/{id}/download` | member | 302 presigned original |
| `DELETE /api/events/{eventId}/assets` | admin | bulk `{ids}` → soft-delete + `storageCleanup` |
| `POST /api/events/{eventId}/assets/jobs` | admin | re-run: `{name: 'faceDetection' | 'facialRecognition' | 'thumbnails', force?}` |

### People (org — cluster review)
| Method & path | Role | Notes |
|---|---|---|
| `GET /api/events/{eventId}/people` | member | clusters + face counts + presigned thumbnail |
| `PUT /api/events/{eventId}/people/{personId}` | admin | rename / hide |
| `GET /api/events/{eventId}/people/{personId}/assets` | member | photos of that person |

### Participants (org)
| Method & path | Role | Notes |
|---|---|---|
| `GET /api/events/{eventId}/participants` | member | email, status, match count, email status (`email_log` join) |
| `POST /api/events/{eventId}/participants/{id}/resend` | admin | regenerate token + resend gallery email |
| `DELETE /api/events/{eventId}/participants/{id}` | admin | erasure: matches + selfie + logs ([07-participant-flow.md](07-participant-flow.md) §6) |

### Cloud imports (org)
| Method & path | Role | Notes |
|---|---|---|
| `GET /api/orgs/{orgId}/cloud/{provider}/authorize` | admin | 302 OAuth ([08-cloud-imports.md](08-cloud-imports.md)) |
| `GET /api/cloud/{provider}/callback` | (state JWT) | token exchange |
| `GET /api/orgs/{orgId}/cloud/accounts` · `DELETE .../accounts/{accountId}` | admin | |
| `GET /api/orgs/{orgId}/cloud/accounts/{accountId}/folders?parentId` | admin | folder browser |
| `POST /api/events/{eventId}/imports` | admin | `{accountId, folderId, recursive}` |
| `GET /api/events/{eventId}/imports` · `GET /api/imports/{id}` · `POST /api/imports/{id}/cancel` | member / member / admin | progress contract in [08](08-cloud-imports.md) §5 |

### Public (no session)
| Method & path | Auth | Notes |
|---|---|---|
| `GET /api/public/events/{slug}` | — | event page info; 404 unless active+enabled |
| `POST /api/public/events/{slug}/participants` | — | selfie intake; rate-limited; generic 202 ([07](07-participant-flow.md) §2) |
| `GET /api/public/gallery/{token}` | gallery token | event info + matched assets + presigned URLs |
| `GET /api/public/gallery/{token}/assets/{assetId}/download` | gallery token | 302 presigned; validates membership in `participant_match` |

## 3. Cross-cutting

- **Validation**: zod DTOs (Immich api pattern); multipart handled by the ported `FileUploadInterceptor`.
- **Rate limiting**: global modest limit; strict on `/api/public/**` and `/api/auth/login`.
- **Pagination**: cursor-based (`captured_at, id`) on asset listings.
- **Errors**: RFC-7807-style `{statusCode, message, error}` (Nest default), no internals leaked on public routes.
- **CORS**: same-origin (SPA served by the same proxy); no cross-origin API use in v1.
