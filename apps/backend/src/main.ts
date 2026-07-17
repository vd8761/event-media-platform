// Boot roles from EL_WORKERS_INCLUDE (docs/plan/01-architecture.md §1):
//   api    → HTTP server (controllers); enqueues only
//   ingest → consumers for import/match/notification/storageCleanup/background
//   media  → consumers for the GPU queues (no HTTP server)
// Single process per container; main VM runs `api,ingest`, GPU VM runs `media`.
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiModule, WorkerModule } from 'src/app.module';
import { WorkerRole } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { services } from 'src/services';
import { isStartUpError } from 'src/utils/misc';

async function bootstrap() {
  process.title = 'eventlens';
  const configRepository = new ConfigRepository();
  const { workers, port, host, database } = configRepository.getEnv();
  const isApi = workers.includes(WorkerRole.Api);
  const hasConsumers = workers.includes(WorkerRole.Ingest) || workers.includes(WorkerRole.Media);

  const app = isApi
    ? await NestFactory.create<NestExpressApplication>(ApiModule, { bufferLogs: true })
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
