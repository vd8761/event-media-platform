// Scope-first repository (docs/plan/03-database-schema.md §3): every lookup
// takes eventId. Dedupe is the (event_id, checksum) unique index; the ported
// constraint-detection helper answers unique-violations with 'duplicate'.
import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { AssetFileType, AssetStatus } from 'src/enum';
import { Asset, DB } from 'src/schema';
import { Insertable } from 'kysely';
import { AssetFileTable, AssetTable } from 'src/schema';

export interface AssetListItem {
  id: string;
  type: string;
  status: string;
  originalFilename: string;
  capturedAt: Date | null;
  createdAt: Date;
  width: number | null;
  height: number | null;
  thumbhash: Buffer | null;
  facesDetectedAt: Date | null;
  faceCount: number;
  previewKey: string | null;
  thumbKey: string | null;
}

@Injectable()
export class AssetRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  create(asset: Insertable<AssetTable>): Promise<Asset> {
    return this.db.insertInto('asset').values(asset).returningAll().executeTakeFirstOrThrow();
  }

  getById(eventId: string, assetId: string): Promise<Asset | undefined> {
    return this.db
      .selectFrom('asset')
      .selectAll()
      .where('id', '=', assetId)
      .where('eventId', '=', eventId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  // Worker-side lookup (job payloads carry assetId only, no eventId).
  getByIdUnscoped(assetId: string): Promise<Asset | undefined> {
    return this.db
      .selectFrom('asset')
      .selectAll()
      .where('id', '=', assetId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  findByChecksum(eventId: string, checksum: Buffer): Promise<Asset | undefined> {
    return this.db
      .selectFrom('asset')
      .selectAll()
      .where('eventId', '=', eventId)
      .where('checksum', '=', checksum)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  // Preflight: which of these checksums already exist in the event.
  async existingChecksums(eventId: string, checksums: Buffer[]): Promise<Map<string, string>> {
    if (checksums.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .selectFrom('asset')
      .select(['id', 'checksum'])
      .where('eventId', '=', eventId)
      .where('checksum', 'in', checksums)
      .where('deletedAt', 'is', null)
      .execute();
    return new Map(rows.map((row) => [row.checksum.toString('hex'), row.id]));
  }

  // Used by the expiry email so the organizer sees exactly how much is at
  // stake before the media is deleted.
  async countForEvent(eventId: string): Promise<number> {
    const row = await this.db
      .selectFrom('asset')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('eventId', '=', eventId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  // Org-wide timeline: every event's photos in one stream, ordered by capture
  // date. Same cursor shape as list() so the two share a client.
  async listForOrg(
    orgId: string,
    opts: { limit: number; cursorCapturedAt?: Date | null; cursorId?: string },
  ): Promise<(AssetListItem & { eventId: string; eventName: string })[]> {
    let query = this.db
      .selectFrom('asset')
      .innerJoin('event', 'event.id', 'asset.eventId')
      .leftJoin('assetFile as preview', (join) =>
        join.onRef('preview.assetId', '=', 'asset.id').on('preview.type', '=', AssetFileType.Preview),
      )
      .leftJoin('assetFile as thumb', (join) =>
        join.onRef('thumb.assetId', '=', 'asset.id').on('thumb.type', '=', AssetFileType.Thumbnail),
      )
      .select([
        'asset.id',
        'asset.type',
        'asset.status',
        'asset.originalFilename',
        'asset.capturedAt',
        'asset.createdAt',
        'asset.width',
        'asset.height',
        'asset.thumbhash',
        'asset.facesDetectedAt',
        'asset.faceCount',
        'preview.storageKey as previewKey',
        'thumb.storageKey as thumbKey',
        'asset.eventId',
        'event.name as eventName',
      ])
      .where('asset.orgId', '=', orgId)
      .where('asset.deletedAt', 'is', null)
      .where('event.deletedAt', 'is', null)
      // Purged events keep their rows but their objects are gone from R2, so
      // including them would render a wall of broken thumbnails.
      .where('event.purgedAt', 'is', null)
      .orderBy('asset.capturedAt', 'desc')
      .orderBy('asset.id', 'desc')
      .limit(opts.limit);

    if (opts.cursorCapturedAt !== undefined && opts.cursorId) {
      const capturedAt = opts.cursorCapturedAt;
      const cursorId = opts.cursorId;
      query = query.where((eb) =>
        capturedAt
          ? eb.or([
              eb('asset.capturedAt', '<', capturedAt),
              eb.and([eb('asset.capturedAt', '=', capturedAt), eb('asset.id', '<', cursorId)]),
            ])
          : eb.and([eb('asset.capturedAt', 'is', null), eb('asset.id', '<', cursorId)]),
      );
    }

    return query.execute() as unknown as Promise<(AssetListItem & { eventId: string; eventName: string })[]>;
  }

  // Map markers: one point per geotagged photo across the org's live events
  // (Immich MapService.getMapMarkers, scoped to an org instead of a user's
  // whole library since events are the sharing boundary here).
  async getMapMarkersForOrg(
    orgId: string,
  ): Promise<{ id: string; eventId: string; lat: number; lon: number; thumbKey: string | null }[]> {
    return this.db
      .selectFrom('asset')
      .innerJoin('assetExif', 'assetExif.assetId', 'asset.id')
      .innerJoin('event', 'event.id', 'asset.eventId')
      .leftJoin('assetFile as thumb', (join) =>
        join.onRef('thumb.assetId', '=', 'asset.id').on('thumb.type', '=', AssetFileType.Thumbnail),
      )
      .select([
        'asset.id',
        'asset.eventId',
        'assetExif.latitude as lat',
        'assetExif.longitude as lon',
        'thumb.storageKey as thumbKey',
      ])
      .where('asset.orgId', '=', orgId)
      .where('asset.deletedAt', 'is', null)
      .where('event.deletedAt', 'is', null)
      .where('event.purgedAt', 'is', null)
      .where('assetExif.latitude', 'is not', null)
      .where('assetExif.longitude', 'is not', null)
      .orderBy('asset.capturedAt', 'desc')
      .execute() as unknown as Promise<
      { id: string; eventId: string; lat: number; lon: number; thumbKey: string | null }[]
    >;
  }

  // Footer figure in the sidebar: what this organization is actually storing.
  //
  // Deliberately counts assets belonging to soft-deleted events too — those
  // objects are still in R2 until the purge sweep runs, so excluding them
  // would under-report the bill. No event count here: it would disagree with
  // the sidebar's own list, which shows live events only.
  async getOrgStorage(orgId: string): Promise<{ bytes: number; assets: number }> {
    const row = await this.db
      .selectFrom('asset')
      .select((eb) => [
        sql<string>`coalesce(sum(asset.file_size), 0)`.as('bytes'),
        eb.fn.countAll<string>().as('assets'),
      ])
      .where('asset.orgId', '=', orgId)
      .where('asset.deletedAt', 'is', null)
      .executeTakeFirst();

    return { bytes: Number(row?.bytes ?? 0), assets: Number(row?.assets ?? 0) };
  }

  // Per-event usage breakdown for the account-stats page. One grouped query
  // rather than a query per event; events with no assets still appear (left
  // join) so a freshly created event is not silently missing from the list.
  async getOrgUsageByEvent(orgId: string): Promise<
    { eventId: string; eventName: string; photos: number; videos: number; bytes: number }[]
  > {
    const rows = await this.db
      .selectFrom('event')
      .leftJoin('asset', (join) =>
        join.onRef('asset.eventId', '=', 'event.id').on('asset.deletedAt', 'is', null),
      )
      .select((eb) => [
        'event.id as eventId',
        'event.name as eventName',
        sql<string>`count(asset.id) filter (where asset.type = 'image')`.as('photos'),
        sql<string>`count(asset.id) filter (where asset.type = 'video')`.as('videos'),
        sql<string>`coalesce(sum(asset.file_size), 0)`.as('bytes'),
        eb.fn.max('event.createdAt').as('createdAt'),
      ])
      .where('event.orgId', '=', orgId)
      .where('event.deletedAt', 'is', null)
      .groupBy(['event.id', 'event.name'])
      .orderBy('createdAt', 'desc')
      .execute();

    return rows.map((row) => ({
      eventId: row.eventId,
      eventName: row.eventName,
      photos: Number(row.photos),
      videos: Number(row.videos),
      bytes: Number(row.bytes),
    }));
  }

  update(assetId: string, dto: Partial<Insertable<AssetTable>>): Promise<Asset> {
    return this.db
      .updateTable('asset')
      .set(dto)
      .where('id', '=', assetId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  setStatus(assetId: string, status: AssetStatus): Promise<void> {
    return this.db.updateTable('asset').set({ status }).where('id', '=', assetId).execute().then(() => undefined);
  }

  // Marks detection as having run (migration 0003) — set even when the photo
  // contains no faces, which is exactly the case the timestamp disambiguates.
  setFacesDetected(assetId: string, faceCount: number): Promise<void> {
    return this.db
      .updateTable('asset')
      .set({ facesDetectedAt: new Date(), faceCount })
      .where('id', '=', assetId)
      .execute()
      .then(() => undefined);
  }

  // Cursor pagination on (capturedAt desc, id) — stable ordering (docs/plan/09 §3).
  // Fetch a specific set of assets with their files — used to hydrate
  // similar-photo results, which arrive as an ordered id list from the vector
  // search. Order is restored by the caller.
  listByIds(eventId: string, ids: string[]): Promise<AssetListItem[]> {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    return this.db
      .selectFrom('asset')
      .leftJoin('assetFile as preview', (join) =>
        join.onRef('preview.assetId', '=', 'asset.id').on('preview.type', '=', AssetFileType.Preview),
      )
      .leftJoin('assetFile as thumb', (join) =>
        join.onRef('thumb.assetId', '=', 'asset.id').on('thumb.type', '=', AssetFileType.Thumbnail),
      )
      .select([
        'asset.id',
        'asset.type',
        'asset.status',
        'asset.originalFilename',
        'asset.capturedAt',
        'asset.createdAt',
        'asset.width',
        'asset.height',
        'asset.thumbhash',
        'asset.facesDetectedAt',
        'asset.faceCount',
        'preview.storageKey as previewKey',
        'thumb.storageKey as thumbKey',
      ])
      .where('asset.eventId', '=', eventId)
      .where('asset.deletedAt', 'is', null)
      .where('asset.id', 'in', ids)
      .execute();
  }

  async list(
    eventId: string,
    opts: {
      limit: number;
      cursorCapturedAt?: Date | null;
      cursorId?: string;
      faceStatus?: 'pending' | 'found' | 'none';
    },
  ): Promise<AssetListItem[]> {
    let query = this.db
      .selectFrom('asset')
      .leftJoin('assetFile as preview', (join) =>
        join.onRef('preview.assetId', '=', 'asset.id').on('preview.type', '=', AssetFileType.Preview),
      )
      .leftJoin('assetFile as thumb', (join) =>
        join.onRef('thumb.assetId', '=', 'asset.id').on('thumb.type', '=', AssetFileType.Thumbnail),
      )
      .select([
        'asset.id',
        'asset.type',
        'asset.status',
        'asset.originalFilename',
        'asset.capturedAt',
        'asset.createdAt',
        'asset.width',
        'asset.height',
        'asset.thumbhash',
        'asset.facesDetectedAt',
        'asset.faceCount',
        'preview.storageKey as previewKey',
        'thumb.storageKey as thumbKey',
      ])
      .where('asset.eventId', '=', eventId)
      .where('asset.deletedAt', 'is', null)
      .orderBy('asset.capturedAt', 'desc')
      .orderBy('asset.id', 'desc')
      .limit(opts.limit);

    switch (opts.faceStatus) {
      case 'pending': {
        query = query.where('asset.facesDetectedAt', 'is', null);
        break;
      }
      case 'found': {
        query = query.where('asset.facesDetectedAt', 'is not', null).where('asset.faceCount', '>', 0);
        break;
      }
      case 'none': {
        query = query.where('asset.facesDetectedAt', 'is not', null).where('asset.faceCount', '=', 0);
        break;
      }
    }

    if (opts.cursorId) {
      // coalesce nulls so the (capturedAt, id) tuple compares deterministically
      const capturedAt = opts.cursorCapturedAt ?? new Date(0);
      query = query.where((eb) =>
        eb.or([
          eb('asset.capturedAt', '<', capturedAt),
          eb.and([eb('asset.capturedAt', '=', capturedAt), eb('asset.id', '<', opts.cursorId!)]),
        ]),
      );
    }

    return query.execute();
  }

  // Random sample for the Memories slideshow: only assets with a ready
  // preview, so the auto-advancing viewer never lands on a broken frame.
  // `ORDER BY random()` is a full scan, but events run to at most a few
  // thousand photos, so this stays well under viewer-perceptible latency.
  async getRandomForEvent(eventId: string, limit: number): Promise<AssetListItem[]> {
    return this.db
      .selectFrom('asset')
      .innerJoin('assetFile as preview', (join) =>
        join.onRef('preview.assetId', '=', 'asset.id').on('preview.type', '=', AssetFileType.Preview),
      )
      .leftJoin('assetFile as thumb', (join) =>
        join.onRef('thumb.assetId', '=', 'asset.id').on('thumb.type', '=', AssetFileType.Thumbnail),
      )
      .select([
        'asset.id',
        'asset.type',
        'asset.status',
        'asset.originalFilename',
        'asset.capturedAt',
        'asset.createdAt',
        'asset.width',
        'asset.height',
        'asset.thumbhash',
        'asset.facesDetectedAt',
        'asset.faceCount',
        'preview.storageKey as previewKey',
        'thumb.storageKey as thumbKey',
      ])
      .where('asset.eventId', '=', eventId)
      .where('asset.deletedAt', 'is', null)
      .where('asset.status', '=', AssetStatus.Processed)
      .orderBy(sql`random()`)
      .limit(limit)
      .execute();
  }

  // --- derivatives ---

  async upsertFile(file: Insertable<AssetFileTable>): Promise<void> {
    await this.db
      .insertInto('assetFile')
      .values(file)
      .onConflict((oc) =>
        oc.columns(['assetId', 'type']).doUpdateSet({
          storageKey: file.storageKey,
          width: file.width,
          height: file.height,
          format: file.format,
          fileSize: file.fileSize,
        }),
      )
      .execute();
  }

  // People visible in one photo, for the viewer's info panel.
  getPeople(assetId: string) {
    return this.db
      .selectFrom('assetFace')
      .innerJoin('person', 'person.id', 'assetFace.personId')
      .select(['person.id', 'person.name', 'person.thumbnailKey'])
      .where('assetFace.assetId', '=', assetId)
      .where('assetFace.deletedAt', 'is', null)
      .where('person.isHidden', '=', false)
      .distinctOn('person.id')
      .execute();
  }

  // Every detected face in one photo with its box, for the viewer's overlay.
  // The label falls back to the participant who matched through this exact
  // face, so a guest who told us their name is shown by name even when nobody
  // has got round to naming the cluster.
  getFaces(assetId: string) {
    return this.db
      .selectFrom('assetFace')
      .leftJoin('person', 'person.id', 'assetFace.personId')
      .leftJoin('participantMatch', 'participantMatch.viaFaceId', 'assetFace.id')
      .leftJoin('participant', (join) =>
        join.onRef('participant.id', '=', 'participantMatch.participantId').on('participant.deletedAt', 'is', null),
      )
      .select([
        'assetFace.id',
        'assetFace.personId',
        'assetFace.boundingBoxX1',
        'assetFace.boundingBoxY1',
        'assetFace.boundingBoxX2',
        'assetFace.boundingBoxY2',
        'assetFace.imageWidth',
        'assetFace.imageHeight',
        'person.name as personName',
        'person.isHidden',
        'person.faceAssetFaceId',
        'participant.name as participantName',
      ])
      .where('assetFace.assetId', '=', assetId)
      .where('assetFace.deletedAt', 'is', null)
      .distinctOn('assetFace.id')
      // More than one participant can match the same face (two guests whose
      // selfies both fall inside maxDistance). DISTINCT ON keeps whichever row
      // sorts first, so order deliberately: prefer a participant who actually
      // gave us a name, then the closest match. Without this the label is
      // whichever row Postgres happened to return.
      .orderBy('assetFace.id')
      .orderBy(sql`(participant.name IS NOT NULL AND participant.name <> '')`, 'desc')
      .orderBy('participantMatch.distance')
      .execute();
  }

  getExif(assetId: string) {
    return this.db.selectFrom('assetExif').selectAll().where('assetId', '=', assetId).executeTakeFirst();
  }

  getFiles(assetId: string) {
    return this.db.selectFrom('assetFile').selectAll().where('assetId', '=', assetId).execute();
  }

  // Processed asset ids for an event, oldest first — the enumeration the
  // SmartSearch backfill pages through. `onlyMissing` skips assets that already
  // have a CLIP embedding so a re-run only fills the gaps.
  async getProcessedAssetIds(eventId: string, opts: { onlyMissing: boolean; limit: number; afterId?: string }) {
    let query = this.db
      .selectFrom('asset')
      .select('asset.id')
      .where('asset.eventId', '=', eventId)
      .where('asset.deletedAt', 'is', null)
      .where('asset.status', '=', AssetStatus.Processed)
      .$if(opts.onlyMissing, (qb) =>
        qb.where((eb) =>
          eb.not(
            eb.exists(
              eb.selectFrom('smartSearch').select('smartSearch.assetId').whereRef('smartSearch.assetId', '=', 'asset.id'),
            ),
          ),
        ),
      )
      .orderBy('asset.id')
      .limit(opts.limit);
    if (opts.afterId) {
      query = query.where('asset.id', '>', opts.afterId);
    }
    return query.execute();
  }

  async upsertExif(exif: Insertable<DB['assetExif']>): Promise<void> {
    await this.db
      .insertInto('assetExif')
      .values(exif)
      .onConflict((oc) => oc.column('assetId').doUpdateSet(exif))
      .execute();
  }

  // --- deletion ---

  async softDeleteMany(eventId: string, ids: string[]): Promise<Asset[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.db
      .updateTable('asset')
      .set({ deletedAt: new Date() })
      .where('eventId', '=', eventId)
      .where('id', 'in', ids)
      .where('deletedAt', 'is', null)
      .returningAll()
      .execute();
  }
}
