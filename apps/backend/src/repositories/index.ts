import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { EmailLogRepository } from 'src/repositories/email-log.repository';
import { EmailRepository } from 'src/repositories/email.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { ExifRepository } from 'src/repositories/exif.repository';
import { FaceRepository } from 'src/repositories/face.repository';
import { FaceSearchRepository } from 'src/repositories/face-search.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository';
import { MediaRepository } from 'src/repositories/media.repository';
import { OrganizationRepository } from 'src/repositories/organization.repository';
import { ParticipantRepository } from 'src/repositories/participant.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SessionRepository } from 'src/repositories/session.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { SystemConfigRepository } from 'src/repositories/system-config.repository';
import { UserRepository } from 'src/repositories/user.repository';

export const repositories = [
  AssetRepository,
  ConfigRepository,
  CryptoRepository,
  DatabaseRepository,
  EmailLogRepository,
  EmailRepository,
  EventRepository,
  ExifRepository,
  FaceRepository,
  FaceSearchRepository,
  JobRepository,
  LoggingRepository,
  MachineLearningRepository,
  MediaRepository,
  OrganizationRepository,
  ParticipantRepository,
  PersonRepository,
  SessionRepository,
  StorageRepository,
  SystemConfigRepository,
  UserRepository,
];
