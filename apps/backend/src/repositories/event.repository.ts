// Repository signatures are scope-first (docs/plan/03-database-schema.md §3):
// no unscoped by-id lookups.
import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { EventStatus } from 'src/enum';
import { DB, EventRow, EventUpdate, NewEvent } from 'src/schema';

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

  // Landing page: events across every org the user belongs to; super admins
  // see all events.
  listForUser(userId: string, isSuperAdmin: boolean): Promise<(EventRow & { orgName: string })[]> {
    let query = this.db
      .selectFrom('event')
      .innerJoin('organization', 'organization.id', 'event.orgId')
      .selectAll('event')
      .select('organization.name as orgName')
      .where('event.deletedAt', 'is', null)
      .where('organization.deletedAt', 'is', null)
      .orderBy('event.createdAt', 'desc');

    if (!isSuperAdmin) {
      query = query.where('event.orgId', 'in', (eb) =>
        eb.selectFrom('organizationUser').select('orgId').where('userId', '=', userId),
      );
    }

    return query.execute();
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
