// Org-facing People/cluster review (docs/plan/09 §People).
import { Injectable, NotFoundException } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { AssetFileType } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
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

@Injectable()
export class PersonService {
  constructor(
    private assetRepository: AssetRepository,
    private personRepository: PersonRepository,
    private storageRepository: StorageRepository,
  ) {}

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

  async update(eventId: string, personId: string, dto: UpdatePersonDto) {
    const person = await this.personRepository.getById(eventId, personId);
    if (!person) {
      throw new NotFoundException('Person not found');
    }
    const updated = await this.personRepository.update(eventId, personId, dto);
    return { id: updated.id, name: updated.name, isHidden: updated.isHidden };
  }

  // Photos this person appears in, with presigned thumbs (People detail page).
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
        return {
          id: asset.id,
          originalFilename: asset.originalFilename,
          capturedAt: asset.capturedAt,
          thumbUrl: thumb ? await this.storageRepository.presignGet(thumb.storageKey, { expiresIn: URL_TTL }) : null,
        };
      }),
    );
    return assets.filter(Boolean);
  }
}
