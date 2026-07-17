// Slim port of the migration/bootstrap behavior in immich:server/src/services/
// database.service.ts + repositories/database.repository.ts: run migrations at
// boot under a Postgres advisory lock, with a DB_SKIP_MIGRATIONS escape hatch.
import { Injectable } from '@nestjs/common';
import { Kysely, Migrator, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DatabaseLock } from 'src/enum';
import { StaticMigrationProvider } from 'src/migrations';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';

@Injectable()
export class DatabaseRepository {
  constructor(
    @InjectKysely() private db: Kysely<DB>,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(DatabaseRepository.name);
  }

  async runMigrations(): Promise<void> {
    await this.withLock(DatabaseLock.Migrations, async () => {
      const migrator = new Migrator({
        db: this.db as Kysely<unknown>,
        provider: new StaticMigrationProvider(),
      });

      const { error, results } = await migrator.migrateToLatest();
      for (const result of results ?? []) {
        if (result.status === 'Success') {
          this.logger.log(`Migration applied: ${result.migrationName}`);
        } else if (result.status === 'Error') {
          this.logger.error(`Migration failed: ${result.migrationName}`);
        }
      }
      if (error) {
        throw error instanceof Error ? error : new Error(`Migration error: ${error}`);
      }
    });
  }

  async prewarmVectorIndex(): Promise<void> {
    // VectorChord only (docs/plan/06 §4); pgvector fallback has no prewarm
    await sql`SELECT vchordrq_prewarm('face_index')`.execute(this.db).catch(() => {
      this.logger.warn('vchordrq_prewarm unavailable — skipping (pgvector fallback?)');
    });
  }

  async tryLock(lock: DatabaseLock): Promise<boolean> {
    const { rows } = await sql<{
      locked: boolean;
    }>`SELECT pg_try_advisory_lock(${lock}) as locked`.execute(this.db);
    return rows[0].locked;
  }

  private async withLock<T>(lock: DatabaseLock, callback: () => Promise<T>): Promise<T> {
    // hold one dedicated connection for the duration of the lock
    return this.db.connection().execute(async (connection) => {
      await sql`SELECT pg_advisory_lock(${lock})`.execute(connection);
      try {
        return await callback();
      } finally {
        await sql`SELECT pg_advisory_unlock(${lock})`.execute(connection);
      }
    });
  }
}
