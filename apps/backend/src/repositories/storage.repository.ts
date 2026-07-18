// R2 (S3-compatible) object storage — replaces Immich's filesystem storage.core
// entirely (docs/plan/04-storage-r2.md §1). Presigning is a local HMAC
// computation (no network round-trip), so it is safe to call inline for every
// asset in a list response.
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { ConfigRepository } from 'src/repositories/config.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';

const DELETE_BATCH = 1000;

@Injectable()
export class StorageRepository {
  private client: S3Client;
  private bucket: string;

  constructor(
    configRepository: ConfigRepository,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(StorageRepository.name);
    const { r2 } = configRepository.getEnv().storage;
    this.bucket = r2.bucket;
    this.client = new S3Client({
      endpoint: r2.endpoint,
      region: 'auto',
      forcePathStyle: true,
      credentials:
        r2.accessKeyId && r2.secretAccessKey
          ? { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey }
          : undefined,
    });
  }

  // lib-storage multipart handles large videos without buffering in memory
  async putFile(localPath: string, key: string, contentType: string): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: createReadStream(localPath), ContentType: contentType },
    });
    await upload.done();
  }

  async putBuffer(buffer: Buffer, key: string, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: contentType }),
    );
  }

  async downloadToFile(key: string, localPath: string): Promise<void> {
    await mkdir(dirname(localPath), { recursive: true });
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    await pipeline(response.Body as Readable, createWriteStream(localPath));
  }

  // zip streaming (gallery download-all, docs/plan/07 §4)
  async getStream(key: string): Promise<Readable> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return response.Body as Readable;
  }

  presignGet(key: string, opts: { expiresIn: number; filename?: string }): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: opts.filename ? `attachment; filename="${opts.filename}"` : undefined,
    });
    return getSignedUrl(this.client, command, { expiresIn: opts.expiresIn });
  }

  async deleteKeys(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += DELETE_BATCH) {
      const batch = keys.slice(i, i + DELETE_BATCH);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
  }

  async deletePrefix(prefix: string): Promise<void> {
    let continuationToken: string | undefined;
    do {
      const list = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: continuationToken }),
      );
      const keys = (list.Contents ?? []).map((object) => object.Key!).filter(Boolean);
      if (keys.length > 0) {
        await this.deleteKeys(keys);
      }
      continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (continuationToken);
  }
}
