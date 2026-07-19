// Shared test-database plumbing. The app takes a single DATABASE_URL
// (src/repositories/config.repository.ts), so the specs build one too instead
// of setting discrete DB_* vars.
import pg from 'pg';

// Points at docker/docker-compose.dev.yml by default (host port 5433).
const BASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/postgres';

export const adminConnectionOptions = (): pg.ClientConfig => ({ connectionString: BASE_URL });

// Same server, different database name.
export const testDatabaseUrl = (name: string): string => {
  const url = new URL(BASE_URL);
  url.pathname = `/${name}`;
  return url.toString();
};
