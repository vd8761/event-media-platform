// Ported from immich:server/src/repositories/search.repository.ts searchFaces
// (~line 316): `set local vchordrq.probes`, cosine `<=>` CTE, post-filter
// `distance <= maxDistance`.
//
// ★ The ONLY semantic change vs Immich: `asset.ownerId = any(:userIds)` became
// `asset.eventId = :eventId`. The scope lives INSIDE the CTE — cross-event
// matching is structurally impossible, not just filtered in application code
// (privacy invariant, docs/plan/06 §7, risk R2). Dropped: the person.birthDate
// filter (no birthdates in EventLens).
import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { VectorExtension } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DB } from 'src/schema';

// immich:server/src/utils/database.ts probes for the face index
const FACE_INDEX_PROBES = 1;

export interface FaceSearchOptions {
  eventId: string;
  embedding: string;
  numResults: number;
  maxDistance: number;
  hasPerson?: boolean;
}

export interface FaceSearchResult {
  id: string;
  personId: string | null;
  assetId: string;
  distance: number;
}

@Injectable()
export class FaceSearchRepository {
  private isVectorChord: boolean;

  constructor(
    @InjectKysely() private db: Kysely<DB>,
    configRepository: ConfigRepository,
  ) {
    this.isVectorChord = configRepository.getEnv().database.vectorExtension === VectorExtension.VectorChord;
  }

  searchFaces({ eventId, embedding, numResults, maxDistance, hasPerson }: FaceSearchOptions): Promise<FaceSearchResult[]> {
    if (!Number.isInteger(numResults) || numResults < 1 || numResults > 1000) {
      throw new Error(`Invalid value for 'numResults': ${numResults}`);
    }

    return this.db.transaction().execute(async (trx) => {
      if (this.isVectorChord) {
        await sql`set local vchordrq.probes = ${sql.lit(FACE_INDEX_PROBES)}`.execute(trx);
      }
      return await trx
        .with('cte', (qb) =>
          qb
            .selectFrom('assetFace')
            .select([
              'assetFace.id',
              'assetFace.personId',
              'assetFace.assetId',
              sql<number>`face_search.embedding <=> ${embedding}`.as('distance'),
            ])
            .innerJoin('asset', 'asset.id', 'assetFace.assetId')
            .innerJoin('faceSearch', 'faceSearch.faceId', 'assetFace.id')
            .where('asset.eventId', '=', eventId) // ★ Immich: asset.ownerId = any(:userIds)
            .where('asset.deletedAt', 'is', null)
            .where('assetFace.deletedAt', 'is', null)
            .$if(!!hasPerson, (qb) => qb.where('assetFace.personId', 'is not', null))
            .orderBy('distance')
            .limit(numResults),
        )
        .selectFrom('cte')
        .selectAll()
        .where('cte.distance', '<=', maxDistance)
        .execute();
    });
  }

  // Selfie matching (Decision D6): same CTE, no hasPerson filter — searches
  // ALL detected faces of the event, clustered or not, so guests appearing in
  // only 1-2 photos are still found (docs/plan/07 §3).
  searchFacesByEmbedding(
    eventId: string,
    embedding: string,
    options: { numResults?: number; maxDistance: number },
  ): Promise<FaceSearchResult[]> {
    return this.searchFaces({
      eventId,
      embedding,
      numResults: options.numResults ?? 200,
      maxDistance: options.maxDistance,
    });
  }
}
