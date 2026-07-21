// Repository signatures are scope-first (docs/plan/03-database-schema.md §3):
// no unscoped by-id lookups.
import { Injectable } from '@nestjs/common';
import { Kysely, sql, Updateable } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { AssetFileType, EventStatus } from 'src/enum';
import { DB, EventRow, EventTable, EventUpdate, NewEvent } from 'src/schema';

@Injectable()
export class EventRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  create(event: NewEvent): Promise<EventRow> {
    return this.db.insertInto('event').values(event).returningAll().executeTakeFirstOrThrow();
  }

  getById(id: string): Promise<EventRow | undefined> {
    return this.db
      .selectFrom('event')
      .selectAll()
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  // Auth-scope resolution only (AuthGuard org-role checks) — everything else
  // goes through scoped lookups.
  async getOrgId(eventId: string): Promise<string | undefined> {
    const row = await this.db
      .selectFrom('event')
      .select('orgId')
      .where('id', '=', eventId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return row?.orgId;
  }

  getBySlug(slug: string): Promise<EventRow | undefined> {
    return this.db
      .selectFrom('event')
      .selectAll()
      .where('slug', '=', slug)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  // Landing page: events across every org the user belongs to. Membership is
  // the only thing that grants event visibility — a super admin with no
  // memberships correctly sees nothing here (docs/plan/09-api-surface.md §1).
  listForUser(userId: string): Promise<(EventRow & { orgName: string })[]> {
    return this.db
      .selectFrom('event')
      .innerJoin('organization', 'organization.id', 'event.orgId')
      .selectAll('event')
      .select('organization.name as orgName')
      .where('event.deletedAt', 'is', null)
      .where('organization.deletedAt', 'is', null)
      .where('event.orgId', 'in', (eb) =>
        eb.selectFrom('organizationUser').select('orgId').where('userId', '=', userId),
      )
      .orderBy('event.createdAt', 'desc')
      .execute();
  }

  // --- expiration (docs: migration 0007) ---

  // Live events whose expiry has passed and whose owner has not been told yet.
  // Ordered oldest-first so a backlog drains deterministically.
  findNewlyExpired(now: Date, limit = 100): Promise<EventRow[]> {
    return this.db
      .selectFrom('event')
      .selectAll()
      .where('expiresAt', 'is not', null)
      .where('expiresAt', '<=', now)
      .where('expiryNotifiedAt', 'is', null)
      .where('deletedAt', 'is', null)
      .orderBy('expiresAt', 'asc')
      .limit(limit)
      .execute();
  }

  // Past the grace period and still holding media.
  findDueForPurge(now: Date, limit = 100): Promise<EventRow[]> {
    return this.db
      .selectFrom('event')
      .selectAll()
      .where('purgeAfter', 'is not', null)
      .where('purgeAfter', '<=', now)
      .where('purgedAt', 'is', null)
      .where('deletedAt', 'is', null)
      // An organizer who pushed the date out must not be purged behind their
      // back — the sweep re-checks rather than trusting purgeAfter alone.
      .where((eb) => eb.or([eb('expiresAt', 'is', null), eb('expiresAt', '<=', now)]))
      .orderBy('purgeAfter', 'asc')
      .limit(limit)
      .execute();
  }

  // Updateable<> rather than the raw table type: the timestamp columns are
  // ColumnType wrappers, and only the update side of them accepts a Date.
  setExpiryState(
    id: string,
    values: Pick<
      Updateable<EventTable>,
      'expiresAt' | 'expiryNotifiedAt' | 'expiryAcknowledgedAt' | 'purgeAfter' | 'purgedAt'
    >,
  ): Promise<EventRow> {
    return this.db
      .updateTable('event')
      .set(values)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // Sidebar list: events plus whatever thumbnail their cover resolves to, and
  // a photo count. Falls back to the newest photo in the event when no cover
  // has been chosen, so the sidebar is never a column of blank tiles.
  listForSidebar(orgId: string) {
    return this.db
      .selectFrom('event')
      .leftJoin('assetFile as cover', (join) =>
        join.onRef('cover.assetId', '=', 'event.coverAssetId').on('cover.type', '=', AssetFileType.Thumbnail),
      )
      .select((eb) => [
        'event.id',
        'event.name',
        'event.slug',
        'event.status',
        'event.startsAt',
        'event.expiresAt',
        'event.purgedAt',
        'cover.storageKey as coverKey',
        eb
          .selectFrom('asset')
          .whereRef('asset.eventId', '=', 'event.id')
          .where('asset.deletedAt', 'is', null)
          .select(sql<number>`count(*)::int`.as('value'))
          .as('assetCount'),
        // Fallback cover: newest processed photo in the event.
        eb
          .selectFrom('assetFile')
          .innerJoin('asset', 'asset.id', 'assetFile.assetId')
          .whereRef('asset.eventId', '=', 'event.id')
          .where('asset.deletedAt', 'is', null)
          .where('assetFile.type', '=', AssetFileType.Thumbnail)
          .select('assetFile.storageKey')
          .orderBy('asset.capturedAt', 'desc')
          .limit(1)
          .as('fallbackCoverKey'),
      ])
      .where('event.orgId', '=', orgId)
      .where('event.deletedAt', 'is', null)
      .orderBy('event.startsAt', 'desc')
      .orderBy('event.createdAt', 'desc')
      .execute();
  }

  setCover(orgId: string, eventId: string, coverAssetId: string | null): Promise<EventRow> {
    return this.db
      .updateTable('event')
      .set({ coverAssetId })
      .where('id', '=', eventId)
      .where('orgId', '=', orgId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  listByOrg(orgId: string): Promise<EventRow[]> {
    return this.db
      .selectFrom('event')
      .selectAll()
      .where('orgId', '=', orgId)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'desc')
      .execute();
  }

  update(orgId: string, id: string, dto: EventUpdate): Promise<EventRow> {
    return this.db
      .updateTable('event')
      .set({ ...dto, updatedAt: new Date() })
      .where('id', '=', id)
      .where('orgId', '=', orgId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async softDelete(orgId: string, id: string): Promise<void> {
    await this.db
      .updateTable('event')
      .set({ deletedAt: new Date(), status: EventStatus.Closed, updatedAt: new Date() })
      .where('id', '=', id)
      .where('orgId', '=', orgId)
      .execute();
  }
}
