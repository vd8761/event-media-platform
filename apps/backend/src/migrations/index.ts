// Static migration provider — migrations are hand-written Kysely files
// (docs/plan/03-database-schema.md §5), bundled with the build so the runner
// works from dist/ without filesystem discovery.
import { Migration, MigrationProvider } from 'kysely';
import * as m0001 from 'src/migrations/0001-init';

const migrations: Record<string, Migration> = {
  '0001-init': m0001,
};

export class StaticMigrationProvider implements MigrationProvider {
  getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve(migrations);
  }
}
