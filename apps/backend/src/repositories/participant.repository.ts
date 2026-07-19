// Participant + participant_match data access (docs/plan/07, docs/plan/03).
// The participant gallery reads from participant_match (Decision D6); match
// inserts are `on conflict do nothing` so rematching is idempotent.
import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { EventStatus, ParticipantStatus } from 'src/enum';
import { DB, Participant } from 'src/schema';

export interface ParticipantUpsert {
  eventId: string;
  email: string;
  name: string;
  selfieKey: string;
  galleryTokenHash: Buffer;
  galleryTokenEnc: Buffer;
}

export interface MatchInsert {
  participantId: string;
  assetId: string;
  viaFaceId: string;
  distance: number;
}

export interface MatchedAsset {
  assetId: string;
  capturedAt: Date | null;
  createdAt: Date;
  originalFilename: string;
  type: string;
  width: number | null;
  height: number | null;
  thumbhash: Buffer | null;
  previewKey: string | null;
  thumbKey: string | null;
}

export interface ParticipantListItem {
  id: string;
  email: string;
  status: ParticipantStatus;
  matchCount: number;
  notifiedFirstAt: Date | null;
  lastNotifiedAt: Date | null;
  createdAt: Date;
  lastEmailStatus: string | null;
  lastEmailAt: Date | null;
}

@Injectable()
export class ParticipantRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  getByTokenHash(tokenHash: Buffer): Promise<Participant | undefined> {
    return this.db
      .selectFrom('participant')
      .selectAll()
      .where('galleryTokenHash', '=', tokenHash)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  getById(participantId: string): Promise<Participant | undefined> {
    return this.db
      .selectFrom('participant')
      .selectAll()
      .where('id', '=', participantId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  // Re-submission upserts: new selfie replaces old, token regenerated, status
  // reset to processing; old matches are kept — rematch reconciles (docs/plan/07 §2).
  upsert(dto: ParticipantUpsert): Promise<Participant> {
    return this.db
      .insertInto('participant')
      .values({ ...dto, status: ParticipantStatus.Processing })
      .onConflict((oc) =>
        oc
          .columns(['eventId', 'email'])
          .where('deletedAt', 'is', null)
          .doUpdateSet({
            name: dto.name,
            selfieKey: dto.selfieKey,
            galleryTokenHash: dto.galleryTokenHash,
            galleryTokenEnc: dto.galleryTokenEnc,
            selfieEmbedding: null,
            status: ParticipantStatus.Processing,
            // resubmitting starts a fresh cycle: the old "waiting for a
            // result" state does not carry over to the new selfie
            awaitingResultNotice: false,
            updatedAt: new Date(),
          }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(participantId: string, dto: Partial<{
    status: ParticipantStatus;
    selfieEmbedding: string | null;
    notifiedFirstAt: Date;
    lastNotifiedAt: Date;
    galleryTokenHash: Buffer;
    galleryTokenEnc: Buffer;
    galleryOpenedAt: Date;
    awaitingResultNotice: boolean;
  }>): Promise<void> {
    await this.db
      .updateTable('participant')
      .set({ ...dto, updatedAt: new Date() })
      .where('id', '=', participantId)
      .execute();
  }

  // participants of an event that are ready to be (re)matched
  getMatchableByEvent(eventId: string): Promise<Participant[]> {
    return this.db
      .selectFrom('participant')
      .selectAll()
      .where('eventId', '=', eventId)
      .where('selfieEmbedding', 'is not', null)
      .where('deletedAt', 'is', null)
      .execute();
  }

  // safety-net sweep: pending_match participants of active events (docs/plan/05 §4)
  getPendingForSweep(): Promise<Participant[]> {
    return this.db
      .selectFrom('participant')
      .selectAll('participant')
      .innerJoin('event', 'event.id', 'participant.eventId')
      .where('participant.status', '=', ParticipantStatus.PendingMatch)
      .where('participant.selfieEmbedding', 'is not', null)
      .where('participant.deletedAt', 'is', null)
      .where('event.status', '=', EventStatus.Active)
      .where('event.deletedAt', 'is', null)
      .execute();
  }

  // --- matches ---

  async insertMatches(matches: MatchInsert[]): Promise<number> {
    if (matches.length === 0) {
      return 0;
    }
    const inserted = await this.db
      .insertInto('participantMatch')
      .values(matches)
      .onConflict((oc) => oc.columns(['participantId', 'assetId']).doNothing())
      .returning('assetId')
      .execute();
    return inserted.length;
  }

  countMatches(participantId: string, since?: Date): Promise<number> {
    let query = this.db
      .selectFrom('participantMatch')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('participantId', '=', participantId);
    if (since) {
      query = query.where('createdAt', '>', since);
    }
    return query.executeTakeFirstOrThrow().then((row) => row.count);
  }

  isMatchedAsset(participantId: string, assetId: string): Promise<boolean> {
    return this.db
      .selectFrom('participantMatch')
      .select('assetId')
      .where('participantId', '=', participantId)
      .where('assetId', '=', assetId)
      .executeTakeFirst()
      .then((row) => !!row);
  }

  getMatchedAssets(participantId: string): Promise<MatchedAsset[]> {
    return this.db
      .selectFrom('participantMatch')
      .innerJoin('asset', 'asset.id', 'participantMatch.assetId')
      .leftJoin('assetFile as preview', (join) =>
        join.onRef('preview.assetId', '=', 'asset.id').on('preview.type', '=', 'preview' as any),
      )
      .leftJoin('assetFile as thumb', (join) =>
        join.onRef('thumb.assetId', '=', 'asset.id').on('thumb.type', '=', 'thumbnail' as any),
      )
      .select([
        'asset.id as assetId',
        'asset.capturedAt',
        'asset.createdAt',
        'asset.originalFilename',
        'asset.type',
        'asset.width',
        'asset.height',
        'asset.thumbhash',
        'preview.storageKey as previewKey',
        'thumb.storageKey as thumbKey',
      ])
      .where('participantMatch.participantId', '=', participantId)
      .where('asset.deletedAt', 'is', null)
      .orderBy('asset.capturedAt', 'desc')
      .execute();
  }

  // --- org dashboard ---

  listByEvent(eventId: string): Promise<ParticipantListItem[]> {
    return this.db
      .selectFrom('participant')
      .select((eb) => [
        'participant.id',
        'participant.email',
        'participant.status',
        'participant.notifiedFirstAt',
        'participant.lastNotifiedAt',
        'participant.createdAt',
        eb
          .selectFrom('participantMatch')
          .select(sql<number>`count(*)::int`.as('count'))
          .whereRef('participantMatch.participantId', '=', 'participant.id')
          .as('matchCount'),
        eb
          .selectFrom('emailLog')
          .select('emailLog.status')
          .whereRef('emailLog.participantId', '=', 'participant.id')
          .orderBy('emailLog.createdAt', 'desc')
          .limit(1)
          .as('lastEmailStatus'),
        eb
          .selectFrom('emailLog')
          .select('emailLog.createdAt')
          .whereRef('emailLog.participantId', '=', 'participant.id')
          .orderBy('emailLog.createdAt', 'desc')
          .limit(1)
          .as('lastEmailAt'),
      ])
      .where('participant.eventId', '=', eventId)
      .where('participant.deletedAt', 'is', null)
      .orderBy('participant.createdAt', 'desc')
      .execute() as Promise<ParticipantListItem[]>;
  }

  // --- retention & erasure ---

  // participants of events that ended more than `retentionDays` ago and still
  // hold a selfie (docs/plan/07 §6)
  getExpiredSelfies(retentionDays: number): Promise<Participant[]> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    return this.db
      .selectFrom('participant')
      .selectAll('participant')
      .innerJoin('event', 'event.id', 'participant.eventId')
      .where('event.endsAt', 'is not', null)
      .where('event.endsAt', '<', cutoff)
      .where('participant.deletedAt', 'is', null)
      .where('participant.selfieKey', 'is not', null)
      .execute();
  }

  async softDeleteAndScrub(participantId: string): Promise<void> {
    await this.db
      .updateTable('participant')
      .set({ selfieEmbedding: null, selfieKey: null, deletedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', participantId)
      .execute();
  }

  // right-to-erasure: matches (FK cascade), email logs, then the row itself
  async hardDelete(participantId: string): Promise<void> {
    await this.db.deleteFrom('emailLog').where('participantId', '=', participantId).execute();
    await this.db.deleteFrom('participant').where('id', '=', participantId).execute();
  }
}
