// Reads and writes for the super-admin Logs tab (migration 0012).
import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { Kysely, sql } from 'kysely';
import { AuditCategory, AuditLevel, AuditRetention } from 'src/enum';
import { AuditLog, DB, NewAuditLog } from 'src/schema';

export interface AuditQuery {
  category?: AuditCategory;
  level?: AuditLevel;
  limit: number;
  // Keyset pagination: rows strictly older than this (scrolling back).
  before?: string;
  // Live tail: rows strictly newer than this. The page polls with the newest
  // timestamp it holds, so it only ever transfers what it has not seen.
  after?: string;
}

@Injectable()
export class AuditLogRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  async create(entry: NewAuditLog): Promise<void> {
    await this.db.insertInto('auditLog').values(entry).execute();
  }

  // Newest first. `after` still sorts DESC so the caller can prepend the
  // result without re-sorting.
  async list(query: AuditQuery): Promise<AuditLog[]> {
    let builder = this.db.selectFrom('auditLog').selectAll().orderBy('createdAt', 'desc').limit(query.limit);

    if (query.category) {
      builder = builder.where('category', '=', query.category);
    }
    if (query.level) {
      builder = builder.where('level', '=', query.level);
    }
    if (query.before) {
      builder = builder.where('createdAt', '<', new Date(query.before));
    }
    if (query.after) {
      builder = builder.where('createdAt', '>', new Date(query.after));
    }

    return builder.execute();
  }

  async countByRetention(): Promise<Record<string, number>> {
    const rows = await this.db
      .selectFrom('auditLog')
      .select(['retention', ({ fn }) => fn.countAll<string>().as('count')])
      .groupBy('retention')
      .execute();

    return Object.fromEntries(rows.map((row) => [row.retention, Number(row.count)]));
  }

  // Delete everything in a class older than `cutoff`. Returns how many went,
  // so the sweep can record its own work in the log it just pruned.
  async deleteOlderThan(retention: AuditRetention, cutoff: Date): Promise<number> {
    const result = await this.db
      .deleteFrom('auditLog')
      .where('retention', '=', retention)
      .where('createdAt', '<', cutoff)
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0);
  }

  // Manual flush from the admin page. `retention` narrows it to one class;
  // omitted, it clears everything — including the never-delete rows, which is
  // the only way those are ever removed.
  async flush(retention?: AuditRetention): Promise<number> {
    let builder = this.db.deleteFrom('auditLog');
    if (retention) {
      builder = builder.where('retention', '=', retention);
    }
    const result = await builder.executeTakeFirst();
    return Number(result.numDeletedRows ?? 0);
  }

  // Cheap health signal for the page header without pulling rows.
  async getOldest(): Promise<Date | null> {
    const row = await this.db
      .selectFrom('auditLog')
      .select(({ fn }) => fn.min('createdAt').as('oldest'))
      .executeTakeFirst();

    return (row?.oldest as Date | null) ?? null;
  }

  async total(): Promise<number> {
    const row = await this.db
      .selectFrom('auditLog')
      .select(sql<string>`count(*)`.as('count'))
      .executeTakeFirst();

    return Number(row?.count ?? 0);
  }
}
