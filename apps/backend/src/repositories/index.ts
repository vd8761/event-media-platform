import { AssetRepository } from 'src/repositories/asset.repository';
import { AuditLogRepository } from 'src/repositories/audit-log.repository';
import { CloudAccountRepository } from 'src/repositories/cloud-account.repository';
import { CloudProviderRegistry } from 'src/repositories/cloud-providers';
import { ConfigRepository } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { EmailLogRepository } from 'src/repositories/email-log.repository';
import { EmailRepository } from 'src/repositories/email.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { ExifRepository } from 'src/repositories/exif.repository';
import { FaceRepository } from 'src/repositories/face.repository';
import { FaceSearchRepository } from 'src/repositories/face-search.repository';
import { SmartSearchRepository } from 'src/repositories/smart-search.repository';
import { ImportRepository } from 'src/repositories/import.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { JarvisLabsRepository } from 'src/repositories/jarvislabs.repository';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository';
import { MediaRepository } from 'src/repositories/media.repository';
import { OrganizationRepository } from 'src/repositories/organization.repository';
import { ParticipantRepository } from 'src/repositories/participant.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { PasswordResetRepository } from 'src/repositories/password-reset.repository';
import { SessionRepository } from 'src/repositories/session.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { SupportRepository } from 'src/repositories/support.repository';
import { SystemConfigRepository } from 'src/repositories/system-config.repository';
import { TelemetryRepository } from 'src/repositories/telemetry.repository';
import { UserRepository } from 'src/repositories/user.repository';

export const repositories = [
  AssetRepository,
  AuditLogRepository,
  CloudAccountRepository,
  CloudProviderRegistry,
  ConfigRepository,
  CryptoRepository,
  DatabaseRepository,
  EmailLogRepository,
  EmailRepository,
  EventRepository,
  ExifRepository,
  FaceRepository,
  FaceSearchRepository,
  SmartSearchRepository,
  ImportRepository,
  JobRepository,
  LoggingRepository,
  JarvisLabsRepository,
  MachineLearningRepository,
  MediaRepository,
  OrganizationRepository,
  ParticipantRepository,
  PersonRepository,
  PasswordResetRepository,
  SessionRepository,
  StorageRepository,
  SupportRepository,
  SystemConfigRepository,
  TelemetryRepository,
  UserRepository,
];
