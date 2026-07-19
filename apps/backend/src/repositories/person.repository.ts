// Person (cluster) rows — event-scoped, never cross-event (Decision D10).
import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DB, Person } from 'src/schema';

export interface PersonWithCount extends Person {
  faceCount: number;
}

export interface PersonThumbnailData {
  personId: string;
  eventId: string;
  orgId: string;
  thumbnailKey: string;
  boundingBoxX1: number;
  boundingBoxY1: number;
  boundingBoxX2: number;
  boundingBoxY2: number;
  imageWidth: number;
  imageHeight: number;
  assetId: string;
}

@Injectable()
export class PersonRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  create(person: { eventId: string; orgId: string; faceAssetFaceId: string }): Promise<Person> {
    return this.db.insertInto('person').values(person).returningAll().executeTakeFirstOrThrow();
  }

  getById(eventId: string, personId: string): Promise<Person | undefined> {
    return this.db
      .selectFrom('person')
      .selectAll()
      .where('id', '=', personId)
      .where('eventId', '=', eventId)
      .executeTakeFirst();
  }

  getAllForEvent(eventId: string, includeHidden = false): Promise<PersonWithCount[]> {
    return this.db
      .selectFrom('person')
      .selectAll('person')
      // Distinct photos, not faces: after a merge one photo can hold several
      // of a person's faces, and the UI labels this number "photos".
      .select((eb) =>
        eb
          .selectFrom('assetFace')
          .innerJoin('asset', 'asset.id', 'assetFace.assetId')
          .select(sql<number>`count(DISTINCT asset.id)::int`.as('count'))
          .whereRef('assetFace.personId', '=', 'person.id')
          .where('assetFace.deletedAt', 'is', null)
          .where('asset.deletedAt', 'is', null)
          .as('faceCount'),
      )
      .where('eventId', '=', eventId)
      .$if(!includeHidden, (qb) => qb.where('isHidden', '=', false))
      .orderBy('faceCount', 'desc')
      .execute() as Promise<PersonWithCount[]>;
  }

  update(eventId: string, personId: string, dto: Partial<{ name: string; isHidden: boolean; thumbnailKey: string; faceAssetFaceId: string | null }>): Promise<Person> {
    return this.db
      .updateTable('person')
      .set({ ...dto, updatedAt: new Date() })
      .where('id', '=', personId)
      .where('eventId', '=', eventId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async setThumbnailKey(personId: string, thumbnailKey: string): Promise<void> {
    await this.db
      .updateTable('person')
      .set({ thumbnailKey, updatedAt: new Date() })
      .where('id', '=', personId)
      .execute();
  }

  // Cover-face data for PersonThumbnail (immich getDataForThumbnailGenerationJob).
  async getThumbnailData(personId: string): Promise<PersonThumbnailData | undefined> {
    return this.db
      .selectFrom('person')
      .innerJoin('assetFace', 'assetFace.id', 'person.faceAssetFaceId')
      .innerJoin('asset', 'asset.id', 'assetFace.assetId')
      .select([
        'person.id as personId',
        'person.eventId',
        'person.orgId',
        'person.thumbnailKey',
        'assetFace.boundingBoxX1',
        'assetFace.boundingBoxY1',
        'assetFace.boundingBoxX2',
        'assetFace.boundingBoxY2',
        'assetFace.imageWidth',
        'assetFace.imageHeight',
        'asset.id as assetId',
      ])
      .where('person.id', '=', personId)
      .where('asset.deletedAt', 'is', null)
      .executeTakeFirst();
  }

  getAllWithoutFaces(): Promise<Person[]> {
    return this.db
      .selectFrom('person')
      .selectAll('person')
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('assetFace')
              .select('assetFace.id')
              .whereRef('assetFace.personId', '=', 'person.id')
              .where('assetFace.deletedAt', 'is', null),
          ),
        ),
      )
      .execute();
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.db.deleteFrom('person').where('id', 'in', ids).execute();
  }

  getFaceOfPerson(personId: string, faceId: string) {
    return this.db
      .selectFrom('assetFace')
      .select('id')
      .where('id', '=', faceId)
      .where('personId', '=', personId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  // Move every face of `sourceIds` onto `targetId` in one statement — the
  // merge path (Immich PersonService.mergePerson). Returns rows moved.
  async reassignFacesOfPeople(targetId: string, sourceIds: string[]): Promise<number> {
    if (sourceIds.length === 0) {
      return 0;
    }
    const result = await this.db
      .updateTable('assetFace')
      .set({ personId: targetId })
      .where('personId', 'in', sourceIds)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  }

  // Photos of one person, for the People detail page.
  getAssetIdsOfPerson(eventId: string, personId: string): Promise<{ assetId: string }[]> {
    return this.db
      .selectFrom('assetFace')
      .innerJoin('asset', 'asset.id', 'assetFace.assetId')
      .select('assetFace.assetId')
      .distinct()
      .where('assetFace.personId', '=', personId)
      .where('assetFace.deletedAt', 'is', null)
      .where('asset.eventId', '=', eventId)
      .where('asset.deletedAt', 'is', null)
      .execute();
  }
}
