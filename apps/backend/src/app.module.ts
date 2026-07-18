// One codebase, two deployables (docs/plan/01-architecture.md §1):
// ApiModule adds HTTP controllers; WorkerModule is queue consumers only.
// Which queues actually start is decided by JobRepository.startWorkers()
// from EL_WORKERS_INCLUDE / EL_QUEUES_EXCLUDE.
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { KyselyModule } from 'nestjs-kysely';
import { ZodValidationPipe } from 'nestjs-zod';
import { AdminController } from 'src/controllers/admin.controller';
import { AssetController } from 'src/controllers/asset.controller';
import { AuthController } from 'src/controllers/auth.controller';
import { CloudController } from 'src/controllers/cloud.controller';
import { EventController } from 'src/controllers/event.controller';
import { ImportController } from 'src/controllers/import.controller';
import { OrganizationController } from 'src/controllers/organization.controller';
import { ParticipantAdminController } from 'src/controllers/participant-admin.controller';
import { PersonController } from 'src/controllers/person.controller';
import { PublicController } from 'src/controllers/public.controller';
import { AuthGuard } from 'src/middleware/auth.guard';
import { FileUploadInterceptor } from 'src/middleware/file-upload.interceptor';
import { repositories } from 'src/repositories';
import { ConfigRepository } from 'src/repositories/config.repository';
import { services } from 'src/services';
import { getKyselyConfig } from 'src/utils/database';

const configRepository = new ConfigRepository();
const { bull, database } = configRepository.getEnv();

const common = [...repositories, ...services];

const imports = [
  BullModule.forRoot(bull.config),
  BullModule.registerQueue(...bull.queues),
  KyselyModule.forRoot(getKyselyConfig(database.config)),
];

// global modest limit; strict per-route overrides via @Throttle
// (docs/plan/09 §3)
const throttler = ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]);

@Module({
  imports: [...imports, throttler],
  controllers: [
    AuthController,
    AdminController,
    OrganizationController,
    EventController,
    AssetController,
    PersonController,
    ParticipantAdminController,
    PublicController,
    CloudController,
    ImportController,
  ],
  providers: [
    ...common,
    AuthGuard,
    FileUploadInterceptor,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
  ],
})
export class ApiModule {}

@Module({
  imports,
  providers: common,
})
export class WorkerModule {}
