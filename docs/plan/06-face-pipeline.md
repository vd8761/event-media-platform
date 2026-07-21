# 06 — Facial Classification Pipeline (the Immich port)

This is the subsystem the user asked to keep **"the exact same process"**. It is ported at high fidelity: the Python ML service is a verbatim copy; the Node orchestration copies Immich's algorithms line-for-line with one systematic change — **tenancy scope `ownerId` → `eventId`**.

## 1. ML sidecar (verbatim `immich_ml`)

Copied unmodified from `immich:machine-learning/` → `apps/ml/`. Facts that matter to callers:

- **`POST /predict`** — multipart form: `entries` (JSON) + `image` (bytes). Face request entry (`immich:machine-learning/immich_ml/schemas.py`):
  ```json
  {"facial-recognition": {
     "detection":   {"modelName": "buffalo_l", "options": {"minScore": 0.7}},
     "recognition": {"modelName": "buffalo_l"}}}
  ```
  Response: `{"facial-recognition": [{"boundingBox": {"x1","y1","x2","y2"}, "embedding": "<JSON-serialized 512-float array>", "score"}], "imageHeight", "imageWidth"}`. The embedding arrives as a **string** (`serialize_np_array`, `immich:machine-learning/immich_ml/models/transforms.py`) ready to insert into Postgres without re-serialization.
- **Models**: RetinaFace detection + ArcFace recognition from the InsightFace **`buffalo_l`** bundle (`immich:machine-learning/immich_ml/models/facial_recognition/detection.py`, `recognition.py`); recognition depends on detection output within one request (5-point landmark alignment via `norm_crop`).
- **Download/cache**: HuggingFace repo `immich-app/<model>` → `MACHINE_LEARNING_CACHE_FOLDER` volume (`immich:machine-learning/immich_ml/models/base.py`).
- **GPU**: image built with `DEVICE=cuda` (`immich:machine-learning/Dockerfile`) → onnxruntime-gpu, `CUDAExecutionProvider` (`immich:machine-learning/immich_ml/sessions/ort.py`).
- **Warm-up**: `MACHINE_LEARNING_PRELOAD__FACIAL_RECOGNITION__DETECTION=buffalo_l`, `..._RECOGNITION=buffalo_l`, `MACHINE_LEARNING_MODEL_TTL=0` — models load at boot and never unload (`immich:machine-learning/immich_ml/config.py`).
- **`GET /ping`** health check.

Caller: ported `machine-learning.repository.ts` (`immich:server/src/repositories/machine-learning.repository.ts`) — `detectFaces(imagePath, {modelName, minScore})`, multipart POST, healthy-URL map with failover, periodic `/ping`. `MACHINE_LEARNING_URL=http://ml:3003`.

## 2. Configuration (system defaults, per-event overridable)

Same defaults as `immich:server/src/config.ts` (~line 310), stored in `system_config` and overridable per event via `event.config`:

| Key | Default | Meaning |
|---|---|---|
| `modelName` | `buffalo_l` | InsightFace bundle |
| `minScore` | `0.7` | detection confidence threshold (→ `det_thresh`) |
| `maxDistance` | `0.5` | max cosine distance for same-person (clustering **and** selfie matching) |
| `minFaces` | `3` | min cluster size to auto-create a `person` |

## 3. Stage A — Face detection (`faceDetection` queue, GPU worker)

Port of `PersonService.handleDetectFaces` (`immich:server/src/services/person.service.ts` ~line 300) into `face.service.ts`:

1. Load asset + its **preview** derivative; stage preview from R2 to `/cache` (Immich reads the local preview path; ours differs only in staging step).
2. `machineLearningRepository.detectFaces(previewLocalPath, config)`.
3. Scale returned boxes from ML image dimensions back to stored asset dimensions.
4. **Reconcile against existing faces with IoU > 0.5** (`iou()` ~line 384) so re-runs never duplicate faces; new faces get UUIDs.
5. Persist atomically via ported `refreshFaces(facesToAdd, faceIdsToRemove, embeddings)` — Immich's CTE-chained insert/delete writing `asset_face` + `face_search` together (`immich:server/src/repositories/person.repository.ts` ~line 410).
6. Enqueue one `FaceRecognize {faceId}` per **new** face; enqueue debounced `ParticipantRematch {eventId}`.

**Scoping changes vs Immich (audit checklist):** asset lookup by `(eventId, assetId)`; no `ownerId` anywhere; no visibility/timeline gate (all event assets are eligible); `asset_job_status` replaced by `asset.status`.

## 4. Stage B — Clustering (`facialRecognition` queue, concurrency 1, API host)

Port of `PersonService.handleRecognizeFaces` (`immich:server/src/services/person.service.ts` ~line 459) — **the** clustering algorithm, kept intact:

1. Load face + embedding (skip if already assigned to a person or non-ML source).
2. **KNN**: ported `searchFaces` (`immich:server/src/repositories/search.repository.ts` ~line 316) with `maxDistance = 0.5`, `numResults = minFaces`:
   ```sql
   -- in a transaction
   set local vchordrq.probes = <probes>;
   with cte as (
     select asset_face.id, asset_face.person_id,
            face_search.embedding <=> :embedding as distance
     from asset_face
     join asset       on asset.id = asset_face.asset_id
     join face_search on face_search.face_id = asset_face.id
     where asset.event_id = :eventId          -- ★ Immich: asset.ownerId = any(:userIds)
       and asset.deleted_at is null
       [and asset_face.person_id is not null]  -- hasPerson variant
     order by distance
     limit :numResults
   )
   select * from cte where distance <= :maxDistance;
   ```
   The `★` line is the **only semantic change**. Dropped vs Immich: the `person.birthDate <= fileCreatedAt` filter (no birthdates here).
3. If `minFaces > 1` and only the face itself matched → skip (not enough evidence yet).
4. **Core/deferred two-pass** (kept verbatim): a face is *core* when `matches.length >= minFaces`; non-core faces are re-queued once with `deferred: true` so they run after core faces have created persons.
5. **Assignment**: adopt `person_id` from any matched neighbor that has one; else second KNN with `hasPerson: true, numResults: 1`; else — if core — **create a new `person`** (`event_id`, cover face) and enqueue `PersonThumbnail {personId}` + debounced `ParticipantRematch {eventId}`. Finally `reassignFaces([faceId], personId)`.

**Why concurrency 1 is non-negotiable:** two concurrent recognitions of faces from the same unseen identity would each find no person and each create one → duplicate clusters. Immich pins this queue to the non-concurrent set (`immich:server/src/services/queue.service.ts`); the constraint must hold **globally**. The queue runs on the API host (it is DB work, not GPU work), so this binds the API tier to one instance — extras set `EL_QUEUES_EXCLUDE=facialRecognition` ([01-architecture.md](01-architecture.md) §4).

`FaceRecognizeQueueAll {eventId, force?}` (port of `handleQueueRecognizeFaces` ~line 401) is the admin "re-run clustering" entry point: waits for `faceDetection` to drain, on `force` unassigns ML faces, prewarms the vector index (`vchordrq_prewarm('face_index')`, `immich:server/src/repositories/database.repository.ts`), streams unassigned faces, enqueues each. A ported `handlePersonCleanup` deletes persons left with zero faces.

## 5. Stage C — Person thumbnail (`personThumbnail` queue, GPU worker)

Port of `MediaService.handleGeneratePersonThumbnail` (`immich:server/src/services/media.service.ts` ~line 407): load cover face bounding box, stage the source preview from R2, crop with Immich's `getCrop` math (clamp + expand box), output **250 px JPEG** (`FACE_THUMBNAIL_SIZE`, `immich:server/src/constants.ts`), upload to `org/…/person/{personId}.jpeg`, set `person.thumbnail_key`. When a cluster's cover face changes/merges, the ported `createNewFeaturePhoto` picks a random face and re-enqueues.

## 6. Selfie embedding (shared machinery)

`SelfieProcess` uses the **same** `detectFaces` call on the selfie image, picks the largest bounding box, and stores the 512-d embedding on `participant.selfie_embedding`. Matching then reuses the same CTE as §4 step 2 (without the `hasPerson` filter — face-level matching, Decision D6). Details: [07-participant-flow.md](07-participant-flow.md).

## 7. Event scoping — privacy invariant + mandated test

**Invariant:** no query may compare embeddings across events. A missed `ownerId→eventId` conversion silently matches faces across events — a privacy breach, not a bug.

Enforcement:
- Scope lives **inside the SQL CTE** (`asset.event_id = :eventId`), not in application-level post-filtering.
- Repository audit: every method in `face.repository.ts` / `face-search.repository.ts` takes `eventId` as its first parameter.
- **Mandated integration test** (part of M3 acceptance, [12-roadmap.md](12-roadmap.md)): create two events; upload photos of the *same* person to both; run the full pipeline; assert (a) two disjoint `person` rows, (b) zero `participant_match` rows across events when a selfie is submitted to one of them, (c) `searchFaces` called with event A never returns faces of event B.

## 8. Re-tuning knobs (documented, defaults unchanged)

- Crowded-event false merges → lower `maxDistance` (e.g. 0.45) per event via `event.config`.
- Low-light/small faces missed → lower `minScore` to 0.6 (more false detections downstream).
- Huge events (>50 k faces): raise VectorChord `probes` for recall; prewarm after bulk imports.
