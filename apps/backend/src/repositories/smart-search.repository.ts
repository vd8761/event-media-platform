// Smart-search (CLIP) vector store — the "view similar photos" backend,
// ported from immich:server/src/repositories/search.repository.ts
// searchSmart, with the same event-scoping invariant as FaceSearchRepository:
// the CTE filters on asset.eventId, so a similar-photo query can never reach
// across events (privacy invariant, docs/plan/06 §7).
import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { VectorExtension } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DB } from 'src/schema';

const CLIP_INDEX_PROBES = 1;

export interface SimilarSearchResult {
  assetId: string;
  distance: number;
}

@Injectable()
export class SmartSearchRepository {
  private isVectorChord: boolean;

  constructor(
    @InjectKysely() private db: Kysely<DB>,
    configRepository: ConfigRepository,
  ) {
    this.isVectorChord = configRepository.getEnv().database.vectorExtension === VectorExtension.VectorChord;
  }

  async upsert(assetId: string, embedding: string): Promise<void> {
    await this.db
      .insertInto('smartSearch')
      .values({ assetId, embedding: sql`${embedding}` as never })
      .onConflict((oc) => oc.column('assetId').doUpdateSet({ embedding: sql`${embedding}` as never }))
      .execute();
  }

  async getEmbedding(assetId: string): Promise<string | undefined> {
    const row = await this.db
      .selectFrom('smartSearch')
      .select('embedding')
      .where('assetId', '=', assetId)
      .executeTakeFirst();
    return row?.embedding;
  }

  // Nearest neighbours to `embedding` within one event, newest index probe
  // settings matching the face search. The source asset is excluded so it
  // never lists itself as "similar".
  searchSimilar(options: {
    eventId: string;
    embedding: string;
    excludeAssetId: string;
    numResults: number;
  }): Promise<SimilarSearchResult[]> {
    const { eventId, embedding, excludeAssetId, numResults } = options;
    if (!Number.isInteger(numResults) || numResults < 1 || numResults > 1000) {
      throw new Error(`Invalid value for 'numResults': ${numResults}`);
    }

    return this.db.transaction().execute(async (trx) => {
      if (this.isVectorChord) {
        await sql`set local vchordrq.probes = ${sql.lit(CLIP_INDEX_PROBES)}`.execute(trx);
      }
      return await trx
        .selectFrom('smartSearch')
        .innerJoin('asset', 'asset.id', 'smartSearch.assetId')
        .select(['smartSearch.assetId as assetId', sql<number>`smart_search.embedding <=> ${embedding}`.as('distance')])
        .where('asset.eventId', '=', eventId) // ★ event-scoped, like FaceSearchRepository
        .where('asset.deletedAt', 'is', null)
        .where('smartSearch.assetId', '!=', excludeAssetId)
        .orderBy('distance')
        .limit(numResults)
        .execute();
    });
  }
}
