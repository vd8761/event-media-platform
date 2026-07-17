# 07 — Participant Flow (selfie → match → gallery → email)

The product's signature flow. Public surfaces are `/e/{slug}` (event page) and `/g/{token}` (personal gallery); both are unauthenticated SPA routes backed by public API endpoints.

## 1. Public event page — `/e/{slug}`

- `GET /api/public/events/{slug}` → `{name, description, startsAt, endsAt, participantPageEnabled}`. 404 for draft/closed/disabled events (indistinguishable from nonexistent).
- UI: event branding + a form with **email** and **selfie** (mobile camera capture `<input capture="user">` or file picker). Consent text: what the selfie is used for, retention period (§6), contact.

## 2. Selfie intake

`POST /api/public/events/{slug}/participants` — multipart `{email, file}`.

- **Rate limits**: 5/hour per IP, 3/day per email per event; max file 15 MB, image mimetypes only.
- **Upsert on `(event_id, email)`**: re-submission replaces the selfie, regenerates the gallery token, resets status to `processing` (old matches are kept; rematch will reconcile).
- Token: 32 random bytes via ported `crypto.repository.ts` (`immich:server/src/repositories/crypto.repository.ts`); only the **SHA-256 hash** is stored (`gallery_token_hash`); the raw token exists solely inside the emailed link.
- Selfie → R2 `org/{orgId}/event/{eventId}/selfie/{participantId}.jpg`; enqueue `selfie:SelfieProcess {participantId}`.
- Response is always the same generic 202 — "Check your email once your photos are ready." No indication whether the email was already registered (no enumeration).

## 3. Matching model — face-level, not cluster-level (Decision D6)

**Why not match selfies to Immich person clusters?** Immich only creates a `person` once a face has `minFaces` (default 3) close neighbors (`immich:server/src/services/person.service.ts`, `handleRecognizeFaces`). A guest who appears in only 1–2 photos **never gets a cluster** — cluster-level matching would silently drop them. Unacceptable here: those guests are exactly who most wants their photos.

**Design:**

- The participant's `selfie_embedding` is KNN-searched **directly against `face_search`** — all detected faces of the event, clustered or not — using the same CTE as clustering ([06-face-pipeline.md](06-face-pipeline.md) §4) without the `hasPerson` filter. Threshold `event.config.matchMaxDistance ?? 0.5`, `numResults` up to 200.
- Each hit inserts `participant_match (participant_id, asset_id, via_face_id, distance)` with `on conflict do nothing` — **idempotent**; the gallery reads from this table.
- Immich clustering still runs unchanged: persons power the org-facing People UI, and person creation triggers rematch — but participant-facing correctness never depends on cluster formation.

**Triggers for (re)matching** — all funnel into one service function `matchParticipant(participantId)`:

| Trigger | Path |
|---|---|
| Selfie processed | `SelfieProcess` runs match inline (GPU worker; it already holds the embedding) |
| New faces detected / new person created | debounced `match:ParticipantRematch {eventId}` (jobId `rematch:{eventId}`, 60 s delay — 500 uploads → 1 rematch) |
| Safety net | `ParticipantMatchSweep` cron (15 min) rematches `pending_match` participants of active events — covers "selfie submitted before any photos were uploaded" |

Status transitions: `processing` → (`no_face` | `pending_match` | `matched`); `pending_match` → `matched` on first match.

## 4. Personal gallery — `/g/{token}`

Auth follows Immich's shared-link pattern (`immich:web/src/routes/(user)/s/[slug]` + `auth-manager.svelte.ts` params): the SPA keeps the token and sends it on **every** API call; the ported AuthGuard (`immich:server/src/middleware/auth.guard.ts`) hashes it and resolves the participant **before** session auth — same priority order as Immich's shared-link-first `validate()` (`immich:server/src/services/auth.service.ts`).

- `GET /api/public/gallery/{token}` → event info + matched assets sorted by `captured_at`, each with presigned `thumbUrl`/`previewUrl` (1 h expiry, [04-storage-r2.md](04-storage-r2.md) §5).
- `GET /api/public/gallery/{token}/assets/{assetId}/download` → 302 presigned original — **after validating the asset is in this participant's `participant_match`**.
- "Download all" (M6): zip streaming of matched originals (Immich `archiver` pattern from `immich:server/src/repositories/storage.repository.ts`).
- The gallery is **live**: every load reflects current `participant_match` rows; email cadence is independent of gallery freshness.
- Token revocation = participant deletion or event closure; org can regenerate+resend from the participants dashboard.

## 5. Email pipeline

Ported nodemailer + react-email stack (`immich:server/src/repositories/email.repository.ts`; layout components from `immich:server/src/emails/components/`; dispatch pattern from `immich:server/src/services/notification.service.ts`) running on the `notification` queue (ingest role). SMTP config in `system_config` (+ env bootstrap).

Templates (`apps/backend/src/emails/`):

| Template | Trigger | Content |
|---|---|---|
| `gallery-ready.email.tsx` | first match(es) for a participant | "Your photos from **{event}** are ready" + gallery button (`{EL_PUBLIC_BASE_URL}/g/{token}`) + match count. **No media URLs** (presigned links expire; [04-storage-r2.md](04-storage-r2.md) §5). |
| `gallery-update.email.tsx` | digest — new matches after first notification | "{n} new photos of you at {event}" + gallery button |
| `no-face-detected.email.tsx` | `SelfieProcess` finds no face | ask to retry with a clearer photo, link back to `/e/{slug}` |

**Cadence — notify once, then digest:** first match → `SendGalleryEmail` immediately (`notified_first_at` set). Later matches → `SendDigest` enqueued with jobId `digest:{participantId}` and a delay honoring **≥ 6 h since `last_notified_at`**; the handler re-checks the throttle and current new-match count at send time (accumulates naturally). Every send → `email_log` row; failures surface in the org participants dashboard with a **resend** action (`POST /api/events/{eventId}/participants/{id}/resend`).

## 6. Privacy & retention

- Selfies and `selfie_embedding` are used **only** for matching within the one event; stated on the public page.
- `SelfieRetentionSweep` (daily, `storageCleanup` queue): N days after `event.ends_at` (default 30, org-configurable) → delete selfie objects from R2, null `selfie_embedding`, soft-delete participant rows. Matched-photo access ends with the event's retention, communicated in the gallery.
- Gallery tokens are high-entropy (256-bit), stored hashed, transmitted only in the emailed link over TLS.
- Org staff can delete any participant (right-to-erasure): removes matches, selfie object, and log rows.
