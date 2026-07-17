// Slim EXIF extraction via exifr (docs/plan/03-database-schema.md `asset_exif`).
// We do not port Immich's full exiftool-vendored surface.
import { Injectable } from '@nestjs/common';
import exifr from 'exifr';

export interface ExifData {
  capturedAt: Date | null;
  make: string | null;
  model: string | null;
  orientation: number | null;
  lens: string | null;
  latitude: number | null;
  longitude: number | null;
}

@Injectable()
export class ExifRepository {
  async extract(input: string): Promise<ExifData> {
    try {
      const tags = await exifr.parse(input, {
        tiff: true,
        exif: true,
        gps: true,
        pick: [
          'DateTimeOriginal',
          'CreateDate',
          'Make',
          'Model',
          'Orientation',
          'LensModel',
          'latitude',
          'longitude',
        ],
      });
      if (!tags) {
        return this.empty();
      }
      const captured = tags.DateTimeOriginal ?? tags.CreateDate;
      return {
        capturedAt: captured instanceof Date && !Number.isNaN(captured.valueOf()) ? captured : null,
        make: tags.Make ?? null,
        model: tags.Model ?? null,
        orientation: typeof tags.Orientation === 'number' ? tags.Orientation : null,
        lens: tags.LensModel ?? null,
        latitude: typeof tags.latitude === 'number' ? tags.latitude : null,
        longitude: typeof tags.longitude === 'number' ? tags.longitude : null,
      };
    } catch {
      // images without EXIF (PNG/WebP) throw — treat as no metadata
      return this.empty();
    }
  }

  private empty(): ExifData {
    return {
      capturedAt: null,
      make: null,
      model: null,
      orientation: null,
      lens: null,
      latitude: null,
      longitude: null,
    };
  }
}
