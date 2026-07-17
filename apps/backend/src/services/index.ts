import { AdminService } from 'src/services/admin.service';
import { AuthService } from 'src/services/auth.service';
import { CleanupService } from 'src/services/cleanup.service';
import { EventService } from 'src/services/event.service';
import { FaceService } from 'src/services/face.service';
import { ImportService } from 'src/services/import.service';
import { MediaService } from 'src/services/media.service';
import { NotificationService } from 'src/services/notification.service';
import { OrganizationService } from 'src/services/organization.service';
import { ParticipantService } from 'src/services/participant.service';

export const services = [
  AdminService,
  AuthService,
  CleanupService,
  EventService,
  FaceService,
  ImportService,
  MediaService,
  NotificationService,
  OrganizationService,
  ParticipantService,
];
