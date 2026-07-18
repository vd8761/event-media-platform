// import_job / import_item state machine (docs/plan/03, docs/plan/08 §3).
// unique(event_id, provider, remote_id) on items drives incremental re-sync.
import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, Selectable, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { CloudProvider, ImportItemStatus, ImportJobStatus } from 'src/enum';
import { DB, ImportItemTable, ImportJobTable } from 'src/schema';

export type ImportJob = Selectable<ImportJobTable>;
export type ImportItem = Selectable<ImportItemTable>;

@Injectable()
export class ImportRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  // --- jobs ---

  createJob(job: Insertable<ImportJobTable>): Promise<ImportJob> {
    return this.db.insertInto('importJob').values(job).returningAll().executeTakeFirstOrThrow();
  }

  getJob(importJobId: string): Promise<ImportJob | undefined> {
    return this.db.selectFrom('importJob').selectAll().where('id', '=', importJobId).executeTakeFirst();
  }

  getJobScoped(eventId: string, importJobId: string): Promise<ImportJob | undefined> {
    return this.db
      .selectFrom('importJob')
      .selectAll()
      .where('id', '=', importJobId)
      .where('eventId', '=', eventId)
      .executeTakeFirst();
  }

  listByEvent(eventId: string): Promise<ImportJob[]> {
    return this.db
      .selectFrom('importJob')
      .selectAll()
      .where('eventId', '=', eventId)
      .orderBy('createdAt', 'desc')
      .execute();
  }

  async updateJob(
    importJobId: string,
    dto: Partial<{ status: ImportJobStatus; totalFiles: number; skippedFiles: number; error: string | null; finishedAt: Date }>,
  ): Promise<void> {
    await this.db.updateTable('importJob').set(dto).where('id', '=', importJobId).execute();
  }

  // --- items ---

  getItem(importItemId: string): Promise<ImportItem | undefined> {
    return this.db.selectFrom('importItem').selectAll().where('id', '=', importItemId).executeTakeFirst();
  }

  getExistingByRemoteIds(eventId: string, provider: CloudProvider, remoteIds: string[]): Promise<ImportItem[]> {
    if (remoteIds.length === 0) {
      return Promise.resolve([]);
    }
    return this.db
      .selectFrom('importItem')
      .selectAll()
      .where('eventId', '=', eventId)
      .where('provider', '=', provider)
      .where('remoteId', 'in', remoteIds)
      .execute();
  }

  async insertItems(items: Insertable<ImportItemTable>[]): Promise<ImportItem[]> {
    if (items.length === 0) {
      return [];
    }
    return this.db.insertInto('importItem').values(items).returningAll().execute();
  }

  // re-point an existing item at the new job (incremental re-sync)
  async repointItem(
    itemId: string,
    importJobId: string,
    dto: Partial<{ status: ImportItemStatus; remoteChecksum: string | null; remoteName: string; remoteSize: number | null; error: null }>,
  ): Promise<void> {
    await this.db
      .updateTable('importItem')
      .set({ importJobId, updatedAt: new Date(), ...dto })
      .where('id', '=', itemId)
      .execute();
  }

  async markItem(
    importItemId: string,
    dto: Partial<{ status: ImportItemStatus; assetId: string | null; error: string | null }>,
  ): Promise<void> {
    await this.db
      .updateTable('importItem')
      .set({ ...dto, updatedAt: new Date() })
      .where('id', '=', importItemId)
      .execute();
  }

  pendingItemIds(importJobId: string): Promise<{ id: string }[]> {
    return this.db
      .selectFrom('importItem')
      .select('id')
      .where('importJobId', '=', importJobId)
      .where('status', '=', ImportItemStatus.Pending)
      .execute();
  }

  failedItems(importJobId: string): Promise<{ remoteName: string; error: string | null }[]> {
    return this.db
      .selectFrom('importItem')
      .select(['remoteName', 'error'])
      .where('importJobId', '=', importJobId)
      .where('status', '=', ImportItemStatus.Failed)
      .execute();
  }

  // atomic counter bump; returns true when no pending/downloading items remain
  async bumpCounter(importJobId: string, counter: 'doneFiles' | 'skippedFiles' | 'failedFiles'): Promise<boolean> {
    const column = { doneFiles: 'done_files', skippedFiles: 'skipped_files', failedFiles: 'failed_files' }[counter];
    await sql`UPDATE import_job SET ${sql.raw(column)} = ${sql.raw(column)} + 1 WHERE id = ${importJobId}`.execute(this.db);

    const { rows } = await sql<{ remaining: number }>`
      SELECT count(*)::int AS remaining FROM import_item
      WHERE import_job_id = ${importJobId} AND status IN ('pending', 'downloading')
    `.execute(this.db);
    return rows[0].remaining === 0;
  }
}
