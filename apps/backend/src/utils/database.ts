// Ported from immich:server/src/utils/database.ts — Kysely config, vector
// helpers, vectorIndexQuery (VectorChord + pgvector-HNSW fallback, docs/plan/
// 03-database-schema.md §4), and checksum-constraint detection. EventLens uses
// the pg driver + CamelCasePlugin (DB columns are snake_case per docs/plan/03).
import { CamelCasePlugin, Expression, KyselyConfig, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { VectorExtension } from 'src/enum';
import type { DatabaseConnectionParams } from 'src/repositories/config.repository';

// int8 (bigint) → number: file sizes fit comfortably in 2^53
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number.parseInt(value, 10));

export const getKyselyConfig = (connection: DatabaseConnectionParams): KyselyConfig => {
  return {
    dialect: new PostgresDialect({
      pool: new pg.Pool({
        connectionString: connection.url,
        ssl: connection.ssl,
        // The media worker runs several queues at once and every job is mostly
        // database round trips, so 10 connections were shared between 13
        // concurrent jobs — work queued on the pool before it could reach the
        // GPU. Tunable because the right number depends on the deployment:
        // an API host serving requests wants fewer than a worker box does.
        max: Number(process.env.DB_POOL_MAX) || 20,
      }),
    }),
    plugins: [new CamelCasePlugin()],
    log(event) {
      if (event.level === 'error' && !isAssetChecksumConstraint(event.error)) {
        console.error('Query failed :', {
          durationMs: event.queryDurationMillis,
          error: event.error,
          sql: event.query.sql,
        });
      }
    },
  };
};

export const asUuid = (id: string | Expression<string>) => sql<string>`${id}::uuid`;

export const anyUuid = (ids: string[]) => sql<string>`any(${`{${ids}}`}::uuid[])`;

export const asVector = (embedding: number[] | string) =>
  sql<string>`${typeof embedding === 'string' ? embedding : `[${embedding}]`}::vector`;

// The (event_id, checksum) dedupe constraint (docs/plan/04-storage-r2.md §3).
export const ASSET_CHECKSUM_CONSTRAINT = 'asset_event_checksum';

export const isAssetChecksumConstraint = (error: unknown): boolean => {
  const maybe = error as { code?: string; constraint?: string } | undefined;
  return maybe?.code === '23505' && maybe?.constraint === ASSET_CHECKSUM_CONSTRAINT;
};

type VectorIndexQueryOptions = { table: string; indexName: string; vectorExtension: VectorExtension; lists?: number };

export function vectorIndexQuery({ vectorExtension, table, indexName, lists }: VectorIndexQueryOptions): string {
  switch (vectorExtension) {
    case VectorExtension.VectorChord: {
      return `
        CREATE INDEX IF NOT EXISTS ${indexName} ON ${table} USING vchordrq (embedding vector_cosine_ops) WITH (options = $$
        residual_quantization = false
        [build.internal]
        lists = [${lists ?? 1}]
        spherical_centroids = true
        build_threads = 4
        sampling_factor = 1024
        $$)`;
    }
    case VectorExtension.PgVector: {
      return `
        CREATE INDEX IF NOT EXISTS ${indexName} ON ${table}
        USING hnsw (embedding vector_cosine_ops)
        WITH (ef_construction = 300, m = 16)`;
    }
    default: {
      throw new Error(`Unsupported vector extension: '${vectorExtension}'`);
    }
  }
}
