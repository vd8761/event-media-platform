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
