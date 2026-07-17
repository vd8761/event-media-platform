# 10 — Web App

Single **SvelteKit 2 / Svelte 5 (runes)** static SPA (`@sveltejs/adapter-static`, fallback `index.html`) — same architecture as Immich web (no SvelteKit server; all loaders run in the browser against the API). Built output is served by the reverse proxy on the main VM.

## 1. Design system — Immich look, verbatim

- Copy `immich:web/src/app.css` (CSS custom properties `--immich-primary`, dark-mode vars, fonts) and the **Tailwind CSS v4** setup (`@tailwindcss/vite`).
- Depend on **`@immich/ui`** (published npm package — Button, Input, Field, IconButton, modals/toasts managers) + `@mdi/js` icons; composite components ported from `immich:web/src/lib/components/**` as needed.
- Rebranding later = swapping CSS vars + logo; the design language stays.

## 2. Route map

```
(auth)
  /login

(admin)                       # superAdmin only — guard: authenticate({ admin: true }) pattern
  /admin/organizations                 list + create
  /admin/organizations/[id]            detail, members, suspend
  /admin/system                        queue dashboard (per-queue counts, pause/retry), stats

(org)                         # org membership required — landing = /events
  /events                              event list across my orgs
  /events/[eventId]                    event gallery (grid + asset viewer)
  /events/[eventId]/people             cluster review (People grid, rename/hide, person detail)
  /events/[eventId]/participants       participant dashboard (status, matches, resend email)
  /events/[eventId]/imports            Drive/OneDrive wizard + progress
  /events/[eventId]/settings           slug, dates, status, participant page toggle, ML overrides
  /settings/cloud-accounts             org-level Drive/OneDrive connections

(public)                      # no auth bootstrap, stripped layout
  /e/[slug]                            event page: email + selfie form (camera capture)
  /g/[token]                           personal gallery: grid, viewer, download, download-all
```

Guard pattern ported from `immich:web/src/lib/utils/auth.ts` (`authenticate(url, { admin })`); public routes skip auth entirely (Immich's shared-link route pattern, `immich:web/src/routes/(user)/s/[slug]`).

## 3. Ported web machinery

| Immich source | Use in EventLens |
|---|---|
| `immich:web/src/lib/managers/upload-manager.svelte.ts` + `immich:web/src/lib/utils/file-uploader.ts` + `immich:web/src/lib/utils/executor-queue.ts` | Org upload: 2-concurrent XHR multipart to `POST /api/events/{eventId}/assets` with progress |
| `immich:web/src/lib/workers/hash-file.ts` | Browser-side SHA-1 → `bulk-upload-check` preflight; duplicates marked without sending bytes |
| `UploadPanel.svelte`, `UploadAssetPreview.svelte` (`immich:web/src/routes/`) | Upload progress panel |
| `immich:web/src/lib/managers/timeline-manager/**` + grid/viewer components | Event gallery **and** participant gallery `/g/[token]` (virtualized grid, date grouping by `captured_at`, lightbox viewer) |
| `immich:web/src/lib/components/faces-page/**`, people routes (`immich:web/src/routes/(user)/people/**`) | `/events/[eventId]/people` cluster review: PeopleCard grid, person detail (photos of person), rename, hide |
| Shared-link auth params pattern (`immich:web/src/lib/managers/auth-manager.svelte.ts`) | `/g/[token]`: token attached to every API/media request |
| Drag-and-drop store, supported-mediatype checks | Upload UX |

## 4. API client

`packages/sdk` — TypeScript client generated from the backend's OpenAPI spec (the `@immich/sdk` / `immich:open-api/` generation pattern, function-per-endpoint). The web app never hand-writes fetch calls except the raw-XHR upload path (progress events), mirroring Immich.

## 5. Behaviors worth specifying

- **Presigned URL expiry**: gallery grids may outlive the 1 h URL expiry. On image 403/`onerror`, the grid refetches the listing page (fresh URLs) once, with backoff — required for `/g/[token]` tabs left open ([04-storage-r2.md](04-storage-r2.md) §5).
- **Upload**: file picker + folder drag-drop; per-file states PENDING/STARTED/DONE/DUPLICATED/ERROR (Immich upload store states).
- **Selfie capture** on `/e/[slug]`: `<input type="file" accept="image/*" capture="user">` → native camera on mobile; preview + retake before submit.
- **Import wizard**: pick account (or connect → OAuth popup) → browse folders (lazy tree via `/folders?parentId`) → confirm → progress screen polling `GET /api/imports/{id}` (counts + per-item failures).
- **Participant dashboard**: table with status chips (`processing`/`no_face`/`pending_match`/`matched`), match counts, last email state from `email_log`, resend button.
- **i18n**: skip in v1 (Immich's svelte-i18n wiring is portable later); hardcode English strings.
- **Processing feedback**: event gallery shows a subtle "processing" badge on assets whose `status != 'processed'` (thumbnail appears when ready; simple polling on the event page, no websockets in v1).
