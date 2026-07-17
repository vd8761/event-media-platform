// M1: only the gallery-token lookup used by the AuthGuard. Selfie intake,
// matching, and the participant dashboard land in M4
// (docs/plan/07-participant-flow.md).
import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DB, Participant } from 'src/schema';

@Injectable()
export class ParticipantRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  getByTokenHash(tokenHash: Buffer): Promise<Participant | undefined> {
    return this.db
      .selectFrom('participant')
      .selectAll()
      .where('galleryTokenHash', '=', tokenHash)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }
}
