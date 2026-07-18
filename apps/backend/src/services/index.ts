import { AdminService } from 'src/services/admin.service';
import { AssetService } from 'src/services/asset.service';
import { AuthService } from 'src/services/auth.service';
import { CipherService } from 'src/services/cipher.service';
import { CleanupService } from 'src/services/cleanup.service';
import { CloudService } from 'src/services/cloud.service';
import { EventService } from 'src/services/event.service';
import { FaceService } from 'src/services/face.service';
import { GalleryTokenService } from 'src/services/gallery-token.service';
import { ImportService } from 'src/services/import.service';
import { MediaService } from 'src/services/media.service';
import { NotificationService } from 'src/services/notification.service';
import { OrganizationService } from 'src/services/organization.service';
import { ParticipantService } from 'src/services/participant.service';
import { PersonService } from 'src/services/person.service';
import { PublicService } from 'src/services/public.service';
import { UploadService } from 'src/services/upload.service';

export const services = [
  AdminService,
  AssetService,
  AuthService,
  CipherService,
  CleanupService,
  CloudService,
  EventService,
  FaceService,
  GalleryTokenService,
  ImportService,
  MediaService,
  NotificationService,
  OrganizationService,
  ParticipantService,
  PersonService,
  PublicService,
  UploadService,
];
