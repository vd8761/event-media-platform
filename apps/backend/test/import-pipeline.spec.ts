// M5 import-pipeline integration test (docs/plan/08, M5 acceptance in
// docs/plan/12): runs the REAL ImportFolder/ImportFile handlers and REAL
// repositories against Postgres, with the provider API and R2 stubbed.
// Covers: listing fan-out, mimetype filtering, recursive subfolders,
// manual-upload dedupe linking, per-item state, counters, job completion,
// and incremental re-sync (second import skips everything).
import { CamelCasePlugin, Kysely, Migrator, PostgresDialect } from 'kysely';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { AssetSource, CloudProvider, ImportItemStatus, ImportJobStatus, JobName, JobStatus } from 'src/enum';
import { StaticMigrationProvider } from 'src/migrations';
import { AssetRepository } from 'src/repositories/asset.repository';
import { CloudAccountRepository } from 'src/repositories/cloud-account.repository';
import { CloudProviderRegistry } from 'src/repositories/cloud-providers';
import {
  CloudProviderClient,
  OAuthTokens,
  RemoteFile,
  RemoteFolder,
  RemoteListingPage,
} from 'src/repositories/cloud-providers/types';
import { ConfigRepository, clearEnvCache } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { ImportRepository } from 'src/repositories/import.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { CipherService } from 'src/services/cipher.service';
import { CloudService } from 'src/services/cloud.service';
import { ImportService } from 'src/services/import.service';
import { JobItem } from 'src/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminConnectionOptions, testDatabaseUrl } from './database-url';

const TEST_DB = 'eventlens_test_import';

const fileBytes = (id: string) => Buffer.from(`image-bytes-of-${id}`);
const fileSha1 = (id: string) => createHash('sha1').update(fileBytes(id)).digest();

// fabricated Drive: root has 3 images + 1 doc (filtered) + subfolder with 2 more
class StubProvider implements CloudProviderClient {
  readonly scopes = ['stub'];
  downloads: string[] = [];

  private tree: Record<string, { files: RemoteFile[]; subfolders: string[] }> = {
    'folder-root': {
      files: [
        { id: 'f1', name: 'a.jpg', size: 10, checksum: 'ck-f1', mimeType: 'image/jpeg' },
        { id: 'f2', name: 'b.jpg', size: 10, checksum: 'ck-f2', mimeType: 'image/jpeg' },
        { id: 'f3', name: 'c.png', size: 10, checksum: 'ck-f3', mimeType: 'image/png' },
        { id: 'f4', name: 'notes.pdf', size: 10, checksum: 'ck-f4', mimeType: 'application/pdf' },
      ],
      subfolders: ['folder-sub'],
    },
    'folder-sub': {
      files: [
        { id: 'f5', name: 'd.jpg', size: 10, checksum: 'ck-f5', mimeType: 'image/jpeg' },
        { id: 'f6', name: 'e.mp4', size: 10, checksum: 'ck-f6', mimeType: 'video/mp4' },
      ],
      subfolders: [],
    },
  };

  authorizeUrl(): string {
    return 'https://stub/authorize';
  }
  async exchangeCode(): Promise<OAuthTokens> {
    return { accessToken: 'at', refreshToken: 'rt', expiresInSec: 3600 };
  }
  async refresh(): Promise<OAuthTokens> {
    return { accessToken: 'at2', expiresInSec: 3600 };
  }
  async getAccountEmail(): Promise<string> {
    return 'stub@drive.test';
  }
  async listFolders(): Promise<RemoteFolder[]> {
    return [{ id: 'folder-root', name: 'Photos', hasChildren: true }];
  }
  async listFilesPage(_token: string, folderId: string): Promise<RemoteListingPage> {
    const node = this.tree[folderId] ?? { files: [], subfolders: [] };
    return { files: node.files, subfolderIds: node.subfolders };
  }
  async downloadToFile(_token: string, fileId: string, destPath: string): Promise<void> {
    this.downloads.push(fileId);
    writeFileSync(destPath, fileBytes(fileId));
  }
}

class FakeJobRepository {
  items: JobItem[] = [];
  async queue(item: JobItem) {
    this.items.push(item);
  }
  async queueAll(items: JobItem[]) {
    this.items.push(...items);
  }
  async rateLimitQueue() {}
  rateLimitError() {
    return new Error('rate-limited');
  }
  take(name: JobName): JobItem[] {
    const matched = this.items.filter((item) => item.name === name);
    this.items = this.items.filter((item) => item.name !== name);
    return matched;
  }
}

class FakeStorageRepository {
  keys: string[] = [];
  async putFile(_local: string, key: string) {
    this.keys.push(key);
  }
  async deleteKeys() {}
}

describe('cloud import pipeline (M5)', () => {
  let db: Kysely<DB>;
  let importService: ImportService;
  let importRepository: ImportRepository;
  let assetRepository: AssetRepository;
  let stub: StubProvider;
  let jobs: FakeJobRepository;
  let storage: FakeStorageRepository;

  let orgId: string;
  let eventId: string;
  let accountId: string;
  let ownerId: string;

  beforeAll(async () => {
    const admin = new pg.Client(adminConnectionOptions());
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    await admin.end();

    process.env.DATABASE_URL = testDatabaseUrl(TEST_DB);
    process.env.EL_ENV = 'development';
    process.env.EL_STAGING_FOLDER = mkdtempSync(join(tmpdir(), 'el-import-'));
    clearEnvCache();

    db = new Kysely<DB>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({ connectionString: testDatabaseUrl(TEST_DB) }),
      }),
      plugins: [new CamelCasePlugin()],
    });
    const migrator = new Migrator({ db: db as Kysely<unknown>, provider: new StaticMigrationProvider() });
    const { error } = await migrator.migrateToLatest();
    if (error) {
      throw error;
    }

    const configRepository = new ConfigRepository();
    const logger = new LoggingRepository(configRepository);
    const cryptoRepository = new CryptoRepository();
    const cipherService = new CipherService(configRepository, cryptoRepository);
    const cloudAccountRepository = new CloudAccountRepository(db);
    const eventRepository = new EventRepository(db);
    importRepository = new ImportRepository(db);
    assetRepository = new AssetRepository(db);

    stub = new StubProvider();
    const registry = new CloudProviderRegistry(configRepository);
    registry.setClient(CloudProvider.GDrive, stub);

    jobs = new FakeJobRepository();
    storage = new FakeStorageRepository();

    const cloudService = new CloudService(
      cipherService,
      cloudAccountRepository,
      configRepository,
      cryptoRepository,
      logger,
      registry,
    );

    importService = new ImportService(
      assetRepository,
      cloudService,
      configRepository,
      cryptoRepository,
      eventRepository,
      importRepository,
      jobs as any,
      logger,
      registry,
      storage as any,
    );

    // seed org / owner / event / connected account (fresh access token)
    const owner = await db
      .insertInto('user')
      .values({ email: 'imp@test.test', password: 'x', name: 'Imp' })
      .returning('id')
      .executeTakeFirstOrThrow();
    ownerId = owner.id;
    const org = await db
      .insertInto('organization')
      .values({ name: 'Import Org', slug: 'import-org' })
      .returning('id')
      .executeTakeFirstOrThrow();
    orgId = org.id;
    const event = await db
      .insertInto('event')
      .values({ orgId, name: 'Import Event', slug: 'import-event' })
      .returning('id')
      .executeTakeFirstOrThrow();
    eventId = event.id;
    const account = await cloudAccountRepository.upsert({
      orgId,
      provider: CloudProvider.GDrive,
      accountEmail: 'stub@drive.test',
      refreshTokenEnc: cipherService.encrypt('refresh-token'),
      accessTokenEnc: cipherService.encrypt('access-token'),
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      scopes: ['stub'],
      createdBy: null,
    });
    accountId = account.id;

    // a manual upload that collides with stub file f2 → import must link, not duplicate
    await db
      .insertInto('asset')
      .values({
        eventId,
        orgId,
        type: 'image' as any,
        originalFilename: 'manual-b.jpg',
        checksum: fileSha1('f2'),
        fileSize: 10,
        mimeType: 'image/jpeg',
        source: 'upload' as any,
        storageKey: 'manual/b.jpg',
      })
      .execute();
  });

  afterAll(async () => {
    await db?.destroy();
  });

  let importJobId: string;

  it('creates the import and lists recursively with mimetype filtering', async () => {
    const progress = await importService.createImport(
      eventId,
      { accountId, folderId: 'folder-root', folderName: 'Photos', recursive: true },
      ownerId,
    );
    importJobId = progress.id;

    const queued = jobs.take(JobName.ImportFolder);
    expect(queued).toHaveLength(1);

    const status = await importService.handleImportFolder({ importJobId });
    expect(status).toBe(JobStatus.Success);

    const job = (await importRepository.getJob(importJobId))!;
    expect(job.status).toBe(ImportJobStatus.Importing);
    expect(job.totalFiles).toBe(5); // 6 listed, notes.pdf filtered out

    const fileJobs = jobs.take(JobName.ImportFile);
    expect(fileJobs).toHaveLength(5);
  });

  it('downloads, dedupes against the manual upload, and completes the job', async () => {
    const pending = await db
      .selectFrom('importItem')
      .selectAll()
      .where('importJobId', '=', importJobId)
      .execute();

    for (const item of pending) {
      const status = await importService.handleImportFile({ importItemId: item.id });
      expect(status).toBe(JobStatus.Success);
    }

    const job = (await importRepository.getJob(importJobId))!;
    expect(job.status).toBe(ImportJobStatus.Done);
    expect(job.doneFiles).toBe(4); // f1, f3, f5, f6
    expect(job.skippedFiles).toBe(1); // f2 deduped against the manual upload
    expect(job.failedFiles).toBe(0);

    // the deduped item links the EXISTING asset (docs/plan/08 §3 step 2)
    const dedupedItem = await db
      .selectFrom('importItem')
      .selectAll()
      .where('remoteId', '=', 'f2')
      .executeTakeFirstOrThrow();
    expect(dedupedItem.status).toBe(ImportItemStatus.SkippedDuplicate);
    const manual = await assetRepository.findByChecksum(eventId, fileSha1('f2'));
    expect(dedupedItem.assetId).toBe(manual!.id);
    expect(manual!.source).toBe('upload'); // untouched

    // imported assets exist with the provider source + AssetProcess queued
    const processJobs = jobs.take(JobName.AssetProcess);
    expect(processJobs).toHaveLength(4);
    const imported = await assetRepository.findByChecksum(eventId, fileSha1('f1'));
    expect(imported?.source).toBe(AssetSource.GDrive);
    expect(storage.keys.some((key) => key.includes(imported!.id))).toBe(true);
  });

  it('incremental re-sync: re-importing the same folder skips everything', async () => {
    stub.downloads = [];
    const progress = await importService.createImport(
      eventId,
      { accountId, folderId: 'folder-root', folderName: 'Photos', recursive: true },
      ownerId,
    );
    jobs.take(JobName.ImportFolder);

    const status = await importService.handleImportFolder({ importJobId: progress.id });
    expect(status).toBe(JobStatus.Success);

    const job = (await importRepository.getJob(progress.id))!;
    expect(job.status).toBe(ImportJobStatus.Done); // nothing to fetch
    expect(job.totalFiles).toBe(5);
    expect(job.skippedFiles).toBe(5);
    expect(jobs.take(JobName.ImportFile)).toHaveLength(0);
    expect(stub.downloads).toHaveLength(0); // zero bytes re-downloaded
  });

  it('changed remote checksum re-imports as a new pending item', async () => {
    // simulate the remote file being replaced
    (stub as any).tree['folder-sub'].files[0].checksum = 'ck-f5-CHANGED';

    const progress = await importService.createImport(
      eventId,
      { accountId, folderId: 'folder-root', folderName: 'Photos', recursive: true },
      ownerId,
    );
    jobs.take(JobName.ImportFolder);
    await importService.handleImportFolder({ importJobId: progress.id });

    const job = (await importRepository.getJob(progress.id))!;
    expect(job.status).toBe(ImportJobStatus.Importing);
    expect(job.skippedFiles).toBe(4);
    expect(jobs.take(JobName.ImportFile)).toHaveLength(1); // only the changed file
  });

  it('cancel stops further downloads', async () => {
    const activeJob = await db
      .selectFrom('importJob')
      .selectAll()
      .where('status', '=', ImportJobStatus.Importing)
      .executeTakeFirstOrThrow();
    await importService.cancel(eventId, activeJob.id);

    const item = await db
      .selectFrom('importItem')
      .selectAll()
      .where('importJobId', '=', activeJob.id)
      .where('status', '=', ImportItemStatus.Pending)
      .executeTakeFirstOrThrow();
    const status = await importService.handleImportFile({ importItemId: item.id });
    expect(status).toBe(JobStatus.Skipped);
  });
});
