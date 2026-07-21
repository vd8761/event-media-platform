import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Super-admin settings for waking the GPU box. All optional — the panel PATCHes
// whichever fields changed, and unset values fall back to GPU_AUTOSTART_DEFAULTS.
export class GpuAutostartDto extends createZodDto(
  z.object({
    enabled: z.boolean().optional(),
    pendingThreshold: z.coerce.number().int().min(1).max(100_000).optional(),
    maxPendingAgeMinutes: z.coerce.number().int().min(1).max(10_080).optional(),
    // Lower bound of 1: a zero-minute idle window would stop the box between
    // two jobs of the same batch and pay the boot cost again.
    idleShutdownMinutes: z.coerce.number().int().min(1).max(1440).optional(),
    startTimeoutMinutes: z.coerce.number().int().min(1).max(240).optional(),
    startWebhookUrl: z.string().url().or(z.literal('')).optional(),
    stopWebhookUrl: z.string().url().or(z.literal('')).optional(),
    webhookAuthHeader: z.string().max(2000).optional(),
  }),
) {}

export class EventRetentionDto extends createZodDto(
  z.object({
    // How long expired events keep their media. Minimum one hour so a
    // mistyped value cannot delete an event's photos effectively instantly.
    purgeGraceHours: z.coerce.number().int().min(1).max(8760),
  }),
) {}
