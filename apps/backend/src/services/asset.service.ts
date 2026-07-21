import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import archiver from 'archiver';
import { Response } from 'express';
import { AssetJobDto } from 'src/dtos/asset.dto';
import { AssetFileType, AssetStatus, JobName } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { JobItem } from 'src/types';
import { toFaceBoxes } from 'src/utils/face-box';

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
    facesDetectedAt: Date | null;
    faceCount: number;
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

  async list(
    eventId: string,
    limit: number,
    cursor?: string,
    faceStatus?: 'pending' | 'found' | 'none',
  ): Promise<AssetListResponse> {
    const decoded = cursor ? this.decodeCursor(cursor) : undefined;
    // fetch one extra row to know whether another page exists
    const rows = await this.assetRepository.list(eventId, {
      limit: limit + 1,
      cursorCapturedAt: decoded?.capturedAt,
      cursorId: decoded?.id,
      faceStatus,
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
        facesDetectedAt: row.facesDetectedAt,
        faceCount: row.faceCount,
      })),
    );

    const last = page.at(-1);
    return {
      assets,
      nextCursor: hasMore && last ? this.encodeCursor(last.capturedAt, last.id) : null,
    };
  }

  // Random sample for an event's Memories slideshow — the auto-advancing
  // strip picks a handful of photos at random rather than the newest N, so it
  // reads as a highlight reel instead of "recently uploaded" again.
  async randomForEvent(eventId: string, limit: number): Promise<AssetListResponse['assets']> {
    const rows = await this.assetRepository.getRandomForEvent(eventId, limit);
    return Promise.all(
      rows.map(async (row) => ({
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
        facesDetectedAt: row.facesDetectedAt,
        faceCount: row.faceCount,
      })),
    );
  }

  // Hydrate an ordered list of asset ids (from the similar-photo vector
  // search) into the gallery DTO, preserving the ranked order.
  async listByIds(eventId: string, ids: string[]): Promise<AssetListResponse['assets']> {
    const rows = await this.assetRepository.listByIds(eventId, ids);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = ids.map((id) => byId.get(id)).filter((row): row is (typeof rows)[number] => row !== undefined);
    return Promise.all(
      ordered.map(async (row) => ({
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
        facesDetectedAt: row.facesDetectedAt,
        faceCount: row.faceCount,
      })),
    );
  }

  // Org-wide Photos timeline: every event's photos in one date-ordered stream.
  // Each item carries its event so the UI can label and link back to it.
  async listForOrg(orgId: string, limit: number, cursor?: string) {
    const decoded = cursor ? this.decodeCursor(cursor) : undefined;
    const rows = await this.assetRepository.listForOrg(orgId, {
      limit: limit + 1,
      cursorCapturedAt: decoded?.capturedAt,
      cursorId: decoded?.id,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const assets = await Promise.all(
      page.map(async (row) => ({
        id: row.id,
        eventId: row.eventId,
        eventName: row.eventName,
        type: row.type,
        status: row.status,
        originalFilename: row.originalFilename,
        capturedAt: row.capturedAt,
        createdAt: row.createdAt,
        width: row.width,
        height: row.height,
        thumbhash: row.thumbhash ? row.thumbhash.toString('base64') : null,
        thumbUrl: row.thumbKey
          ? await this.storageRepository.presignGet(row.thumbKey, { expiresIn: LIST_URL_TTL })
          : null,
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

  // Map markers for the org-wide Map tab: every geotagged photo's coordinates
  // plus which event it belongs to, so a marker click can open that gallery.
  async getMapMarkers(orgId: string) {
    const rows = await this.assetRepository.getMapMarkersForOrg(orgId);
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        eventId: row.eventId,
        lat: row.lat,
        lon: row.lon,
        thumbUrl: row.thumbKey
          ? await this.storageRepository.presignGet(row.thumbKey, { expiresIn: LIST_URL_TTL })
          : null,
      })),
    );
  }

  async get(eventId: string, assetId: string) {
    const asset = await this.assetRepository.getById(eventId, assetId);
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }
    const [files, exif, people, faces] = await Promise.all([
      this.assetRepository.getFiles(assetId),
      this.assetRepository.getExif(assetId),
      this.assetRepository.getPeople(assetId),
      this.assetRepository.getFaces(assetId),
    ]);

    return {
      ...asset,
      checksum: asset.checksum.toString('hex'),
      thumbhash: asset.thumbhash ? asset.thumbhash.toString('base64') : null,
      files: files.map((file) => ({ type: file.type, width: file.width, height: file.height, format: file.format })),
      faces: toFaceBoxes(faces),
      exif: exif ?? null,
      people: await Promise.all(
        people.map(async (person) => ({
          id: person.id,
          name: person.name,
          thumbnailUrl: person.thumbnailKey
            ? await this.storageRepository.presignGet(person.thumbnailKey, { expiresIn: LIST_URL_TTL })
            : null,
        })),
      ),
    };
  }

  // Same-origin proxy for pixel-reading features (copy-to-clipboard, the
  // crop/rotate editor): both draw the image into a canvas, which the browser
  // taints for any cross-origin source unless the response carries CORS
  // headers — and R2 has none configured (docs/plan/04 §CORS). Streaming the
  // bytes through our own API sidesteps that without touching bucket config.
  async streamPreview(eventId: string, assetId: string, res: Response): Promise<void> {
    const asset = await this.assetRepository.getById(eventId, assetId);
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }
    const files = await this.assetRepository.getFiles(assetId);
    const preview =
      files.find((file) => file.type === AssetFileType.Preview) ??
      files.find((file) => file.type === AssetFileType.Thumbnail);
    if (!preview) {
      throw new NotFoundException('No preview available yet');
    }
    const stream = await this.storageRepository.getStream(preview.storageKey);
    res.setHeader('Content-Type', preview.format ? `image/${preview.format}` : 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    stream.pipe(res);
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

  // Multi-select download: one streamed zip, store-only (media is already
  // compressed), duplicate filenames suffixed — same shape as the participant
  // gallery's zip.
  async streamZip(eventId: string, ids: string[], response: Response): Promise<void> {
    const event = await this.eventRepository.getById(eventId);
    const archive = archiver('zip', { zlib: { level: 0 } });

    const safeName = (event?.name ?? 'photos').replaceAll(/[^\w\- ]+/g, '').trim() || 'photos';
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);
    archive.pipe(response);

    const used = new Set<string>();
    for (const assetId of ids) {
      const asset = await this.assetRepository.getById(eventId, assetId);
      if (!asset) {
        continue; // silently skip ids from another event
      }
      let name = asset.originalFilename;
      for (let counter = 2; used.has(name); counter++) {
        const dot = asset.originalFilename.lastIndexOf('.');
        name =
          dot > 0
            ? `${asset.originalFilename.slice(0, dot)} (${counter})${asset.originalFilename.slice(dot)}`
            : `${asset.originalFilename} (${counter})`;
      }
      used.add(name);
      archive.append(await this.storageRepository.getStream(asset.storageKey), { name });
    }

    await archive.finalize();
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
    // Only the derivative job rewinds the asset's status. Re-running face jobs
    // must not flip a processed asset back to "stored", or the gallery shows a
    // permanent "processing…" badge and never stops polling.
    if (dto.name === 'thumbnails') {
      await this.assetRepository.setStatus(assetId, AssetStatus.Stored);
    }
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
