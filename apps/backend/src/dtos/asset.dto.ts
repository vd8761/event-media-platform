import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// checksums are hex-encoded SHA-1 (browser preflight, docs/plan/04 §3)
const hexSha1 = z.string().regex(/^[0-9a-f]{40}$/i);

export class BulkUploadCheckDto extends createZodDto(
  z.object({
    assets: z
      .array(z.object({ id: z.string(), checksum: hexSha1 }))
      .min(1)
      .max(1000),
  }),
) {}

export class DeleteAssetsDto extends createZodDto(
  z.object({
    ids: z.array(z.string().uuid()).min(1).max(1000),
  }),
) {}

export class AssetJobDto extends createZodDto(
  z.object({
    name: z.enum(['thumbnails', 'faceDetection', 'facialRecognition']),
    force: z.boolean().optional(),
  }),
) {}

export class AssetListQueryDto extends createZodDto(
  z.object({
    limit: z.coerce.number().int().min(1).max(500).default(100),
    cursor: z.string().optional(),
  }),
) {}
