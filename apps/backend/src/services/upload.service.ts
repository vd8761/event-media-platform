// Through-API upload (Decision D5, docs/plan/04-storage-r2.md §3). Pattern from
// immich:server/src/services/asset-media.service.ts uploadAsset + bulkUploadCheck.
// The (event_id, checksum) unique index is the final arbiter — on unique
// violation the handler answers 'duplicate' (constraint helper ported from
// immich:server/src/utils/database.ts).
import { Injectable, NotFoundException } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import { extname } from 'node:path';
import { StagedUpload } from 'src/middleware/file-upload.interceptor';
import { AssetSource, AssetStatus, AssetType, JobName } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { QuotaService } from 'src/services/quota.service';
import { StorageKeys } from 'src/utils/storage-keys';
import { isAssetChecksumConstraint } from 'src/utils/database';

export interface UploadResult {
  id: string;
  status: 'created' | 'duplicate';
}

@Injectable()
export class UploadService {
  constructor(
    private assetRepository: AssetRepository,
    private eventRepository: EventRepository,
    private jobRepository: JobRepository,
    private logger: LoggingRepository,
    private quotaService: QuotaService,
    private storageRepository: StorageRepository,
  ) {
    this.logger.setContext(UploadService.name);
  }

  async uploadAsset(eventId: string, staged: StagedUpload): Promise<UploadResult> {
    const event = await this.eventRepository.getById(eventId);
    if (!event) {
      await this.discard(staged.stagingPath);
      throw new NotFoundException('Event not found');
    }

    // fast-path dedupe before touching R2 (Immich DUPLICATE pattern)
    const existing = await this.assetRepository.findByChecksum(eventId, staged.checksum);
    if (existing) {
      await this.discard(staged.stagingPath);
      return { id: existing.id, status: 'duplicate' };
    }

    // Quota is checked after dedupe on purpose: re-uploading a photo the org
    // already has costs no new storage, so it must not be refused for being
    // over the limit. Checked before the R2 put, so a rejected upload never
    // leaves an orphaned object behind.
    try {
      await this.quotaService.assertStorageAvailable(event.orgId, staged.size);
    } catch (error) {
      await this.discard(staged.stagingPath);
      throw error;
    }

    const assetId = crypto.randomUUID();
    const ext = extname(staged.originalFilename).toLowerCase();
    const storageKey = StorageKeys.original(event.orgId, eventId, assetId, ext);
    const type = staged.mimeType.startsWith('video/') ? AssetType.Video : AssetType.Image;

    await this.storageRepository.putFile(staged.stagingPath, storageKey, staged.mimeType);

    try {
      const asset = await this.assetRepository.create({
        id: assetId,
        eventId,
        orgId: event.orgId,
        type,
        originalFilename: staged.originalFilename,
        checksum: staged.checksum,
        fileSize: staged.size,
        mimeType: staged.mimeType,
        status: AssetStatus.Stored,
        source: AssetSource.Upload,
        storageKey,
      });

      await this.discard(staged.stagingPath);
      await this.jobRepository.queue({ name: JobName.AssetProcess, data: { assetId: asset.id } });
      return { id: asset.id, status: 'created' };
    } catch (error) {
      // race: another request inserted the same (event_id, checksum) first
      if (isAssetChecksumConstraint(error)) {
        await this.storageRepository.deleteKeys([storageKey]).catch(() => undefined);
        await this.discard(staged.stagingPath);
        const winner = await this.assetRepository.findByChecksum(eventId, staged.checksum);
        if (winner) {
          return { id: winner.id, status: 'duplicate' };
        }
      }
      throw error;
    }
  }

  // Browser preflight (docs/plan/04 §3, step 2): known duplicates are never sent.
  async bulkUploadCheck(eventId: string, assets: { id: string; checksum: string }[]) {
    const checksums = assets.map((asset) => Buffer.from(asset.checksum, 'hex'));
    const existing = await this.assetRepository.existingChecksums(eventId, checksums);
    return {
      results: assets.map((asset) => {
        const assetId = existing.get(Buffer.from(asset.checksum, 'hex').toString('hex'));
        return assetId
          ? { id: asset.id, action: 'reject' as const, reason: 'duplicate' as const, assetId }
          : { id: asset.id, action: 'accept' as const };
      }),
    };
  }

  private async discard(stagingPath: string): Promise<void> {
    await unlink(stagingPath).catch(() => undefined);
  }
}
