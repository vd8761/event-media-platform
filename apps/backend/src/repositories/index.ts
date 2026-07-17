import { ConfigRepository } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { OrganizationRepository } from 'src/repositories/organization.repository';
import { ParticipantRepository } from 'src/repositories/participant.repository';
import { SessionRepository } from 'src/repositories/session.repository';
import { UserRepository } from 'src/repositories/user.repository';

export const repositories = [
  ConfigRepository,
  CryptoRepository,
  DatabaseRepository,
  EventRepository,
  JobRepository,
  LoggingRepository,
  OrganizationRepository,
  ParticipantRepository,
  SessionRepository,
  UserRepository,
];
