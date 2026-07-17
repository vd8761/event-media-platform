import { z } from 'zod';

// Env surface per docs/plan/11-deployment.md §3.
const optionalInt = z.coerce.number().int().positive().optional();
const optionalBool = z
  .string()
  .optional()
  .transform((value) => value === 'true' || value === '1');

export const EnvSchema = z.object({
  EL_HOST: z.string().optional(),
  EL_PORT: optionalInt,
  EL_ENV: z.enum(['development', 'production']).optional(),
  EL_LOG_LEVEL: z.enum(['verbose', 'debug', 'log', 'warn', 'error', 'fatal']).optional(),

  EL_WORKERS_INCLUDE: z.string().optional(),
  EL_WORKERS_EXCLUDE: z.string().optional(),
  EL_QUEUES_EXCLUDE: z.string().optional(),

  DB_HOSTNAME: z.string().optional(),
  DB_PORT: optionalInt,
  DB_USERNAME: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_DATABASE_NAME: z.string().optional(),
  DB_URL: z.string().optional(),
  DB_SKIP_MIGRATIONS: optionalBool,
  DB_VECTOR_EXTENSION: z.enum(['vectorchord', 'pgvector']).optional(),

  REDIS_HOSTNAME: z.string().optional(),
  REDIS_PORT: optionalInt,
  REDIS_DBINDEX: z.coerce.number().int().min(0).optional(),
  REDIS_USERNAME: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),

  R2_ENDPOINT: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),

  MACHINE_LEARNING_URL: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MS_CLIENT_ID: z.string().optional(),
  MS_CLIENT_SECRET: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: optionalInt,
  SMTP_USERNAME: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  EL_PUBLIC_BASE_URL: z.string().optional(),
  EL_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  EL_SESSION_TTL_DAYS: optionalInt,
  EL_STAGING_FOLDER: z.string().optional(),
  EL_CACHE_FOLDER: z.string().optional(),

  NO_COLOR: z.string().optional(),
});

export type EnvDto = z.infer<typeof EnvSchema>;
