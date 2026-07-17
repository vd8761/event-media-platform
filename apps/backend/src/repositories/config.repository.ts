// Ported from immich:server/src/repositories/config.repository.ts.
// IMMICH_* env → EL_*; bull prefix immich_bull → el_bull; adds R2/OAuth/SMTP
// groups and the EL_QUEUES_EXCLUDE gate (docs/plan/01-architecture.md §1).
import { RegisterQueueOptions } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { QueueOptions } from 'bullmq';
import { RedisOptions } from 'ioredis';
import { EnvSchema } from 'src/dtos/env.dto';
import { Environment, LogLevel, QueueName, VectorExtension, WorkerRole } from 'src/enum';

export interface DatabaseConnectionParams {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  url?: string;
}

export interface EnvData {
  host?: string;
  port: number;
  environment: Environment;
  logLevel?: LogLevel;

  workers: WorkerRole[];
  excludedQueues: QueueName[];

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
  };

  oauth: {
    google: { clientId?: string; clientSecret?: string };
    microsoft: { clientId?: string; clientSecret?: string };
  };

  smtp: {
    host?: string;
    port: number;
    username?: string;
    password?: string;
    from?: string;
  };

  publicBaseUrl: string;
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

  const environment = (dto.EL_ENV as Environment) || Environment.Production;

  const redisConfig: RedisOptions = {
    host: dto.REDIS_HOSTNAME || 'redis',
    port: dto.REDIS_PORT || 6379,
    db: dto.REDIS_DBINDEX || 0,
    username: dto.REDIS_USERNAME || undefined,
    password: dto.REDIS_PASSWORD || undefined,
  };

  return {
    host: dto.EL_HOST,
    port: dto.EL_PORT || 3001,
    environment,
    logLevel: dto.EL_LOG_LEVEL as LogLevel | undefined,

    workers,
    excludedQueues,

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
        host: dto.DB_HOSTNAME || 'database',
        port: dto.DB_PORT || 5432,
        username: dto.DB_USERNAME || 'postgres',
        password: dto.DB_PASSWORD || 'postgres',
        database: dto.DB_DATABASE_NAME || 'eventlens',
        url: dto.DB_URL,
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
    },

    oauth: {
      google: { clientId: dto.GOOGLE_CLIENT_ID, clientSecret: dto.GOOGLE_CLIENT_SECRET },
      microsoft: { clientId: dto.MS_CLIENT_ID, clientSecret: dto.MS_CLIENT_SECRET },
    },

    smtp: {
      host: dto.SMTP_HOST,
      port: dto.SMTP_PORT || 587,
      username: dto.SMTP_USERNAME,
      password: dto.SMTP_PASSWORD,
      from: dto.SMTP_FROM,
    },

    publicBaseUrl: dto.EL_PUBLIC_BASE_URL || 'http://localhost:3001',
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
