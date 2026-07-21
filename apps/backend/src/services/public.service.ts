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
import archiver from 'archiver';
import { unlink } from 'node:fs/promises';
import { MAX_SELFIES, StagedUpload } from 'src/middleware/file-upload.interceptor';
import { EventStatus, JobName, ParticipantStatus } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { OrganizationRepository } from 'src/repositories/organization.repository';
import { ParticipantRepository } from 'src/repositories/participant.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { EventRow } from 'src/schema';
import { AssetService } from 'src/services/asset.service';
import { GalleryTokenService } from 'src/services/gallery-token.service';
import { PersonService } from 'src/services/person.service';
import { SelfieProgressService } from 'src/services/selfie-progress.service';
import { isEventExpired, isEventPurged } from 'src/utils/event-expiry';
import { toFaceBoxes } from 'src/utils/face-box';
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
    private assetService: AssetService,
    private cryptoRepository: CryptoRepository,
    private eventRepository: EventRepository,
    private galleryTokenService: GalleryTokenService,
    private jobRepository: JobRepository,
    private logger: LoggingRepository,
    private selfieProgressService: SelfieProgressService,
    private organizationRepository: OrganizationRepository,
    private participantRepository: ParticipantRepository,
    private personRepository: PersonRepository,
    private personService: PersonService,
    private storageRepository: StorageRepository,
  ) {
    this.logger.setContext(PublicService.name);
  }

  // 404 for draft/closed/disabled events — indistinguishable from nonexistent
  async getPublicEvent(slug: string) {
    const event = await this.getActiveEvent(slug);
    // The public top bar credits the organiser on the right, so the org name
    // travels with every public event payload.
    const org = await this.organizationRepository.getById(event.orgId);
    return {
      organization: { name: org?.name ?? null },
      // Public id, so a support message sent from this page can be filed
      // against the right event.
      id: event.id,
      name: event.name,
      description: event.description,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      participantPageEnabled: event.participantPageEnabled,
    };
  }

  async submitSelfie(
    slug: string,
    email: string,
    name: string,
    phone: string | undefined,
    staged: StagedUpload[],
    clientIp: string,
  ) {
    try {
      // 1–3 photos, all of the same person (migration 0011). More than three
      // is rejected rather than silently truncated.
      if (staged.length === 0) {
        throw new BadRequestException('Missing selfie file');
      }
      if (staged.length > MAX_SELFIES) {
        throw new BadRequestException(`Please submit at most ${MAX_SELFIES} photos`);
      }
      for (const file of staged) {
        if (!file.mimeType.startsWith('image/')) {
          throw new BadRequestException('Selfie must be an image');
        }
        if (file.size > MAX_SELFIE_BYTES) {
          throw new PayloadTooLargeException('Selfie exceeds 15 MB');
        }
      }

      const event = await this.getActiveEvent(slug);

      if (!this.ipLimiter.consume(`ip:${clientIp}`)) {
        throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
      }
      if (!this.emailLimiter.consume(`email:${event.id}:${email.toLowerCase()}`)) {
        throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
      }

      // upsert on (event_id, email): new selfies replace old, token regenerated
      const token = this.galleryTokenService.generate();
      const participantId = crypto.randomUUID();
      const keys = staged.map((_, index) => StorageKeys.selfie(event.orgId, event.id, participantId, index));
      await Promise.all(staged.map((file, index) => this.storageRepository.putFile(file.stagingPath, keys[index], file.mimeType)));

      const participant = await this.participantRepository.upsert({
        eventId: event.id,
        email,
        name: name.trim(),
        phone: phone?.trim() || null,
        // The first photo stays the primary one on the participant row.
        selfieKey: keys[0],
        galleryTokenHash: token.hash,
        galleryTokenEnc: token.enc,
      });

      // Written after the upsert so a resubmission replaces the previous set
      // rather than mixing old and new photos of the same person.
      await this.participantRepository.replaceSelfies(participant.id, keys);

      // Acknowledge first, match second: the confirmation email carries the
      // same gallery link and goes out immediately, so the participant has
      // somewhere to look while the selfies are still being processed.
      await this.jobRepository.queueAll([
        { name: JobName.SendSelfieReceived, data: { participantId: participant.id } },
        { name: JobName.SelfieProcess, data: { participantId: participant.id } },
      ]);

      // Response stays generic — no email enumeration. The progress ticket is
      // safe to include because it unlocks only counts and a status, never
      // photos and never the gallery link; whoever submitted this selfie
      // already knows everything it can tell them.
      return {
        message: "Check your email — we've sent you a link to your photos.",
        progressTicket: this.selfieProgressService.issueTicket(participant.id),
      };
    } finally {
      await Promise.all(staged.map((file) => unlink(file.stagingPath).catch(() => undefined)));
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
        originalFilename: asset.originalFilename,
        capturedAt: asset.capturedAt,
        createdAt: asset.createdAt,
        width: asset.width,
        height: asset.height,
        thumbhash: asset.thumbhash ? asset.thumbhash.toString('base64') : null,
        thumbUrl: asset.thumbKey
          ? await this.storageRepository.presignGet(asset.thumbKey, { expiresIn: GALLERY_URL_TTL })
          : null,
        previewUrl: asset.previewKey
          ? await this.storageRepository.presignGet(asset.previewKey, { expiresIn: GALLERY_URL_TTL })
          : null,
      })),
    );

    // Remember that this link was opened, and whether it was opened while the
    // result was still pending — that is the only case that later earns a
    // "your photos are ready" email.
    const stillWorking =
      participant.status === ParticipantStatus.Processing || participant.status === ParticipantStatus.PendingMatch;
    const update: Parameters<ParticipantRepository['update']>[1] = {};
    if (!participant.galleryOpenedAt) {
      update.galleryOpenedAt = new Date();
    }
    if (stillWorking && !participant.awaitingResultNotice) {
      update.awaitingResultNotice = true;
    }
    if (Object.keys(update).length > 0) {
      await this.participantRepository.update(participant.id, update);
    }

    const org = await this.organizationRepository.getById(event.orgId);

    return {
      organization: { name: org?.name ?? null },
      event: {
        id: event.id,
        name: event.name,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        // participants may browse the whole event only if the organiser says so
        showAllPhotos: event.participantsSeeAllPhotos,
        canDownloadAllPhotos: event.participantsSeeAllPhotos && event.participantsCanDownloadAll,
      },
      status: participant.status,
      name: participant.name,
      assets,
    };
  }

  // The whole event gallery, shown to participants only when the organiser has
  // enabled it. Same cursor pagination as the org-facing listing.
  async getEventGallery(token: string, limit: number, cursor?: string) {
    const { event } = await this.resolveGallery(token);
    if (!event.participantsSeeAllPhotos) {
      throw new NotFoundException('Event photos are not shared');
    }
    return this.assetService.list(event.id, limit, cursor);
  }

  // Faces drawn over a photo in the participant's viewer. Names are always
  // shown; whether a face is a link to that person's photos is decided
  // client-side from event.showAllPhotos, and enforced by getPersonGallery.
  async getGalleryAssetFaces(token: string, assetId: string) {
    const { participant, event } = await this.resolveGallery(token);
    await this.assertViewable(participant.id, event, assetId);
    return { faces: toFaceBoxes(await this.assetRepository.getFaces(assetId)) };
  }

  // All photos of one person, for a participant who tapped a face. Only
  // available when the organiser shares the whole event — otherwise this would
  // hand out photos the participant is not allowed to browse.
  async getPersonGallery(token: string, personId: string) {
    const { event } = await this.resolveGallery(token);
    if (!event.participantsSeeAllPhotos) {
      throw new NotFoundException('Event photos are not shared');
    }

    const person = await this.personRepository.getById(event.id, personId);
    if (!person || person.isHidden) {
      throw new NotFoundException('Person not found');
    }

    const assets = await this.personService.getAssets(event.id, personId);
    return { person: { id: person.id, name: person.name }, assets };
  }

  // A participant may look at their own matches, and at any event photo once
  // the organiser has shared the gallery.
  private async assertViewable(participantId: string, event: EventRow, assetId: string): Promise<void> {
    if (await this.participantRepository.isMatchedAsset(participantId, assetId)) {
      return;
    }
    if (!event.participantsSeeAllPhotos) {
      throw new NotFoundException('Asset not found');
    }
    if (!(await this.assetRepository.getById(event.id, assetId))) {
      throw new NotFoundException('Asset not found');
    }
  }

  // 302 presigned original. A participant's own matches are always
  // downloadable; everyone else's photos need both event toggles.
  async getGalleryDownloadUrl(token: string, assetId: string): Promise<string> {
    const { participant, event } = await this.resolveGallery(token);
    await this.assertDownloadable(participant.id, event, assetId);

    const asset = await this.assetRepository.getById(participant.eventId, assetId);
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    return this.storageRepository.presignGet(asset.storageKey, {
      expiresIn: DOWNLOAD_URL_TTL,
      filename: asset.originalFilename,
    });
  }

  private async assertDownloadable(participantId: string, event: EventRow, assetId: string): Promise<void> {
    if (await this.participantRepository.isMatchedAsset(participantId, assetId)) {
      return;
    }
    // Not one of theirs — allowed only when the organiser shares the event
    // gallery AND permits downloading it. "Not found" rather than "forbidden"
    // so the response can't be used to probe which photos exist.
    if (!event.participantsSeeAllPhotos || !event.participantsCanDownloadAll) {
      throw new NotFoundException('Asset not found');
    }
    if (!(await this.assetRepository.getById(event.id, assetId))) {
      throw new NotFoundException('Asset not found');
    }
  }

  // "Download all": stream a zip of every matched original (docs/plan/07 §4;
  // Immich archiver pattern). Bytes flow R2 → backend → client without
  // buffering whole files.
  // `assetIds` narrows the zip to a multi-select; omitted means "everything I
  // matched". Each requested id is permission-checked individually.
  async streamGalleryZip(
    token: string,
    response: import('express').Response,
    assetIds?: string[],
  ): Promise<void> {
    const { participant, event } = await this.resolveGallery(token);

    let ids: string[];
    if (assetIds && assetIds.length > 0) {
      for (const assetId of assetIds) {
        await this.assertDownloadable(participant.id, event, assetId);
      }
      ids = assetIds;
    } else {
      const matched = await this.participantRepository.getMatchedAssets(participant.id);
      ids = matched.map((asset) => asset.assetId);
    }

    if (ids.length === 0) {
      throw new NotFoundException('No photos to download yet');
    }

    const archive = archiver('zip', { zlib: { level: 0 } }); // media is already compressed

    const safeName = event.name.replaceAll(/[^\w\- ]+/g, '').trim() || 'photos';
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);
    archive.pipe(response);

    const used = new Set<string>();
    for (const assetId of ids) {
      const full = await this.assetRepository.getById(participant.eventId, assetId);
      if (!full) {
        continue;
      }
      // duplicate filenames get a numeric suffix inside the zip
      let name = full.originalFilename;
      for (let counter = 2; used.has(name); counter++) {
        const dot = full.originalFilename.lastIndexOf('.');
        name =
          dot > 0
            ? `${full.originalFilename.slice(0, dot)} (${counter})${full.originalFilename.slice(dot)}`
            : `${full.originalFilename} (${counter})`;
      }
      used.add(name);
      archive.append(await this.storageRepository.getStream(full.storageKey), { name });
    }

    await archive.finalize();
  }

  // Every tokenized gallery route funnels through here, so the expiry check
  // lives here rather than in each of them — a new gallery route cannot
  // accidentally skip it.
  private async resolveGallery(token: string) {
    const participant = await this.participantRepository.getByTokenHash(this.cryptoRepository.hashSha256(token));
    if (!participant) {
      throw new NotFoundException('Gallery not found');
    }
    const event = await this.eventRepository.getById(participant.eventId);
    if (!event || event.deletedAt) {
      throw new NotFoundException('Gallery not found');
    }
    if (isEventExpired(event)) {
      // 410 rather than 404: the link was real and the participant may well
      // have it bookmarked, so the client can say "this has closed" instead of
      // "never existed". `purged` tells it whether extending could ever help.
      throw new HttpException(
        {
          statusCode: HttpStatus.GONE,
          error: 'Gone',
          message: 'This gallery has closed',
          eventName: event.name,
          expiredAt: event.expiresAt,
          purged: isEventPurged(event),
        },
        HttpStatus.GONE,
      );
    }
    return { participant, event };
  }

  private async getActiveEvent(slug: string): Promise<EventRow> {
    const event = await this.eventRepository.getBySlug(slug);
    if (!event || event.status !== EventStatus.Active || !event.participantPageEnabled) {
      throw new NotFoundException('Event not found');
    }
    // Intake closes with the galleries — accepting a selfie into an event
    // whose media is queued for deletion would strand the participant.
    if (isEventExpired(event)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.GONE,
          error: 'Gone',
          message: 'This event has closed',
          eventName: event.name,
          expiredAt: event.expiresAt,
          purged: isEventPurged(event),
        },
        HttpStatus.GONE,
      );
    }
    return event;
  }
}
