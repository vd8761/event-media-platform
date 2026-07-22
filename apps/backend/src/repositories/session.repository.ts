import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DB, Session, User } from 'src/schema';

@Injectable()
export class SessionRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  create(session: { userId: string; token: Buffer; deviceOs: string; deviceType: string; expiresAt: Date | null }) {
    return this.db.insertInto('session').values(session).returningAll().executeTakeFirstOrThrow();
  }

  async getByToken(tokenHash: Buffer): Promise<(Session & { user: User }) | undefined> {
    const session = await this.db
      .selectFrom('session')
      .selectAll()
      .where('token', '=', tokenHash)
      .where((eb) => eb.or([eb('expiresAt', 'is', null), eb('expiresAt', '>', new Date())]))
      .executeTakeFirst();
    if (!session) {
      return undefined;
    }

    const user = await this.db
      .selectFrom('user')
      .selectAll()
      .where('id', '=', session.userId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!user) {
      return undefined;
    }

    return { ...session, user };
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteFrom('session').where('id', '=', id).execute();
  }

  // Every session for a user except, optionally, the one making the request.
  // Used after a password change: the point of changing a password is usually
  // that someone else may know the old one, and leaving their existing sessions
  // alive means the change does not actually lock them out.
  async deleteForUser(userId: string, exceptSessionId?: string): Promise<number> {
    let query = this.db.deleteFrom('session').where('userId', '=', userId);
    if (exceptSessionId) {
      query = query.where('id', '!=', exceptSessionId);
    }
    const result = await query.executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  async deleteExpired(): Promise<number> {
    const result = await this.db
      .deleteFrom('session')
      .where('expiresAt', 'is not', null)
      .where('expiresAt', '<', new Date())
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }
}
