import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { EmailStatus, EmailTemplate } from 'src/enum';
import { DB } from 'src/schema';

@Injectable()
export class EmailLogRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  async create(log: {
    eventId: string | null;
    participantId: string | null;
    toEmail: string;
    template: EmailTemplate;
    subject: string;
  }): Promise<string> {
    const row = await this.db.insertInto('emailLog').values(log).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }

  async markSent(id: string, messageId: string): Promise<void> {
    await this.db
      .updateTable('emailLog')
      .set({ status: EmailStatus.Sent, messageId, sentAt: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.db
      .updateTable('emailLog')
      .set({ status: EmailStatus.Failed, error: error.slice(0, 1000) })
      .where('id', '=', id)
      .execute();
  }
}
