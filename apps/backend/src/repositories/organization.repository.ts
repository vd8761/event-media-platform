import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
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
