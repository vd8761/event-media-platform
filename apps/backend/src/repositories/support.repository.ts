// Support tickets (migration 0010). Reads are super-admin only, so unlike the
// event-scoped repositories these queries are deliberately global.
import { Injectable } from '@nestjs/common';
import { Insertable, Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { SupportStatus } from 'src/enum';
import { DB, SupportTicketTable } from 'src/schema';

export interface SupportTicketListItem {
  id: string;
  source: string;
  status: string;
  message: string;
  name: string | null;
  email: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  orgId: string | null;
  orgName: string | null;
  eventId: string | null;
  eventName: string | null;
  userName: string | null;
  userEmail: string | null;
}

@Injectable()
export class SupportRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  create(dto: Insertable<SupportTicketTable>) {
    return this.db.insertInto('supportTicket').values(dto).returningAll().executeTakeFirstOrThrow();
  }

  // Open tickets first, newest within each — the admin inbox ordering.
  list(status?: SupportStatus): Promise<SupportTicketListItem[]> {
    let query = this.db
      .selectFrom('supportTicket')
      .leftJoin('organization', 'organization.id', 'supportTicket.orgId')
      .leftJoin('event', 'event.id', 'supportTicket.eventId')
      .leftJoin('user', 'user.id', 'supportTicket.userId')
      .select([
        'supportTicket.id',
        'supportTicket.source',
        'supportTicket.status',
        'supportTicket.message',
        'supportTicket.name',
        'supportTicket.email',
        'supportTicket.createdAt',
        'supportTicket.resolvedAt',
        'supportTicket.orgId',
        'organization.name as orgName',
        'supportTicket.eventId',
        'event.name as eventName',
        'user.name as userName',
        'user.email as userEmail',
      ]);

    if (status) {
      query = query.where('supportTicket.status', '=', status);
    }

    return query
      .orderBy('supportTicket.status', 'asc')
      .orderBy('supportTicket.createdAt', 'desc')
      .execute() as Promise<SupportTicketListItem[]>;
  }

  async setStatus(id: string, status: SupportStatus): Promise<void> {
    await this.db
      .updateTable('supportTicket')
      .set({ status, resolvedAt: status === SupportStatus.Resolved ? new Date() : null })
      .where('id', '=', id)
      .execute();
  }

  async countOpen(): Promise<number> {
    const row = await this.db
      .selectFrom('supportTicket')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('status', '=', SupportStatus.Open)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }
}
