// Scope-first repository (docs/plan/03-database-schema.md §3): every lookup
// takes eventId. Dedupe is the (event_id, checksum) unique index; the ported
// constraint-detection helper answers unique-violations with 'duplicate'.
import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
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

  // Cursor pagination on (capturedAt desc, id) — stable ordering (docs/plan/09 §3).
  async list(
    eventId: string,
    opts: { limit: number; cursorCapturedAt?: Date | null; cursorId?: string },
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
        'preview.storageKey as previewKey',
        'thumb.storageKey as thumbKey',
      ])
      .where('asset.eventId', '=', eventId)
      .where('asset.deletedAt', 'is', null)
      .orderBy('asset.capturedAt', 'desc')
      .orderBy('asset.id', 'desc')
      .limit(opts.limit);

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
