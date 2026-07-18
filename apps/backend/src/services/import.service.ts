// M5 cloud import pipeline (docs/plan/08 §3, docs/plan/05 §3).
// ImportFolder pages the remote listing (recursing subfolders), upserts
// import_item rows on unique(event_id, provider, remote_id) — incremental
// re-sync — then fans out ImportFile jobs. ImportFile streams the download
// into staging, computes SHA-1, dedupes on (event_id, checksum), stores the
// original to R2 and hands off to the standard AssetProcess pipeline.
// Failures are per-item, never job-fatal (risk R12).
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Insertable } from 'kysely';
import { mkdir, rm, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  AssetSource,
  AssetStatus,
  AssetType,
  CloudProvider,
  ImportItemStatus,
  ImportJobStatus,
  JobName,
  JobStatus,
  QueueName,
} from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { CloudProviderRegistry } from 'src/repositories/cloud-providers';
import { ProviderRateLimitError, RemoteFile } from 'src/repositories/cloud-providers/types';
import { ConfigRepository } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { ImportItem, ImportRepository } from 'src/repositories/import.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { ImportItemTable } from 'src/schema';
import { OnJob } from 'src/decorators';
import { CloudService } from 'src/services/cloud.service';
import { JobOf } from 'src/types';
import { isAssetChecksumConstraint } from 'src/utils/database';
import { StorageKeys } from 'src/utils/storage-keys';

const IMPORTABLE_MIME = /^(image|video)\//;

@Injectable()
export class ImportService {
  private stagingFolder: string;

  constructor(
    private assetRepository: AssetRepository,
    private cloudService: CloudService,
    private configRepository: ConfigRepository,
    private cryptoRepository: CryptoRepository,
    private eventRepository: EventRepository,
    private importRepository: ImportRepository,
    private jobRepository: JobRepository,
    private logger: LoggingRepository,
    private providers: CloudProviderRegistry,
    private storageRepository: StorageRepository,
  ) {
    this.logger.setContext(ImportService.name);
    this.stagingFolder = this.configRepository.getEnv().storage.stagingFolder;
  }

  // --- API surface ---

  async createImport(
    eventId: string,
    dto: { accountId: string; folderId: string; folderName: string; recursive: boolean },
    createdBy: string,
  ) {
    const event = await this.eventRepository.getById(eventId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    const account = await this.cloudService.requireAccount(event.orgId, dto.accountId);

    const job = await this.importRepository.createJob({
      eventId,
      orgId: event.orgId,
      cloudAccountId: account.id,
      provider: account.provider,
      folderRemoteId: dto.folderId,
      folderName: dto.folderName,
      recursive: dto.recursive,
      createdBy,
    });
    await this.jobRepository.queue({ name: JobName.ImportFolder, data: { importJobId: job.id } });
    return this.toProgress(job.id);
  }

  async listByEvent(eventId: string) {
    const jobs = await this.importRepository.listByEvent(eventId);
    return jobs.map((job) => this.progressShape(job));
  }

  async getProgress(eventId: string, importJobId: string) {
    const job = await this.importRepository.getJobScoped(eventId, importJobId);
    if (!job) {
      throw new NotFoundException('Import not found');
    }
    return this.toProgress(job.id);
  }

  async cancel(eventId: string, importJobId: string): Promise<void> {
    const job = await this.importRepository.getJobScoped(eventId, importJobId);
    if (!job) {
      throw new NotFoundException('Import not found');
    }
    if (job.status !== ImportJobStatus.Listing && job.status !== ImportJobStatus.Importing) {
      throw new BadRequestException(`Import is already ${job.status}`);
    }
    await this.importRepository.updateJob(importJobId, { status: ImportJobStatus.Cancelled, finishedAt: new Date() });
  }

  private async toProgress(importJobId: string) {
    const job = (await this.importRepository.getJob(importJobId))!;
    const failedItems = await this.importRepository.failedItems(importJobId);
    return { ...this.progressShape(job), failedItems };
  }

  private progressShape(job: NonNullable<Awaited<ReturnType<ImportRepository['getJob']>>>) {
    return {
      id: job.id,
      provider: job.provider,
      folderName: job.folderName,
      status: job.status,
      totalFiles: job.totalFiles,
      doneFiles: job.doneFiles,
      skippedFiles: job.skippedFiles,
      failedFiles: job.failedFiles,
      error: job.error,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
    };
  }

  // --- ImportFolder: listing + fan-out (concurrency-1 semantics per job) ---

  @OnJob({ name: JobName.ImportFolder, queue: QueueName.Import })
  async handleImportFolder({ importJobId }: JobOf<JobName.ImportFolder>): Promise<JobStatus> {
    const job = await this.importRepository.getJob(importJobId);
    if (!job || job.status === ImportJobStatus.Cancelled) {
      return JobStatus.Skipped;
    }

    try {
      const client = this.providers.get(job.provider);

      let listed = 0;
      let skipped = 0;
      const folderQueue: string[] = [job.folderRemoteId];

      while (folderQueue.length > 0) {
        const folderId = folderQueue.shift()!;
        let pageToken: string | undefined;
        do {
          // re-resolve per page: long listings can outlive one access token
          const account = await this.cloudService.requireAccount(job.orgId, job.cloudAccountId);
          const accessToken = await this.cloudService.getFreshAccessToken(account);
          const page = await client.listFilesPage(accessToken, folderId, pageToken);
          if (job.recursive) {
            folderQueue.push(...page.subfolderIds);
          }

          const media = page.files.filter((file) => IMPORTABLE_MIME.test(file.mimeType));
          const outcome = await this.upsertListingPage(job.id, job.eventId, job.provider, media);
          listed += outcome.listed;
          skipped += outcome.skipped;

          pageToken = page.nextPageToken;
        } while (pageToken);
      }

      const pending = await this.importRepository.pendingItemIds(importJobId);
      await this.importRepository.updateJob(importJobId, {
        status: pending.length > 0 ? ImportJobStatus.Importing : ImportJobStatus.Done,
        totalFiles: listed,
        skippedFiles: skipped,
        ...(pending.length === 0 ? { finishedAt: new Date() } : {}),
      });

      if (pending.length > 0) {
        await this.jobRepository.queueAll(
          pending.map(({ id }) => ({ name: JobName.ImportFile as const, data: { importItemId: id } })),
        );
      }

      this.logger.log(`Import ${importJobId}: listed ${listed} media files (${skipped} already synced, ${pending.length} to fetch)`);
      return JobStatus.Success;
    } catch (error) {
      if (error instanceof ProviderRateLimitError) {
        await this.jobRepository.rateLimitQueue(QueueName.Import, error.retryAfterMs);
        throw this.jobRepository.rateLimitError();
      }
      this.logger.error(`ImportFolder ${importJobId} failed: ${error}`);
      await this.importRepository.updateJob(importJobId, {
        status: ImportJobStatus.Failed,
        error: `${error}`.slice(0, 1000),
        finishedAt: new Date(),
      });
      return JobStatus.Failed;
    }
  }

  // classify one listing page against existing items (incremental re-sync,
  // docs/plan/08 §3 step 3)
  private async upsertListingPage(
    importJobId: string,
    eventId: string,
    provider: CloudProvider,
    files: RemoteFile[],
  ): Promise<{ listed: number; skipped: number }> {
    if (files.length === 0) {
      return { listed: 0, skipped: 0 };
    }

    const existing = await this.importRepository.getExistingByRemoteIds(
      eventId,
      provider,
      files.map((file) => file.id),
    );
    const byRemoteId = new Map(existing.map((item) => [item.remoteId, item]));

    const toInsert: Insertable<ImportItemTable>[] = [];
    let skipped = 0;

    for (const file of files) {
      const known = byRemoteId.get(file.id);
      if (!known) {
        toInsert.push({
          importJobId,
          eventId,
          provider,
          remoteId: file.id,
          remoteName: file.name,
          remoteSize: file.size,
          remoteChecksum: file.checksum,
        });
        continue;
      }

      // "already synced" = the content is present in the event, whether this
      // item imported it (done) or linked an existing asset (skipped_duplicate)
      const alreadySynced =
        known.status === ImportItemStatus.Done || known.status === ImportItemStatus.SkippedDuplicate;
      const unchanged = alreadySynced && known.remoteChecksum === file.checksum && file.checksum !== null;
      if (unchanged) {
        // already imported, same content → count as skipped for this job
        await this.importRepository.repointItem(known.id, importJobId, { status: ImportItemStatus.SkippedDuplicate });
        skipped++;
      } else {
        // changed content or a previous failure → import (again) as pending
        await this.importRepository.repointItem(known.id, importJobId, {
          status: ImportItemStatus.Pending,
          remoteChecksum: file.checksum,
          remoteName: file.name,
          remoteSize: file.size,
          error: null,
        });
      }
    }

    await this.importRepository.insertItems(toInsert);
    return { listed: files.length, skipped };
  }

  // --- ImportFile: download → SHA-1 → dedupe → R2 → AssetProcess ---

  @OnJob({ name: JobName.ImportFile, queue: QueueName.Import })
  async handleImportFile({ importItemId }: JobOf<JobName.ImportFile>): Promise<JobStatus> {
    const item = await this.importRepository.getItem(importItemId);
    if (!item || item.status !== ImportItemStatus.Pending) {
      return JobStatus.Skipped;
    }
    const job = await this.importRepository.getJob(item.importJobId);
    if (!job || job.status === ImportJobStatus.Cancelled) {
      return JobStatus.Skipped;
    }

    const stagingPath = join(this.stagingFolder, `import-${importItemId}`);
    try {
      await this.importRepository.markItem(importItemId, { status: ImportItemStatus.Downloading });

      const account = await this.cloudService.requireAccount(job.orgId, job.cloudAccountId);
      const accessToken = await this.cloudService.getFreshAccessToken(account);
      await mkdir(this.stagingFolder, { recursive: true });
      await this.providers.get(job.provider).downloadToFile(accessToken, item.remoteId, stagingPath);

      const checksum = await this.cryptoRepository.hashFile(stagingPath);
      const size = (await stat(stagingPath)).size;

      // dedupe against manual uploads and earlier imports (docs/plan/08 §3)
      const existing = await this.assetRepository.findByChecksum(job.eventId, checksum);
      if (existing) {
        await this.importRepository.markItem(importItemId, {
          status: ImportItemStatus.SkippedDuplicate,
          assetId: existing.id,
        });
        await this.finishItem(job.id, 'skippedFiles');
        return JobStatus.Success;
      }

      const assetId = this.cryptoRepository.randomUUID();
      const ext = extname(item.remoteName).toLowerCase();
      const mimeType = this.guessMime(item.remoteName);
      const storageKey = StorageKeys.original(job.orgId, job.eventId, assetId, ext);
      await this.storageRepository.putFile(stagingPath, storageKey, mimeType);

      try {
        await this.assetRepository.create({
          id: assetId,
          eventId: job.eventId,
          orgId: job.orgId,
          type: mimeType.startsWith('video/') ? AssetType.Video : AssetType.Image,
          originalFilename: item.remoteName,
          checksum,
          fileSize: size,
          mimeType,
          status: AssetStatus.Stored,
          source: job.provider === CloudProvider.GDrive ? AssetSource.GDrive : AssetSource.OneDrive,
          storageKey,
        });
      } catch (error) {
        if (isAssetChecksumConstraint(error)) {
          await this.storageRepository.deleteKeys([storageKey]).catch(() => undefined);
          const winner = await this.assetRepository.findByChecksum(job.eventId, checksum);
          await this.importRepository.markItem(importItemId, {
            status: ImportItemStatus.SkippedDuplicate,
            assetId: winner?.id ?? null,
          });
          await this.finishItem(job.id, 'skippedFiles');
          return JobStatus.Success;
        }
        throw error;
      }

      await this.jobRepository.queue({ name: JobName.AssetProcess, data: { assetId } });
      await this.importRepository.markItem(importItemId, { status: ImportItemStatus.Done, assetId });
      await this.finishItem(job.id, 'doneFiles');
      return JobStatus.Success;
    } catch (error) {
      if (error instanceof ProviderRateLimitError) {
        await this.importRepository.markItem(importItemId, { status: ImportItemStatus.Pending });
        await this.jobRepository.rateLimitQueue(QueueName.Import, error.retryAfterMs);
        throw this.jobRepository.rateLimitError();
      }
      // per-item failure, never job-fatal (risk R12)
      this.logger.error(`ImportFile ${importItemId} (${item.remoteName}) failed: ${error}`);
      await this.importRepository.markItem(importItemId, {
        status: ImportItemStatus.Failed,
        error: `${error}`.slice(0, 1000),
      });
      await this.finishItem(job.id, 'failedFiles');
      return JobStatus.Success;
    } finally {
      await rm(stagingPath, { force: true }).catch(() => undefined);
    }
  }

  private async finishItem(importJobId: string, counter: 'doneFiles' | 'skippedFiles' | 'failedFiles'): Promise<void> {
    const finished = await this.importRepository.bumpCounter(importJobId, counter);
    if (finished) {
      const job = await this.importRepository.getJob(importJobId);
      if (job && job.status === ImportJobStatus.Importing) {
        await this.importRepository.updateJob(importJobId, { status: ImportJobStatus.Done, finishedAt: new Date() });
        this.logger.log(`Import ${importJobId} (${job.folderName}) done`);
      }
    }
  }

  private guessMime(filename: string): string {
    const ext = extname(filename).toLowerCase();
    const map: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.heic': 'image/heic',
      '.bmp': 'image/bmp',
      '.tif': 'image/tiff',
      '.tiff': 'image/tiff',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.mkv': 'video/x-matroska',
      '.webm': 'video/webm',
      '.avi': 'video/x-msvideo',
    };
    return map[ext] ?? 'application/octet-stream';
  }
}
