// Ported from immich:server/src/repositories/config.repository.ts.
// IMMICH_* env → EL_*; bull prefix immich_bull → el_bull; adds R2/OAuth/SMTP
// groups and the EL_QUEUES_EXCLUDE gate (docs/plan/01-architecture.md §1).
import { RegisterQueueOptions } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { QueueOptions } from 'bullmq';
import { RedisOptions } from 'ioredis';
import { EnvDto, EnvSchema } from 'src/dtos/env.dto';
import { Environment, LogLevel, QueueName, VectorExtension, WorkerRole } from 'src/enum';

export interface DatabaseConnectionParams {
  url: string;
  // node-postgres does not act on `sslmode` in every version, so the scheme is
  // resolved here and passed explicitly to the pool (see utils/database.ts).
  ssl: false | { rejectUnauthorized: boolean };
}

export type EmailProvider = 'resend' | 'smtp';

export interface EnvData {
  host?: string;
  port: number;
  environment: Environment;
  logLevel?: LogLevel;

  workers: WorkerRole[];
  excludedQueues: QueueName[];
  includedQueues: QueueName[];

  bull: {
    config: QueueOptions;
    queues: RegisterQueueOptions[];
  };

  database: {
    config: DatabaseConnectionParams;
    skipMigrations: boolean;
    vectorExtension: VectorExtension;
  };

  redis: RedisOptions;

  storage: {
    r2: {
      endpoint?: string;
      bucket: string;
      accessKeyId?: string;
      secretAccessKey?: string;
    };
    stagingFolder: string;
    cacheFolder: string;
  };

  machineLearning: {
    urls: string[];
    device: 'cpu' | 'cuda';
  };

  jarvisLabs: {
    apiKey: string;
    binary: string;
  };

  oauth: {
    google: { clientId?: string; clientSecret?: string };
    microsoft: { clientId?: string; clientSecret?: string };
  };

  email: {
    provider: EmailProvider;
    from: string;
    resend: { apiKey?: string };
    webhookSecret?: string;
    smtp: {
      host?: string;
      port: number;
      secure: boolean;
      username?: string;
      password?: string;
    };
  };

  publicBaseUrl: string;
  gpuHeartbeatToken?: string;
  tokenEncryptionKey?: string;
  sessionTtlDays: number;

  noColor: boolean;
}

const WORKER_TYPES = new Set(Object.values(WorkerRole));
const QUEUE_TYPES = new Set(Object.values(QueueName));

const asSet = <T>(value: string | undefined, defaults: T[]) => {
  const values = (value || '').replaceAll(/\s/g, '').split(',').filter(Boolean);
  return new Set(values.length === 0 ? defaults : (values as T[]));
};

const setDifference = <T>(a: Set<T>, b: Set<T>) => new Set([...a].filter((value) => !b.has(value)));

// Local compose default (docker/docker-compose.dev.yml maps 5433 → 5432).
const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@localhost:5433/eventlens';

// Managed Postgres (Neon, Supabase, RDS…) terminates TLS with a public CA, so
// full verification is correct. `sslmode=no-verify` opts out for self-signed
// certs; plain local Postgres gets no TLS at all.
const resolveDatabaseSsl = (rawUrl: string): DatabaseConnectionParams['ssl'] => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`DATABASE_URL is not a valid connection string: ${rawUrl}`);
  }

  const sslmode = url.searchParams.get('sslmode');
  switch (sslmode) {
    case 'disable': {
      return false;
    }
    case 'no-verify':
    case 'allow':
    case 'prefer': {
      return { rejectUnauthorized: false };
    }
    case 'require':
    case 'verify-ca':
    case 'verify-full': {
      return { rejectUnauthorized: true };
    }
    default: {
      // No sslmode given. Loopback and the `database` compose service are
      // reached over a private bridge network and stay plaintext; anything
      // else is remote, so credentials must not cross it in the clear just
      // because someone left sslmode off the URL.
      const host = url.hostname;
      const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === 'database';
      return isLocal ? false : { rejectUnauthorized: true };
    }
  }
};

const resolveRedis = (dto: EnvDto): RedisOptions => {
  // BullMQ requires maxRetriesPerRequest to be null on its connections, and
  // Upstash rejects the readiness probe ioredis sends by default.
  const base: RedisOptions = { maxRetriesPerRequest: null, enableReadyCheck: false };

  if (dto.REDIS_URL) {
    let url: URL;
    try {
      url = new URL(dto.REDIS_URL);
    } catch {
      throw new Error(`REDIS_URL is not a valid connection string: ${dto.REDIS_URL}`);
    }
    if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
      throw new Error(`REDIS_URL must use redis:// or rediss://, got ${url.protocol}//`);
    }

    // db index rides in the path for URL-style config: rediss://host:6379/2
    const path = url.pathname.replace(/^\//, '');
    return {
      ...base,
      host: url.hostname,
      port: url.port ? Number(url.port) : 6379,
      db: path ? Number(path) : 0,
      username: decodeURIComponent(url.username) || undefined,
      password: decodeURIComponent(url.password) || undefined,
      // rediss:// is the whole point for Upstash — SNI must be the hostname.
      tls: url.protocol === 'rediss:' ? { servername: url.hostname } : undefined,
    };
  }

  // Defaults describe local development (docker/docker-compose.dev.yml
  // publishes Redis on the host); every deployed environment sets REDIS_URL.
  const host = dto.REDIS_HOSTNAME || 'localhost';
  return {
    ...base,
    host,
    port: dto.REDIS_PORT || 6379,
    db: dto.REDIS_DBINDEX || 0,
    username: dto.REDIS_USERNAME || undefined,
    password: dto.REDIS_PASSWORD || undefined,
    tls: dto.REDIS_TLS ? { servername: host } : undefined,
  };
};

const resolveEmail = (dto: EnvDto): EnvData['email'] => {
  // Explicit selection wins; otherwise whichever provider has credentials.
  const provider: EmailProvider =
    dto.EMAIL_PROVIDER ?? (dto.RESEND_API_KEY ? 'resend' : 'smtp');

  return {
    provider,
    from: dto.EMAIL_FROM || dto.SMTP_FROM || 'EventLens <noreply@eventlens.local>',
    resend: { apiKey: dto.RESEND_API_KEY },
    webhookSecret: dto.RESEND_WEBHOOK_SECRET,
    smtp: {
      host: dto.SMTP_HOST,
      port: dto.SMTP_PORT || 587,
      // Implicit TLS is port 465; 587 uses STARTTLS, which nodemailer handles
      // with secure:false. Explicit SMTP_SECURE overrides both.
      secure: dto.SMTP_SECURE ?? (dto.SMTP_PORT || 587) === 465,
      username: dto.SMTP_USERNAME,
      password: dto.SMTP_PASSWORD,
    },
  };
};

const getEnv = (): EnvData => {
  const parseResult = EnvSchema.safeParse(process.env);
  if (!parseResult.success) {
    const messages = ['Invalid environment variables: '];
    for (const issue of parseResult.error.issues) {
      messages.push(`  - [${issue.path.join('.')}] ${issue.message}`);
    }
    throw new Error(messages.join('\n'));
  }
  const dto = parseResult.data;

  const includedWorkers = asSet<WorkerRole>(dto.EL_WORKERS_INCLUDE, [WorkerRole.Api, WorkerRole.Ingest]);
  const excludedWorkers = asSet<WorkerRole>(dto.EL_WORKERS_EXCLUDE, []);
  const workers = [...setDifference(includedWorkers, excludedWorkers)];
  for (const worker of workers) {
    if (!WORKER_TYPES.has(worker)) {
      throw new Error(`Invalid worker(s) found: ${workers.join(',')}`);
    }
  }

  const excludedQueues = [...asSet<QueueName>(dto.EL_QUEUES_EXCLUDE, [])];
  for (const queue of excludedQueues) {
    if (!QUEUE_TYPES.has(queue)) {
      throw new Error(`Invalid queue(s) in EL_QUEUES_EXCLUDE: ${excludedQueues.join(',')}`);
    }
  }

  const includedQueues = [...asSet<QueueName>(dto.EL_QUEUES_INCLUDE, [])];
  for (const queue of includedQueues) {
    if (!QUEUE_TYPES.has(queue)) {
      throw new Error(`Invalid queue(s) in EL_QUEUES_INCLUDE: ${includedQueues.join(',')}`);
    }
  }
  // Exclude wins: it is the safety valve that guarantees a queue has exactly
  // one consumer (facialRecognition), so nothing may override it.
  const overlap = includedQueues.filter((queue) => excludedQueues.includes(queue));
  if (overlap.length > 0) {
    throw new Error(`Queue(s) in both EL_QUEUES_INCLUDE and EL_QUEUES_EXCLUDE: ${overlap.join(',')}`);
  }

  const environment = (dto.EL_ENV as Environment) || Environment.Production;

  const redisConfig = resolveRedis(dto);
  const databaseUrl = dto.DATABASE_URL || DEFAULT_DATABASE_URL;

  return {
    host: dto.EL_HOST,
    port: dto.EL_PORT || dto.PORT || 3001,
    environment,
    logLevel: dto.EL_LOG_LEVEL as LogLevel | undefined,

    workers,
    excludedQueues,
    includedQueues,

    bull: {
      config: {
        prefix: 'el_bull',
        connection: { ...redisConfig },
        defaultJobOptions: {
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: false,
        },
      },
      queues: Object.values(QueueName).map((name) => ({ name })),
    },

    database: {
      config: {
        url: databaseUrl,
        ssl: resolveDatabaseSsl(databaseUrl),
      },
      skipMigrations: dto.DB_SKIP_MIGRATIONS ?? false,
      vectorExtension:
        dto.DB_VECTOR_EXTENSION === 'pgvector' ? VectorExtension.PgVector : VectorExtension.VectorChord,
    },

    redis: redisConfig,

    storage: {
      r2: {
        endpoint: dto.R2_ENDPOINT,
        bucket: dto.R2_BUCKET || 'eventlens-media',
        accessKeyId: dto.R2_ACCESS_KEY_ID,
        secretAccessKey: dto.R2_SECRET_ACCESS_KEY,
      },
      stagingFolder: dto.EL_STAGING_FOLDER || '/staging',
      cacheFolder: dto.EL_CACHE_FOLDER || '/cache',
    },

    machineLearning: {
      urls: (dto.MACHINE_LEARNING_URL || 'http://ml:3003').split(',').filter(Boolean),
      device: dto.EL_ML_DEVICE || 'cpu',
    },

    jarvisLabs: {
      apiKey: dto.JL_API_KEY || '',
      binary: dto.JL_BINARY || 'jl',
    },

    oauth: {
      google: { clientId: dto.GOOGLE_CLIENT_ID, clientSecret: dto.GOOGLE_CLIENT_SECRET },
      microsoft: { clientId: dto.MS_CLIENT_ID, clientSecret: dto.MS_CLIENT_SECRET },
    },

    email: resolveEmail(dto),

    publicBaseUrl: dto.EL_PUBLIC_BASE_URL || 'http://localhost:3001',
    gpuHeartbeatToken: dto.EL_GPU_HEARTBEAT_TOKEN,
    tokenEncryptionKey: dto.EL_TOKEN_ENCRYPTION_KEY,
    sessionTtlDays: dto.EL_SESSION_TTL_DAYS || 90,

    noColor: !!dto.NO_COLOR,
  };
};

let cached: EnvData | undefined;

@Injectable()
export class ConfigRepository {
  getEnv(): EnvData {
    if (!cached) {
      cached = getEnv();
    }
    return cached;
  }

  isDev() {
    return this.getEnv().environment === Environment.Development;
  }
}

export const clearEnvCache = () => (cached = undefined);
