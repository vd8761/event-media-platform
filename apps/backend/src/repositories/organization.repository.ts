import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { OrgPlan, OrgRole, OrgStatus } from 'src/enum';
import { DB, NewOrganization, Organization, OrganizationUser } from 'src/schema';

export interface OrgMember {
  userId: string;
  email: string;
  name: string;
  role: OrgRole;
  createdAt: Date;
}

@Injectable()
export class OrganizationRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  create(org: NewOrganization): Promise<Organization> {
    return this.db.insertInto('organization').values(org).returningAll().executeTakeFirstOrThrow();
  }

  getById(id: string): Promise<Organization | undefined> {
    return this.db
      .selectFrom('organization')
      .selectAll()
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  getBySlug(slug: string): Promise<Organization | undefined> {
    return this.db
      .selectFrom('organization')
      .selectAll()
      .where('slug', '=', slug)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  list(): Promise<Organization[]> {
    return this.db
      .selectFrom('organization')
      .selectAll()
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'desc')
      .execute();
  }

  // Backs the super-admin organizations table: each org with its account
  // holder and its current consumption.
  //
  // One query rather than a per-org fan-out. The obvious implementation —
  // list(), then a quota lookup per row — is three round trips per
  // organization, which is fine at ten orgs and a page-load stall at two
  // hundred. The aggregates are correlated subqueries so an org with no owner
  // or no events still returns a row.
  listWithUsage(): Promise<
    (Organization & {
      ownerId: string | null;
      ownerEmail: string | null;
      ownerName: string | null;
      usedBytes: number;
      usedEvents: number;
    })[]
  > {
    return this.db
      .selectFrom('organization')
      .selectAll('organization')
      // The owner is the account holder shown in the table. An org can in
      // principle have several owners; the earliest-joined one is the account
      // holder in every practical sense, and picking deterministically keeps
      // the row stable between loads.
      .leftJoin(
        (eb) =>
          eb
            .selectFrom('organizationUser')
            .innerJoin('user', 'user.id', 'organizationUser.userId')
            .select([
              'organizationUser.orgId as ouOrgId',
              'user.id as ownerId',
              'user.email as ownerEmail',
              'user.name as ownerName',
            ])
            .distinctOn('organizationUser.orgId')
            .where('organizationUser.role', '=', OrgRole.Owner)
            .where('user.deletedAt', 'is', null)
            .orderBy('organizationUser.orgId')
            .orderBy('organizationUser.createdAt', 'asc')
            .as('owner'),
        (join) => join.onRef('owner.ouOrgId', '=', 'organization.id'),
      )
      .select((eb) => [
        eb
          .selectFrom('asset')
          .innerJoin('event', 'event.id', 'asset.eventId')
          .whereRef('event.orgId', '=', 'organization.id')
          .where('asset.deletedAt', 'is', null)
          // Same rule as getOrgStorageBytes. The admin table has to show the
          // organisation the same number the organisation sees, or a support
          // conversation starts with the two sides reading different figures.
          .where('event.deletedAt', 'is', null)
          .select(sql<string>`coalesce(sum(asset.file_size), 0)`.as('bytes'))
          .as('usedBytes'),
        eb
          .selectFrom('event')
          .whereRef('event.orgId', '=', 'organization.id')
          .where('event.deletedAt', 'is', null)
          .select(sql<string>`count(*)`.as('count'))
          .as('usedEvents'),
      ])
      .where('organization.deletedAt', 'is', null)
      .orderBy('organization.createdAt', 'desc')
      .execute()
      .then((rows) =>
        rows.map((row) => ({
          ...row,
          // Postgres returns bigint as a string; Number() here keeps the
          // conversion in one place rather than at every call site.
          usedBytes: Number(row.usedBytes ?? 0),
          usedEvents: Number(row.usedEvents ?? 0),
        })),
      ) as ReturnType<OrganizationRepository['listWithUsage']>;
  }

  listForUser(userId: string): Promise<(Organization & { role: OrgRole })[]> {
    return this.db
      .selectFrom('organization')
      .innerJoin('organizationUser', 'organizationUser.orgId', 'organization.id')
      .selectAll('organization')
      .select('organizationUser.role')
      .where('organizationUser.userId', '=', userId)
      .where('organization.deletedAt', 'is', null)
      .where('organization.status', '=', OrgStatus.Active)
      .orderBy('organization.createdAt', 'desc')
      .execute();
  }

  update(
    id: string,
    dto: Partial<{
      name: string;
      slug: string;
      status: OrgStatus;
      plan: OrgPlan;
      storageLimitBytes: number | null;
      eventLimit: number | null;
    }>,
  ): Promise<Organization> {
    return this.db
      .updateTable('organization')
      .set({ ...dto, updatedAt: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .updateTable('organization')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', id)
      .execute();
  }

  // --- membership ---

  getMembership(orgId: string, userId: string): Promise<OrganizationUser | undefined> {
    return this.db
      .selectFrom('organizationUser')
      .selectAll()
      .where('orgId', '=', orgId)
      .where('userId', '=', userId)
      .executeTakeFirst();
  }

  async addMember(orgId: string, userId: string, role: OrgRole): Promise<void> {
    await this.db
      .insertInto('organizationUser')
      .values({ orgId, userId, role })
      .onConflict((oc) => oc.columns(['orgId', 'userId']).doUpdateSet({ role }))
      .execute();
  }

  listMembers(orgId: string): Promise<OrgMember[]> {
    return this.db
      .selectFrom('organizationUser')
      .innerJoin('user', 'user.id', 'organizationUser.userId')
      .select([
        'organizationUser.userId',
        'user.email',
        'user.name',
        'organizationUser.role',
        'organizationUser.createdAt',
      ])
      .where('organizationUser.orgId', '=', orgId)
      .where('user.deletedAt', 'is', null)
      .orderBy('organizationUser.createdAt', 'asc')
      .execute();
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    await this.db
      .deleteFrom('organizationUser')
      .where('orgId', '=', orgId)
      .where('userId', '=', userId)
      .execute();
  }
}
