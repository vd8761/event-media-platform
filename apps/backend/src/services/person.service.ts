// Org-facing People/cluster review (docs/plan/09 §People).
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { AssetFileType, JobName } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { z } from 'zod';

const URL_TTL = 3600;

export class UpdatePersonDto extends createZodDto(
  z.object({
    name: z.string().max(200).optional(),
    isHidden: z.boolean().optional(),
  }),
) {}

// Fold other clusters into this one (Immich's "merge people").
export class MergePeopleDto extends createZodDto(
  z.object({
    ids: z.array(z.string().uuid()).min(1).max(100),
  }),
) {}

// Choose which detected face is cropped for this person's portrait
// (Immich's "set as profile picture").
export class SetPersonCoverDto extends createZodDto(
  z.object({
    faceId: z.string().uuid(),
  }),
) {}

@Injectable()
export class PersonService {
  constructor(
    private assetRepository: AssetRepository,
    private jobRepository: JobRepository,
    private logger: LoggingRepository,
    private personRepository: PersonRepository,
    private storageRepository: StorageRepository,
  ) {
    this.logger.setContext(PersonService.name);
  }

  async list(eventId: string) {
    const people = await this.personRepository.getAllForEvent(eventId, true);
    return Promise.all(
      people.map(async (person) => ({
        id: person.id,
        name: person.name,
        isHidden: person.isHidden,
        faceCount: person.faceCount,
        thumbnailUrl: person.thumbnailKey
          ? await this.storageRepository.presignGet(person.thumbnailKey, { expiresIn: URL_TTL })
          : null,
      })),
    );
  }

  // Org-wide People grid (the app-shell "People" tab): every named/visible
  // person across the org's live events. Filenames aside, the shape mirrors the
  // per-event list so the frontend renders both with one card.
  async listForOrg(orgId: string) {
    const people = await this.personRepository.getAllForOrg(orgId);
    return Promise.all(
      people.map(async (person) => ({
        id: person.id,
        eventId: person.eventId,
        eventName: person.eventName,
        name: person.name,
        faceCount: person.faceCount,
        thumbnailUrl: person.thumbnailKey
          ? await this.storageRepository.presignGet(person.thumbnailKey, { expiresIn: URL_TTL })
          : null,
      })),
    );
  }

  async get(eventId: string, personId: string) {
    const person = await this.personRepository.getById(eventId, personId);
    if (!person) {
      throw new NotFoundException('Person not found');
    }
    return {
      id: person.id,
      name: person.name,
      isHidden: person.isHidden,
      thumbnailUrl: person.thumbnailKey
        ? await this.storageRepository.presignGet(person.thumbnailKey, { expiresIn: URL_TTL })
        : null,
    };
  }

  async update(eventId: string, personId: string, dto: UpdatePersonDto) {
    const person = await this.personRepository.getById(eventId, personId);
    if (!person) {
      throw new NotFoundException('Person not found');
    }
    const updated = await this.personRepository.update(eventId, personId, dto);
    return { id: updated.id, name: updated.name, isHidden: updated.isHidden };
  }

  // Pick the face that represents this person. The crop is regenerated in the
  // background, so the new portrait appears once PersonThumbnail runs.
  async setCover(eventId: string, personId: string, faceId: string) {
    const person = await this.personRepository.getById(eventId, personId);
    if (!person) {
      throw new NotFoundException('Person not found');
    }

    // the face must actually belong to this person, or the portrait would
    // show somebody else
    const face = await this.personRepository.getFaceOfPerson(personId, faceId);
    if (!face) {
      throw new BadRequestException('That face does not belong to this person');
    }

    await this.personRepository.update(eventId, personId, { faceAssetFaceId: faceId });
    await this.jobRepository.queue({ name: JobName.PersonThumbnail, data: { personId } });
    return { id: personId, faceAssetFaceId: faceId };
  }

  // Merge `ids` into `personId`: every face moves to the target, the sources
  // are deleted and their thumbnails cleaned up. The target keeps its own name
  // and cover face, so merging into a named person is non-destructive.
  async merge(eventId: string, personId: string, ids: string[]) {
    const target = await this.personRepository.getById(eventId, personId);
    if (!target) {
      throw new NotFoundException('Person not found');
    }

    const sourceIds = [...new Set(ids)].filter((id) => id !== personId);
    if (sourceIds.length === 0) {
      throw new BadRequestException('Nothing to merge');
    }

    // Every source must belong to this event — merging across events would
    // break the per-event isolation the whole face pipeline depends on.
    const sources = [];
    for (const id of sourceIds) {
      const source = await this.personRepository.getById(eventId, id);
      if (!source) {
        throw new NotFoundException(`Person ${id} not found in this event`);
      }
      sources.push(source);
    }

    const moved = await this.personRepository.reassignFacesOfPeople(personId, sourceIds);
    await this.personRepository.delete(sourceIds);

    const keys = sources.map((source) => source.thumbnailKey).filter(Boolean);
    if (keys.length > 0) {
      await this.jobRepository.queue({ name: JobName.CleanupKeys, data: { keys } });
    }

    // If the target had no cover face yet, it does now — regenerate so the
    // merged person shows a portrait instead of a spinner.
    if (!target.faceAssetFaceId || !target.thumbnailKey) {
      await this.jobRepository.queue({ name: JobName.PersonThumbnail, data: { personId } });
    }

    this.logger.log(`Merged ${sourceIds.length} people into ${personId} (${moved} faces moved)`);
    return { id: personId, mergedCount: sourceIds.length, facesMoved: moved };
  }

  // Photos this person appears in. Returns the same shape as the event gallery
  // so the person page can reuse the justified timeline and the viewer.
  async getAssets(eventId: string, personId: string) {
    const person = await this.personRepository.getById(eventId, personId);
    if (!person) {
      throw new NotFoundException('Person not found');
    }

    const assetIds = await this.personRepository.getAssetIdsOfPerson(eventId, personId);
    const assets = await Promise.all(
      assetIds.map(async ({ assetId }) => {
        const asset = await this.assetRepository.getById(eventId, assetId);
        if (!asset) {
          return null;
        }
        const files = await this.assetRepository.getFiles(assetId);
        const thumb = files.find((file) => file.type === AssetFileType.Thumbnail);
        const preview = files.find((file) => file.type === AssetFileType.Preview);
        return {
          id: asset.id,
          type: asset.type,
          status: asset.status,
          originalFilename: asset.originalFilename,
          capturedAt: asset.capturedAt,
          createdAt: asset.createdAt,
          width: asset.width,
          height: asset.height,
          thumbhash: asset.thumbhash ? asset.thumbhash.toString('base64') : null,
          facesDetectedAt: asset.facesDetectedAt,
          faceCount: asset.faceCount,
          thumbUrl: thumb ? await this.storageRepository.presignGet(thumb.storageKey, { expiresIn: URL_TTL }) : null,
          previewUrl: preview
            ? await this.storageRepository.presignGet(preview.storageKey, { expiresIn: URL_TTL })
            : null,
        };
      }),
    );

    // newest first, matching the event gallery's ordering
    return assets
      .filter((asset): asset is NonNullable<typeof asset> => asset !== null)
      .sort((a, b) => {
        const left = (a.capturedAt ?? a.createdAt).valueOf();
        const right = (b.capturedAt ?? b.createdAt).valueOf();
        return right - left;
      });
  }
}
