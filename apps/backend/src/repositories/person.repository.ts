// Person (cluster) rows — event-scoped, never cross-event (Decision D10).
import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DB, Person } from 'src/schema';

export interface PersonWithCount extends Person {
  faceCount: number;
}

export interface OrgPerson extends PersonWithCount {
  eventName: string;
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
  // The asset's original object key. Preferred crop source — see
  // handlePersonThumbnail for why the preview is only a fallback.
  originalKey: string | null;
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

  // Every named/visible person across an org's live events, each carrying its
  // event so the org-wide People page can label and link. Only people with a
  // portrait and at least one photo are worth showing here — the People grid is
  // a browsing surface, not the per-event cluster-review screen.
  // How many *named* people an organisation has. Drives whether the sidebar
  // offers People at all: an unnamed cluster is a face the system found, not a
  // person anyone can look up, so a nav entry leading to a wall of anonymous
  // thumbnails is a dead end. Mirrors getAllForOrg's visibility filters so the
  // count can never disagree with what the page would actually render.
  async countNamedForOrg(orgId: string): Promise<number> {
    const row = await this.db
      .selectFrom('person')
      .innerJoin('event', 'event.id', 'person.eventId')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('person.orgId', '=', orgId)
      .where('person.isHidden', '=', false)
      .where('person.thumbnailKey', 'is not', null)
      .where('person.name', 'is not', null)
      .where('person.name', '!=', '')
      .where('event.deletedAt', 'is', null)
      .executeTakeFirst();

    return Number(row?.count ?? 0);
  }

  getAllForOrg(orgId: string): Promise<OrgPerson[]> {
    return this.db
      .selectFrom('person')
      .innerJoin('event', 'event.id', 'person.eventId')
      .selectAll('person')
      .select('event.name as eventName')
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
      .where('person.orgId', '=', orgId)
      .where('person.isHidden', '=', false)
      .where('person.thumbnailKey', 'is not', null)
      .where('event.deletedAt', 'is', null)
      .orderBy('faceCount', 'desc')
      .execute() as Promise<OrgPerson[]>;
  }

  // The person clusters that a set of faces belong to, with how many of those
  // faces landed in each. Used to work out which cluster a matched participant
  // actually is, when their faces are spread across more than one.
  async getPersonsForFaces(faceIds: string[]): Promise<{ personId: string; name: string; faces: number }[]> {
    if (faceIds.length === 0) {
      return [];
    }
    const rows = await this.db
      .selectFrom('assetFace')
      .innerJoin('person', 'person.id', 'assetFace.personId')
      .where('assetFace.id', 'in', faceIds)
      .where('assetFace.personId', 'is not', null)
      .select(['person.id as personId', 'person.name', sql<string>`count(*)`.as('faces')])
      .groupBy(['person.id', 'person.name'])
      .orderBy(sql`count(*)`, 'desc')
      .execute();

    return rows.map((row) => ({ personId: row.personId, name: row.name, faces: Number(row.faces) }));
  }

  // Every cluster that at least one guest has claimed. The backfill walks these
  // rather than all persons: naming is a no-op for a cluster nobody claimed, so
  // this keeps the sweep proportional to the guests rather than to the photos.
  async getClaimedPersonIds(): Promise<{ personId: string; eventId: string }[]> {
    return this.db
      .selectFrom('person')
      .innerJoin('assetFace', 'assetFace.personId', 'person.id')
      .innerJoin('participantMatch', 'participantMatch.viaFaceId', 'assetFace.id')
      .innerJoin('participant', 'participant.id', 'participantMatch.participantId')
      .where('participant.deletedAt', 'is', null)
      .where('participant.name', '!=', '')
      .select(['person.id as personId', 'person.eventId as eventId'])
      .groupBy(['person.id', 'person.eventId'])
      .execute();
  }

  // Apply the most recent guest claim to a cluster's name. Returns the name
  // written, or null when nothing changed.
  //
  // The reverse direction of getPersonsForFaces: that one starts from a
  // participant's matched faces and asks which cluster they are, which only
  // works if the faces were already clustered when the selfie was matched.
  // Clustering usually runs *after* matching, so that lookup found nothing and
  // was never retried — the organiser kept seeing an unnamed face. This runs
  // from the cluster side, at the moment a face joins it, so the ordering of
  // the two pipelines stops mattering.
  //
  // Last write wins between the organiser and the guest, which is why the
  // comparison is against `name_set_at` rather than "is it still unnamed".
  // Without the timestamp this would fire again on every new face joining the
  // cluster and silently undo an organiser's correction with the same stale
  // claim. Comparing the claim's own creation time to when the name was last
  // set makes "last" mean the order the two humans actually acted in, not the
  // order the jobs happened to run.
  //
  // Still one statement: the predicate and the write happen together, so a
  // rename landing at the same instant either wins outright or is overwritten
  // by a genuinely newer claim — never a torn read of the two.
  async nameFromParticipants(eventId: string, personId: string): Promise<string | null> {
    // The latest claim on this cluster: newest first, so "last to add" wins
    // between two guests as well as between a guest and the organiser.
    const latest = this.db
      .selectFrom('assetFace')
      .innerJoin('participantMatch', 'participantMatch.viaFaceId', 'assetFace.id')
      .innerJoin('participant', 'participant.id', 'participantMatch.participantId')
      .where('assetFace.personId', '=', personId)
      .where('participant.deletedAt', 'is', null)
      .where('participant.name', '!=', '')
      .orderBy('participantMatch.createdAt', 'desc')
      // A tiebreak that does not depend on row order, for claims sharing a
      // timestamp — otherwise the winner flips between runs.
      .orderBy('participant.name', 'asc')
      .limit(1);

    // Two scalar subqueries over the same rows: SQL has no way to return two
    // columns from one scalar, and splitting them keeps the whole decision
    // inside the single UPDATE.
    const latestName = latest.select('participant.name as name');
    const latestAt = latest.select('participantMatch.createdAt as at');

    const updated = await this.db
      .updateTable('person')
      .set({
        name: sql<string>`(${latestName})`,
        nameSetAt: sql<Date>`(${latestAt})`,
        nameSource: 'participant',
        updatedAt: new Date(),
      })
      .where('id', '=', personId)
      .where('eventId', '=', eventId)
      // Without this the update writes NULL into a NOT NULL column when no
      // participant has claimed the cluster yet.
      .where(sql`(${latestName})`, 'is not', null)
      // Never overwrite a newer name. A null name_set_at means nobody has named
      // this cluster (or it predates migration 0014), so any claim beats it.
      .where(sql<boolean>`person.name_set_at is null or person.name_set_at < (${latestAt})`)
      .returning('name')
      .executeTakeFirst();

    return updated?.name ?? null;
  }

  update(eventId: string, personId: string, dto: Partial<{ name: string; isHidden: boolean; thumbnailKey: string; faceAssetFaceId: string | null }>): Promise<Person> {
    // Stamping the rename is what keeps last-write-wins honest: an organiser's
    // name with no name_set_at looks older than every claim, so the next face
    // to join the cluster would quietly revert it.
    const provenance =
      dto.name === undefined ? {} : { nameSetAt: new Date(), nameSource: 'organiser' };

    return this.db
      .updateTable('person')
      .set({ ...dto, ...provenance, updatedAt: new Date() })
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
        'asset.storageKey as originalKey',
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
