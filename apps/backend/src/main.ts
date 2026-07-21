// Boot roles from EL_WORKERS_INCLUDE (docs/plan/01-architecture.md §1):
//   api    → HTTP server (controllers); enqueues only
//   ingest → consumers for import/match/notification/storageCleanup/background
//   media  → consumers for the GPU queues (no HTTP server)
// Single process per container; main VM runs `api,ingest`, GPU VM runs `media`.
// MUST stay first: it populates process.env before app.module.ts reads config
// at module scope.
import 'src/env-file';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiModule, WorkerModule } from 'src/app.module';
import { WorkerRole } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository';
import { TelemetryRepository } from 'src/repositories/telemetry.repository';
import { services } from 'src/services';
import { isStartUpError } from 'src/utils/misc';

async function bootstrap() {
  process.title = 'eventlens';
  const configRepository = new ConfigRepository();
  const { workers, port, host, database, includedQueues } = configRepository.getEnv();
  const isApi = workers.includes(WorkerRole.Api);
  // EL_QUEUES_INCLUDE can give an api-only process consumers, so the queue
  // roles alone no longer decide whether workers start.
  const hasConsumers =
    workers.includes(WorkerRole.Ingest) || workers.includes(WorkerRole.Media) || includedQueues.length > 0;

  const app = isApi
    ? // rawBody: the Resend webhook signature is computed over the exact bytes
      // received, so the parsed body cannot be used to verify it.
      await NestFactory.create<NestExpressApplication>(ApiModule, { bufferLogs: true, rawBody: true })
    : await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });

  const logger = await app.resolve(LoggingRepository);
  logger.setContext('Bootstrap');
  app.useLogger(logger);

  // migrations run before anything else, serialized by an advisory lock
  if (database.skipMigrations) {
    logger.warn('Skipping migrations (DB_SKIP_MIGRATIONS)');
  } else {
    await app.get(DatabaseRepository).runMigrations();
  }

  const jobRepository = app.get(JobRepository);
  jobRepository.setup(services);
  if (hasConsumers) {
    jobRepository.startWorkers();
  }
  if (workers.includes(WorkerRole.Ingest)) {
    await jobRepository.registerCronSchedules();
  }
  // Any process that runs ML-backed queues wants the health map warm — that
  // includes an API host which opted into `selfie` via EL_QUEUES_INCLUDE.
  if (workers.includes(WorkerRole.Media) || includedQueues.length > 0) {
    // the worker gates face jobs on ML /ping health (docs/plan/11 §2)
    app.get(MachineLearningRepository).startAvailabilityChecks();
  }

  // Every process publishes its own host (and GPU, where there is one) to
  // Redis so the admin system panel can show machines it is not running on.
  app.get(TelemetryRepository).startHeartbeat();

  // Lets TelemetryRepository drop its heartbeat key on SIGTERM/SIGINT instead
  // of leaving a ghost machine on the panel until the TTL expires.
  app.enableShutdownHooks();

  if (isApi) {
    const httpApp = app as NestExpressApplication;
    httpApp.setGlobalPrefix('api');
    httpApp.set('trust proxy', true);

    const openApiConfig = new DocumentBuilder()
      .setTitle('EventLens API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .addCookieAuth('el_session')
      .build();
    const document = SwaggerModule.createDocument(httpApp, openApiConfig);
    SwaggerModule.setup('api/docs', httpApp, document);

    await (host ? httpApp.listen(port, host) : httpApp.listen(port));
    logger.log(`EventLens API running on port ${port} [roles: ${workers.join(',')}]`);
  } else {
    logger.log(`EventLens worker running [roles: ${workers.join(',')}]`);
  }
}

bootstrap().catch((error) => {
  if (!isStartUpError(error)) {
    console.error(error);
  }
  process.exit(1);
});
