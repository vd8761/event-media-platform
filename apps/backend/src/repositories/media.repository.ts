// Ported from immich:server/src/repositories/media.repository.ts — the sharp
// decode-once / resize / thumbhash pipeline and the fluent-ffmpeg probe +
// transcode. Operates on local /cache temp paths (docs/plan/04 §4); the callers
// stage originals from R2 and upload derivatives back.
import { Injectable } from '@nestjs/common';
import ffmpeg from 'fluent-ffmpeg';
import sharp from 'sharp';
import { LoggingRepository } from 'src/repositories/logging.repository';

// Derivative specs (docs/plan/04 §2): preview 1440 JPEG q80, thumb 250 WebP q80.
export const PREVIEW_SIZE = 1440;
export const THUMBNAIL_SIZE = 250;
export const PREVIEW_QUALITY = 80;
export const THUMBNAIL_QUALITY = 80;

export interface DecodedSource {
  data: Buffer;
  info: sharp.OutputInfo;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface VideoInfo {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
}

@Injectable()
export class MediaRepository {
  constructor(private logger: LoggingRepository) {
    this.logger.setContext(MediaRepository.name);
  }

  async getImageDimensions(input: string): Promise<ImageDimensions> {
    const meta = await sharp(input, { limitInputPixels: false }).metadata();
    // orientation 5-8 rotate 90°, swapping width/height
    const swap = (meta.orientation ?? 1) >= 5;
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    return swap ? { width: height, height: width } : { width, height };
  }

  // Decode once to a raw RGB buffer at preview size — the shared source for
  // preview, thumbnail, and thumbhash (Immich decode-once optimization).
  async decodePreview(input: string): Promise<DecodedSource> {
    return sharp(input, { failOn: 'error', limitInputPixels: false, unlimited: true })
      .rotate() // auto-orient from EXIF
      .resize(PREVIEW_SIZE, PREVIEW_SIZE, { fit: 'outside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
  }

  async generatePreview(source: DecodedSource, output: string): Promise<void> {
    await sharp(source.data, { raw: source.info })
      .toFormat('jpeg', {
        quality: PREVIEW_QUALITY,
        chromaSubsampling: PREVIEW_QUALITY >= 80 ? '4:4:4' : '4:2:0',
      })
      .toFile(output);
  }

  async generateThumbnail(source: DecodedSource, output: string): Promise<void> {
    await sharp(source.data, { raw: source.info })
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'outside', withoutEnlargement: true })
      .toFormat('webp', { quality: THUMBNAIL_QUALITY })
      .toFile(output);
  }

  async generateThumbhash(source: DecodedSource): Promise<Buffer> {
    const { rgbaToThumbHash } = await import('thumbhash');
    const { data, info } = await sharp(source.data, { raw: source.info })
      .resize(100, 100, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return Buffer.from(rgbaToThumbHash(info.width, info.height, data));
  }

  probe(input: string): Promise<VideoInfo> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(input, (error, data) => {
        if (error) {
          return reject(error);
        }
        const video = data.streams.find((stream) => stream.codec_type === 'video');
        resolve({
          durationSeconds: data.format.duration ? Number(data.format.duration) : null,
          width: video?.width ?? null,
          height: video?.height ?? null,
        });
      });
    });
  }

  // H.264 720p playback copy, Immich ffmpeg defaults (docs/plan/04 §2).
  transcode(input: string, output: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(input)
        .outputOptions([
          '-vf',
          'scale=-2:min(720\\,ih)',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '23',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
        ])
        .on('end', () => resolve())
        .on('error', (error) => reject(error))
        .save(output);
    });
  }
}
