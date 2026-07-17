import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { ExifRepository } from 'src/repositories/exif.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MediaRepository } from 'src/repositories/media.repository';
import { OrganizationRepository } from 'src/repositories/organization.repository';
import { ParticipantRepository } from 'src/repositories/participant.repository';
import { SessionRepository } from 'src/repositories/session.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { UserRepository } from 'src/repositories/user.repository';

export const repositories = [
  AssetRepository,
  ConfigRepository,
  CryptoRepository,
  DatabaseRepository,
  EventRepository,
  ExifRepository,
  JobRepository,
  LoggingRepository,
  MediaRepository,
  OrganizationRepository,
  ParticipantRepository,
  SessionRepository,
  StorageRepository,
  UserRepository,
];
