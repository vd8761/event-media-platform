import { createZodDto } from 'nestjs-zod';
import { slugSchema } from 'src/dtos/org.dto';
import { EventStatus } from 'src/enum';
import { z } from 'zod';

// Per-event ML overrides (docs/plan/06-face-pipeline.md §2).
const eventConfigSchema = z.object({
  matchMaxDistance: z.number().min(0).max(2).optional(),
  minScore: z.number().min(0).max(1).optional(),
});

// ISO strings, not z.coerce.date() — Date schemas cannot be represented in the
// generated OpenAPI JSON Schema, and Kysely accepts strings for timestamptz.
const isoDate = z.iso.datetime({ offset: true });

export class CreateEventDto extends createZodDto(
  z.object({
    name: z.string().min(1).max(200),
    slug: slugSchema,
    description: z.string().max(5000).optional(),
    startsAt: isoDate.optional(),
    endsAt: isoDate.optional(),
  }),
) {}

// force: also unassign existing clusters and re-detect already-processed
// photos, instead of only filling in the ones detection never reached.
export class ReprocessFacesDto extends createZodDto(
  z.object({
    force: z.boolean().optional(),
  }),
) {}

export class UpdateEventDto extends createZodDto(
  z.object({
    name: z.string().min(1).max(200).optional(),
    slug: slugSchema.optional(),
    description: z.string().max(5000).nullish(),
    startsAt: isoDate.nullish(),
    endsAt: isoDate.nullish(),
    status: z.enum([EventStatus.Draft, EventStatus.Active, EventStatus.Closed]).optional(),
    participantPageEnabled: z.boolean().optional(),
    config: eventConfigSchema.optional(),
  }),
) {}
