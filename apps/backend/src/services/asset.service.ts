import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AssetJobDto } from 'src/dtos/asset.dto';
import { AssetStatus, JobName } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { JobItem } from 'src/types';

const LIST_URL_TTL = 3600; // 1 h presigned (docs/plan/04 §5)
const DOWNLOAD_URL_TTL = 900; // 15 min

export interface AssetListResponse {
  assets: {
    id: string;
    type: string;
    status: string;
    originalFilename: string;
    capturedAt: Date | null;
    createdAt: Date;
    width: number | null;
    height: number | null;
    thumbhash: string | null;
    thumbUrl: string | null;
    previewUrl: string | null;
  }[];
  nextCursor: string | null;
}

@Injectable()
export class AssetService {
  constructor(
    private assetRepository: AssetRepository,
    private eventRepository: EventRepository,
    private jobRepository: JobRepository,
    private storageRepository: StorageRepository,
  ) {}

  async list(eventId: string, limit: number, cursor?: string): Promise<AssetListResponse> {
    const decoded = cursor ? this.decodeCursor(cursor) : undefined;
    // fetch one extra row to know whether another page exists
    const rows = await this.assetRepository.list(eventId, {
      limit: limit + 1,
      cursorCapturedAt: decoded?.capturedAt,
      cursorId: decoded?.id,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const assets = await Promise.all(
      page.map(async (row) => ({
        id: row.id,
        type: row.type,
        status: row.status,
        originalFilename: row.originalFilename,
        capturedAt: row.capturedAt,
        createdAt: row.createdAt,
        width: row.width,
        height: row.height,
        thumbhash: row.thumbhash ? row.thumbhash.toString('base64') : null,
        thumbUrl: row.thumbKey ? await this.storageRepository.presignGet(row.thumbKey, { expiresIn: LIST_URL_TTL }) : null,
        previewUrl: row.previewKey
          ? await this.storageRepository.presignGet(row.previewKey, { expiresIn: LIST_URL_TTL })
          : null,
      })),
    );

    const last = page.at(-1);
    return {
      assets,
      nextCursor: hasMore && last ? this.encodeCursor(last.capturedAt, last.id) : null,
    };
  }

  async get(eventId: string, assetId: string) {
    const asset = await this.assetRepository.getById(eventId, assetId);
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }
    const files = await this.assetRepository.getFiles(assetId);
    return {
      ...asset,
      checksum: asset.checksum.toString('hex'),
      thumbhash: asset.thumbhash ? asset.thumbhash.toString('base64') : null,
      files: files.map((file) => ({ type: file.type, width: file.width, height: file.height, format: file.format })),
    };
  }

  async getDownloadUrl(eventId: string, assetId: string): Promise<string> {
    const asset = await this.assetRepository.getById(eventId, assetId);
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }
    return this.storageRepository.presignGet(asset.storageKey, {
      expiresIn: DOWNLOAD_URL_TTL,
      filename: asset.originalFilename,
    });
  }

  async deleteMany(eventId: string, ids: string[]): Promise<{ deleted: number }> {
    const deleted = await this.assetRepository.softDeleteMany(eventId, ids);
    // collect derivative keys and queue R2 cleanup (docs/plan/04 §6)
    const keys: string[] = [];
    for (const asset of deleted) {
      keys.push(asset.storageKey);
      const files = await this.assetRepository.getFiles(asset.id);
      keys.push(...files.map((file) => file.storageKey));
    }
    if (keys.length > 0) {
      await this.jobRepository.queue({ name: JobName.CleanupKeys, data: { keys } });
    }
    return { deleted: deleted.length };
  }

  async runJob(eventId: string, assetId: string, dto: AssetJobDto): Promise<void> {
    const asset = await this.assetRepository.getById(eventId, assetId);
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }
    let item: JobItem;
    switch (dto.name) {
      case 'thumbnails': {
        item = { name: JobName.AssetProcess, data: { assetId } };
        break;
      }
      case 'faceDetection': {
        item = { name: JobName.FaceDetect, data: { assetId } };
        break;
      }
      case 'facialRecognition': {
        item = { name: JobName.FaceRecognizeQueueAll, data: { eventId, force: dto.force } };
        break;
      }
      default: {
        throw new BadRequestException(`Unknown job: ${dto.name}`);
      }
    }
    await this.assetRepository.setStatus(assetId, AssetStatus.Stored);
    await this.jobRepository.queue(item);
  }

  private encodeCursor(capturedAt: Date | null, id: string): string {
    return Buffer.from(JSON.stringify({ c: capturedAt?.toISOString() ?? null, i: id })).toString('base64url');
  }

  private decodeCursor(cursor: string): { capturedAt: Date | null; id: string } {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      return { capturedAt: parsed.c ? new Date(parsed.c) : null, id: parsed.i };
    } catch {
      throw new BadRequestException('Invalid cursor');
    }
  }
}
