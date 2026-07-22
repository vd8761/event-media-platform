// Storage for single-use password reset tokens.
//
// Every lookup is by hash — the raw token is never written down, so a database
// dump yields no usable reset links. Redemption is a conditional UPDATE rather
// than a read-then-write so two clicks on the same emailed link cannot both
// win: the second one updates zero rows and is rejected.
import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DB, PasswordResetTokenTable } from 'src/schema';
import { Selectable } from 'kysely';

export type PasswordResetToken = Selectable<PasswordResetTokenTable>;

@Injectable()
export class PasswordResetRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  create(row: { userId: string; token: Buffer; expiresAt: Date; createdBy: string | null }) {
    return this.db.insertInto('passwordResetToken').values(row).returningAll().executeTakeFirstOrThrow();
  }

  // Marks the token used and returns it, but only if it was still unused and
  // unexpired at that moment. A null return means "not valid" — expired,
  // already redeemed, or never existed — and the caller must not distinguish
  // between those for the person holding the link.
  async redeem(tokenHash: Buffer): Promise<PasswordResetToken | undefined> {
    return this.db
      .updateTable('passwordResetToken')
      .set({ usedAt: new Date() })
      .where('token', '=', tokenHash)
      .where('usedAt', 'is', null)
      .where('expiresAt', '>', new Date())
      .returningAll()
      .executeTakeFirst();
  }

  // Called when a new token is issued for a user: an older outstanding link
  // must stop working, otherwise two live reset paths exist at once.
  async invalidateForUser(userId: string): Promise<void> {
    await this.db
      .updateTable('passwordResetToken')
      .set({ usedAt: new Date() })
      .where('userId', '=', userId)
      .where('usedAt', 'is', null)
      .execute();
  }

  async deleteExpired(): Promise<number> {
    const result = await this.db
      .deleteFrom('passwordResetToken')
      .where('expiresAt', '<', new Date())
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }
}
