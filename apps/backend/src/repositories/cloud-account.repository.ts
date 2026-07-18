// Per-organization Drive/OneDrive connections (docs/plan/03 `cloud_account`,
// docs/plan/08 §1). Tokens stored AES-256-GCM-encrypted; decryption happens in
// CloudService, never here.
import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { CloudProvider } from 'src/enum';
import { DB } from 'src/schema';
import { Selectable } from 'kysely';
import { CloudAccountTable } from 'src/schema';

export type CloudAccount = Selectable<CloudAccountTable>;

@Injectable()
export class CloudAccountRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  upsert(account: {
    orgId: string;
    provider: CloudProvider;
    accountEmail: string;
    refreshTokenEnc: Buffer;
    accessTokenEnc: Buffer | null;
    tokenExpiresAt: Date | null;
    scopes: string[];
    createdBy: string | null;
  }): Promise<CloudAccount> {
    return this.db
      .insertInto('cloudAccount')
      .values(account)
      .onConflict((oc) =>
        oc.columns(['orgId', 'provider', 'accountEmail']).doUpdateSet({
          refreshTokenEnc: account.refreshTokenEnc,
          accessTokenEnc: account.accessTokenEnc,
          tokenExpiresAt: account.tokenExpiresAt,
          scopes: account.scopes,
          revokedAt: null,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  getById(orgId: string, accountId: string): Promise<CloudAccount | undefined> {
    return this.db
      .selectFrom('cloudAccount')
      .selectAll()
      .where('id', '=', accountId)
      .where('orgId', '=', orgId)
      .where('revokedAt', 'is', null)
      .executeTakeFirst();
  }

  listByOrg(orgId: string): Promise<CloudAccount[]> {
    return this.db
      .selectFrom('cloudAccount')
      .selectAll()
      .where('orgId', '=', orgId)
      .where('revokedAt', 'is', null)
      .orderBy('createdAt', 'desc')
      .execute();
  }

  async updateAccessToken(accountId: string, accessTokenEnc: Buffer, tokenExpiresAt: Date): Promise<void> {
    await this.db
      .updateTable('cloudAccount')
      .set({ accessTokenEnc, tokenExpiresAt })
      .where('id', '=', accountId)
      .execute();
  }

  // refresh failure (revoked consent) → surface "reconnect" (docs/plan/08 §1)
  async markRevoked(accountId: string): Promise<void> {
    await this.db.updateTable('cloudAccount').set({ revokedAt: new Date() }).where('id', '=', accountId).execute();
  }
}
