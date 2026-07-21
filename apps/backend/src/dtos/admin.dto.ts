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
    // 'jarvislabs' drives the `jl` CLI instead of the webhooks above.
    provider: z.enum(['webhook', 'jarvislabs']).optional(),
    // JarvisLabs machine ids are numeric today, but the CLI treats them as
    // opaque and resume can reassign them — so this stays a string.
    jarvislabsMachineId: z
      .string()
      .trim()
      .max(64)
      .regex(/^[\w-]*$/, 'Instance id may only contain letters, numbers, hyphens and underscores')
      .optional(),
    jarvislabsGpuType: z
      .string()
      .trim()
      .max(32)
      .regex(/^[\w-]*$/, 'GPU type may only contain letters, numbers, hyphens and underscores')
      .optional(),
  }),
) {}

export class EventRetentionDto extends createZodDto(
  z.object({
    // How long expired events keep their media. Minimum one hour so a
    // mistyped value cannot delete an event's photos effectively instantly.
    purgeGraceHours: z.coerce.number().int().min(1).max(8760),
  }),
) {}
