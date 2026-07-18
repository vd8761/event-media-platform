// Ported from immich:server/src/repositories/person.repository.ts (the face
// half): refreshFaces CTE (insert asset_face + face_search + delete in one
// statement), reassignFaces, getRandomFace. Tenancy: ownerId → eventId — every
// event-facing method takes eventId (docs/plan/06 §7 audit rule).
import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { FaceSourceType } from 'src/enum';
import { AssetFace, DB } from 'src/schema';
import { AssetFaceTable, FaceSearchTable } from 'src/schema';

const dummy = sql`(select 1)`.as('dummy');

export interface FaceForRecognition {
  id: string;
  personId: string | null;
  sourceType: FaceSourceType;
  assetId: string;
  eventId: string;
  orgId: string;
  embedding: string | null;
}

@Injectable()
export class FaceRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  getByAssetId(assetId: string): Promise<AssetFace[]> {
    return this.db
      .selectFrom('assetFace')
      .selectAll()
      .where('assetId', '=', assetId)
      .where('deletedAt', 'is', null)
      .execute();
  }

  // Single CTE-chained statement so face rows and their embeddings appear
  // atomically (immich person.repository refreshFaces ~line 410).
  async refreshFaces(
    facesToAdd: (Insertable<AssetFaceTable> & { id: string })[],
    faceIdsToRemove: string[],
    embeddingsToAdd: Insertable<FaceSearchTable>[],
  ): Promise<void> {
    let query = this.db as any;
    if (facesToAdd.length > 0) {
      query = query.with('added', (db: any) => db.insertInto('assetFace').values(facesToAdd));
    }

    if (faceIdsToRemove.length > 0) {
      query = query.with('removed', (db: any) =>
        db.deleteFrom('assetFace').where('assetFace.id', '=', (eb: any) => eb.fn.any(eb.val(faceIdsToRemove))),
      );
    }

    if (embeddingsToAdd.length > 0) {
      query = query.with('added_embeddings', (db: any) => db.insertInto('faceSearch').values(embeddingsToAdd));
    }

    await query.selectFrom(dummy).selectAll().execute();
  }

  async reassignFaces({ faceIds, newPersonId }: { faceIds: string[]; newPersonId: string }): Promise<number> {
    const result = await this.db
      .updateTable('assetFace')
      .set({ personId: newPersonId })
      .where('assetFace.id', 'in', faceIds)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  }

  async getForRecognition(faceId: string): Promise<FaceForRecognition | undefined> {
    return this.db
      .selectFrom('assetFace')
      .innerJoin('asset', 'asset.id', 'assetFace.assetId')
      .leftJoin('faceSearch', 'faceSearch.faceId', 'assetFace.id')
      .select([
        'assetFace.id',
        'assetFace.personId',
        'assetFace.sourceType',
        'asset.id as assetId',
        'asset.eventId',
        'asset.orgId',
        'faceSearch.embedding',
      ])
      .where('assetFace.id', '=', faceId)
      .where('assetFace.deletedAt', 'is', null)
      .where('asset.deletedAt', 'is', null)
      .executeTakeFirst();
  }

  getRandomFace(personId: string): Promise<AssetFace | undefined> {
    return this.db
      .selectFrom('assetFace')
      .selectAll()
      .where('personId', '=', personId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  // Paged (not streamed) unassigned-face walk for FaceRecognizeQueueAll.
  getUnassignedFaceIds(eventId: string, limit: number, afterId?: string): Promise<{ id: string }[]> {
    let query = this.db
      .selectFrom('assetFace')
      .innerJoin('asset', 'asset.id', 'assetFace.assetId')
      .select('assetFace.id')
      .where('asset.eventId', '=', eventId)
      .where('asset.deletedAt', 'is', null)
      .where('assetFace.deletedAt', 'is', null)
      .where('assetFace.personId', 'is', null)
      .where('assetFace.sourceType', '=', FaceSourceType.MachineLearning)
      .orderBy('assetFace.id')
      .limit(limit);
    if (afterId) {
      query = query.where('assetFace.id', '>', afterId);
    }
    return query.execute();
  }

  // force re-run: detach every ML face of the event before re-clustering
  async unassignByEvent(eventId: string): Promise<void> {
    await this.db
      .updateTable('assetFace')
      .set({ personId: null })
      .where('sourceType', '=', FaceSourceType.MachineLearning)
      .where('assetId', 'in', (eb) =>
        eb.selectFrom('asset').select('id').where('eventId', '=', eventId).where('deletedAt', 'is', null),
      )
      .execute();
  }
}
