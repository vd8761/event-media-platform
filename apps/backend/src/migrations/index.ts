// Static migration provider — migrations are hand-written Kysely files
// (docs/plan/03-database-schema.md §5), bundled with the build so the runner
// works from dist/ without filesystem discovery.
import { Migration, MigrationProvider } from 'kysely';
import * as m0001 from 'src/migrations/0001-init';
import * as m0002 from 'src/migrations/0002-participant-token';
import * as m0003 from 'src/migrations/0003-asset-face-status';
import * as m0004 from 'src/migrations/0004-sharing-and-feature-photo';
import * as m0005 from 'src/migrations/0005-participant-name-and-covers';
import * as m0006 from 'src/migrations/0006-email-delivery-status';
import * as m0007 from 'src/migrations/0007-event-expiration';
import * as m0008 from 'src/migrations/0008-event-cover';
import * as m0009 from 'src/migrations/0009-smart-search';
import * as m0010 from 'src/migrations/0010-support-ticket';
import * as m0011 from 'src/migrations/0011-multi-selfie';
import * as m0012 from 'src/migrations/0012-audit-log';
import * as m0013 from 'src/migrations/0013-organization-plan';

const migrations: Record<string, Migration> = {
  '0001-init': m0001,
  '0002-participant-token': m0002,
  '0003-asset-face-status': m0003,
  '0004-sharing-and-feature-photo': m0004,
  '0005-participant-name-and-covers': m0005,
  '0006-email-delivery-status': m0006,
  '0007-event-expiration': m0007,
  '0008-event-cover': m0008,
  '0009-smart-search': m0009,
  '0010-support-ticket': m0010,
  '0011-multi-selfie': m0011,
  '0012-audit-log': m0012,
  '0013-organization-plan': m0013,
};

export class StaticMigrationProvider implements MigrationProvider {
  getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve(migrations);
  }
}
