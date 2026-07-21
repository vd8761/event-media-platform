// Ported from immich:server/src/middleware/file-upload.interceptor.ts, trimmed
// to the single `assetData` field. Custom multer storage streams the body to a
// local staging file while computing SHA-1 inline — a *trusted* checksum a
// presigned PUT could not enforce (Decision D5, docs/plan/04-storage-r2.md §3).
import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { transformException } from '@nestjs/platform-express/multer/multer/multer.utils';
import { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream';
import { Observable } from 'rxjs';
import { ConfigRepository } from 'src/repositories/config.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';

export const ASSET_UPLOAD_FIELD = 'assetData';
export const SELFIE_UPLOAD_FIELD = 'selfie';
// A participant may submit up to three photos of themselves; all are treated
// as the same person (migration 0011).
export const MAX_SELFIES = 3;

// image/* and video/* only; the selfie field additionally rejects video in
// the public service (docs/plan/07 §2)
const ACCEPTED_MIME = /^(image|video)\//;

export interface StagedUpload {
  stagingPath: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  checksum: Buffer;
}

interface Callback<T> {
  (error: Error): void;
  (error: null, result: T): void;
}

@Injectable()
export class FileUploadInterceptor implements NestInterceptor {
  private handler: ReturnType<multer.Multer['fields']>;
  private stagingFolder: string;

  constructor(
    configRepository: ConfigRepository,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(FileUploadInterceptor.name);
    this.stagingFolder = configRepository.getEnv().storage.stagingFolder;
    // ensure once up front — the per-file handler must stay synchronous so the
    // hash listener and pipeline attach in the same tick (see handleFile)
    mkdirSync(this.stagingFolder, { recursive: true });

    const instance = multer({
      fileFilter: this.fileFilter.bind(this),
      storage: {
        _handleFile: this.handleFile.bind(this),
        _removeFile: this.removeFile.bind(this),
      },
    });
    this.handler = instance.fields([
      { name: ASSET_UPLOAD_FIELD, maxCount: 1 },
      { name: SELFIE_UPLOAD_FIELD, maxCount: MAX_SELFIES },
    ]);
  }

  async intercept(context: ExecutionContext, next: CallHandler<any>): Promise<Observable<any>> {
    const http = context.switchToHttp();
    await new Promise<void>((resolve, reject) => {
      const done: NextFunction = (error) => {
        if (!error) {
          return resolve();
        }
        // multer reports a busted maxCount as "Unexpected field", which tells
        // an API caller nothing about what the actual limit is.
        if ((error as { code?: string }).code === 'LIMIT_UNEXPECTED_FILE') {
          const field = (error as { field?: string }).field;
          if (field === SELFIE_UPLOAD_FIELD) {
            return reject(new BadRequestException(`Please submit at most ${MAX_SELFIES} photos`));
          }
        }
        reject(transformException(error));
      };
      this.handler(http.getRequest(), http.getResponse<Response>(), done);
    });
    return next.handle();
  }

  private fileFilter(request: Request, file: Express.Multer.File, callback: multer.FileFilterCallback) {
    if (!ACCEPTED_MIME.test(file.mimetype)) {
      return callback(new BadRequestException(`Unsupported file type: ${file.mimetype}`));
    }
    callback(null, true);
  }

  private handleFile(request: Request, file: Express.Multer.File, callback: Callback<Partial<StagedUpload>>) {
    // Must be synchronous: attaching the 'data' listener puts the stream into
    // flowing mode, so the write pipeline has to be wired up in the same tick or
    // the first chunks are lost (they still reach the hash → an empty staged file
    // with a valid checksum). Staging dir is pre-created in the constructor.
    const stagingPath = join(this.stagingFolder, randomUUID());
    const hash = createHash('sha1');
    let size = 0;

    file.stream.on('data', (chunk) => {
      hash.update(chunk);
      size += chunk.length;
    });

    const writeStream = createWriteStream(stagingPath);
    pipeline(file.stream, writeStream, (error) => {
      if (error) {
        hash.destroy();
        return callback(error);
      }
      if (size === 0) {
        return callback(new BadRequestException('File is empty'));
      }
      const staged: StagedUpload = {
        stagingPath,
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        size,
        checksum: hash.digest(),
      };
      callback(null, staged as unknown as Partial<StagedUpload>);
    });
  }

  private removeFile(request: Request, file: Express.Multer.File & { stagingPath?: string }, callback: (error: Error | null) => void) {
    // staging cleanup is handled by upload.service (dedupe path) + StagingSweep
    callback(null);
  }
}

// multer .fields() stores results on request.files[field][0]; surface it typed.
// Every file staged under a field, in submission order.
export function getStagedUploads(request: Request, field: string): StagedUpload[] {
  const files = (request as unknown as { files?: Record<string, (Express.Multer.File & Partial<StagedUpload>)[]> })
    .files;
  return (files?.[field] ?? [])
    .filter((file) => file.stagingPath)
    .map((file) => ({
      stagingPath: file.stagingPath!,
      originalFilename: file.originalFilename ?? file.originalname,
      mimeType: file.mimeType ?? file.mimetype,
      size: file.size,
      checksum: file.checksum!,
    }));
}

export function getStagedUpload(
  request: Request,
  field: string = ASSET_UPLOAD_FIELD,
): StagedUpload | undefined {
  const files = (request as unknown as { files?: Record<string, (Express.Multer.File & Partial<StagedUpload>)[]> })
    .files;
  const file = files?.[field]?.[0];
  if (!file?.stagingPath) {
    return undefined;
  }
  return {
    stagingPath: file.stagingPath,
    originalFilename: file.originalFilename ?? file.originalname,
    mimeType: file.mimeType ?? file.mimetype,
    size: file.size!,
    checksum: file.checksum!,
  };
}
