// Public participant surfaces (docs/plan/07): event page info, selfie intake,
// and the tokenized personal gallery.
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import { StagedUpload } from 'src/middleware/file-upload.interceptor';
import { EventStatus, JobName } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { ParticipantRepository } from 'src/repositories/participant.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { EventRow } from 'src/schema';
import { GalleryTokenService } from 'src/services/gallery-token.service';
import { RateLimiter } from 'src/utils/rate-limiter';
import { StorageKeys } from 'src/utils/storage-keys';

const MAX_SELFIE_BYTES = 15 * 1024 * 1024; // 15 MB (docs/plan/07 §2)
const GALLERY_URL_TTL = 3600; // 1 h presigned
const DOWNLOAD_URL_TTL = 900;

@Injectable()
export class PublicService {
  // 5/hour per IP, 3/day per email per event
  private ipLimiter = new RateLimiter(5, 60 * 60 * 1000);
  private emailLimiter = new RateLimiter(3, 24 * 60 * 60 * 1000);

  constructor(
    private assetRepository: AssetRepository,
    private cryptoRepository: CryptoRepository,
    private eventRepository: EventRepository,
    private galleryTokenService: GalleryTokenService,
    private jobRepository: JobRepository,
    private logger: LoggingRepository,
    private participantRepository: ParticipantRepository,
    private storageRepository: StorageRepository,
  ) {
    this.logger.setContext(PublicService.name);
  }

  // 404 for draft/closed/disabled events — indistinguishable from nonexistent
  async getPublicEvent(slug: string) {
    const event = await this.getActiveEvent(slug);
    return {
      name: event.name,
      description: event.description,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      participantPageEnabled: event.participantPageEnabled,
    };
  }

  async submitSelfie(slug: string, email: string, staged: StagedUpload | undefined, clientIp: string) {
    try {
      if (!staged) {
        throw new BadRequestException('Missing selfie file');
      }
      if (!staged.mimeType.startsWith('image/')) {
        throw new BadRequestException('Selfie must be an image');
      }
      if (staged.size > MAX_SELFIE_BYTES) {
        throw new PayloadTooLargeException('Selfie exceeds 15 MB');
      }

      const event = await this.getActiveEvent(slug);

      if (!this.ipLimiter.consume(`ip:${clientIp}`)) {
        throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
      }
      if (!this.emailLimiter.consume(`email:${event.id}:${email.toLowerCase()}`)) {
        throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
      }

      // upsert on (event_id, email): new selfie replaces old, token regenerated
      const token = this.galleryTokenService.generate();
      const participantId = crypto.randomUUID();
      const selfieKey = StorageKeys.selfie(event.orgId, event.id, participantId);
      await this.storageRepository.putFile(staged.stagingPath, selfieKey, staged.mimeType);

      const participant = await this.participantRepository.upsert({
        eventId: event.id,
        email,
        selfieKey,
        galleryTokenHash: token.hash,
        galleryTokenEnc: token.enc,
      });

      await this.jobRepository.queue({ name: JobName.SelfieProcess, data: { participantId: participant.id } });

      // response is always the same generic 202 — no email enumeration
      return { message: 'Check your email once your photos are ready.' };
    } finally {
      if (staged) {
        await unlink(staged.stagingPath).catch(() => undefined);
      }
    }
  }

  // --- tokenized personal gallery (docs/plan/07 §4) ---

  async getGallery(token: string) {
    const { participant, event } = await this.resolveGallery(token);

    const matched = await this.participantRepository.getMatchedAssets(participant.id);
    const assets = await Promise.all(
      matched.map(async (asset) => ({
        id: asset.assetId,
        type: asset.type,
        capturedAt: asset.capturedAt,
        thumbhash: asset.thumbhash ? asset.thumbhash.toString('base64') : null,
        thumbUrl: asset.thumbKey
          ? await this.storageRepository.presignGet(asset.thumbKey, { expiresIn: GALLERY_URL_TTL })
          : null,
        previewUrl: asset.previewKey
          ? await this.storageRepository.presignGet(asset.previewKey, { expiresIn: GALLERY_URL_TTL })
          : null,
      })),
    );

    return {
      event: { name: event.name, startsAt: event.startsAt, endsAt: event.endsAt },
      status: participant.status,
      assets,
    };
  }

  // 302 presigned original — only after validating membership in participant_match
  async getGalleryDownloadUrl(token: string, assetId: string): Promise<string> {
    const { participant } = await this.resolveGallery(token);

    if (!(await this.participantRepository.isMatchedAsset(participant.id, assetId))) {
      throw new NotFoundException('Asset not found');
    }

    const asset = await this.assetRepository.getById(participant.eventId, assetId);
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    return this.storageRepository.presignGet(asset.storageKey, {
      expiresIn: DOWNLOAD_URL_TTL,
      filename: asset.originalFilename,
    });
  }

  private async resolveGallery(token: string) {
    const participant = await this.participantRepository.getByTokenHash(this.cryptoRepository.hashSha256(token));
    if (!participant) {
      throw new NotFoundException('Gallery not found');
    }
    const event = await this.eventRepository.getById(participant.eventId);
    if (!event || event.deletedAt) {
      throw new NotFoundException('Gallery not found');
    }
    return { participant, event };
  }

  private async getActiveEvent(slug: string): Promise<EventRow> {
    const event = await this.eventRepository.getBySlug(slug);
    if (!event || event.status !== EventStatus.Active || !event.participantPageEnabled) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }
}
