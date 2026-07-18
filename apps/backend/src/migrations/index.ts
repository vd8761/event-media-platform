// Static migration provider — migrations are hand-written Kysely files
// (docs/plan/03-database-schema.md §5), bundled with the build so the runner
// works from dist/ without filesystem discovery.
import { Migration, MigrationProvider } from 'kysely';
import * as m0001 from 'src/migrations/0001-init';
import * as m0002 from 'src/migrations/0002-participant-token';

const migrations: Record<string, Migration> = {
  '0001-init': m0001,
  '0002-participant-token': m0002,
};

export class StaticMigrationProvider implements MigrationProvider {
  getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve(migrations);
  }
}
