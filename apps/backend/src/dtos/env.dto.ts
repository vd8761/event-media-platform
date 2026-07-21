import { z } from 'zod';

// Env surface per docs/plan/11-deployment.md §3.
const optionalInt = z.coerce.number().int().positive().optional();
const optionalBool = z
  .string()
  .optional()
  .transform((value) => value === 'true' || value === '1');

// Tri-state: undefined means "unset", so the caller can apply its own default
// rather than being forced into `false`.
const optionalTristateBool = z
  .string()
  .optional()
  .transform((value) => (value === undefined ? undefined : value === 'true' || value === '1'));

export const EnvSchema = z.object({
  EL_HOST: z.string().optional(),
  EL_PORT: optionalInt,
  // Most PaaS hosts (Render, Railway, Fly…) inject the port they expect the
  // service to listen on as PORT. Honoured when EL_PORT is unset so the app
  // binds correctly without per-platform configuration.
  PORT: optionalInt,
  EL_ENV: z.enum(['development', 'production']).optional(),
  EL_LOG_LEVEL: z.enum(['verbose', 'debug', 'log', 'warn', 'error', 'fatal']).optional(),

  EL_WORKERS_INCLUDE: z.string().optional(),
  EL_WORKERS_EXCLUDE: z.string().optional(),
  EL_QUEUES_EXCLUDE: z.string().optional(),
  // Opt a deployment into queues outside its role — e.g. running `selfie` on
  // the API host so participant intake does not wait on the GPU box.
  EL_QUEUES_INCLUDE: z.string().optional(),

  // Single connection string for every environment — local compose, Neon,
  // or any other managed Postgres. `?sslmode=require` is honoured, and Neon
  // hostnames enable TLS automatically (see config.repository.ts).
  DATABASE_URL: z.string().optional(),
  DB_SKIP_MIGRATIONS: optionalBool,
  DB_VECTOR_EXTENSION: z.enum(['vectorchord', 'pgvector']).optional(),

  // Single connection string; `rediss://` enables TLS (Upstash and friends).
  // The discrete REDIS_* vars below remain supported for the local compose.
  REDIS_URL: z.string().optional(),
  REDIS_HOSTNAME: z.string().optional(),
  REDIS_PORT: optionalInt,
  REDIS_DBINDEX: z.coerce.number().int().min(0).optional(),
  REDIS_USERNAME: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_TLS: optionalBool,

  R2_ENDPOINT: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),

  MACHINE_LEARNING_URL: z.string().optional(),
  // Reported (not detected) on the admin system panel — set to 'cuda' on the
  // GPU VM so operators can see which sidecar build is deployed.
  EL_ML_DEVICE: z.enum(['cpu', 'cuda']).optional(),

  // JarvisLabs GPU instance control. The `jl` CLI reads JL_API_KEY straight
  // from the environment, so no `jl setup` / config file is needed — which is
  // what makes this work on a read-only container filesystem.
  JL_API_KEY: z.string().optional(),
  // Override if the binary isn't on PATH under its default name.
  JL_BINARY: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MS_CLIENT_ID: z.string().optional(),
  MS_CLIENT_SECRET: z.string().optional(),

  // Email goes out over one of two providers. Explicit selection wins;
  // otherwise RESEND_API_KEY picks Resend and SMTP_HOST picks SMTP.
  EMAIL_PROVIDER: z.enum(['resend', 'smtp']).optional(),
  EMAIL_FROM: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  // Svix signing secret (`whsec_…`) for POST /api/webhooks/resend. Without it
  // the endpoint rejects everything.
  RESEND_WEBHOOK_SECRET: z.string().optional(),

  // Shared secret the GPU box presents to GET /api/webhooks/gpu/heartbeat.
  // Without it that endpoint rejects everything, so the box self-stops.
  EL_GPU_HEARTBEAT_TOKEN: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: optionalInt,
  SMTP_USERNAME: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: optionalTristateBool,
  // Deprecated alias for EMAIL_FROM, kept so existing deployments keep sending.
  SMTP_FROM: z.string().optional(),

  EL_PUBLIC_BASE_URL: z.string().optional(),
  // Where support messages from the Help dialog are emailed. Unset means the
  // ticket is still stored and shown in the admin Support tab, just not mailed.
  EL_SUPPORT_EMAIL: z.string().optional(),
  EL_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  EL_SESSION_TTL_DAYS: optionalInt,
  EL_STAGING_FOLDER: z.string().optional(),
  EL_CACHE_FOLDER: z.string().optional(),

  NO_COLOR: z.string().optional(),
});

export type EnvDto = z.infer<typeof EnvSchema>;
