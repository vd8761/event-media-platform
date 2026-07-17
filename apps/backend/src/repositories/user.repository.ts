import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DB, NewUser, User, UserUpdate } from 'src/schema';

@Injectable()
export class UserRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  getById(id: string): Promise<User | undefined> {
    return this.db
      .selectFrom('user')
      .selectAll()
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  getByEmail(email: string): Promise<User | undefined> {
    return this.db
      .selectFrom('user')
      .selectAll()
      .where('email', '=', email)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  create(user: NewUser): Promise<User> {
    return this.db.insertInto('user').values(user).returningAll().executeTakeFirstOrThrow();
  }

  update(id: string, dto: UserUpdate): Promise<User> {
    return this.db
      .updateTable('user')
      .set({ ...dto, updatedAt: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async hasAny(): Promise<boolean> {
    const row = await this.db.selectFrom('user').select('id').limit(1).executeTakeFirst();
    return !!row;
  }
}
