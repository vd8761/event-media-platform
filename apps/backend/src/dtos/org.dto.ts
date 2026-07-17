import { createZodDto } from 'nestjs-zod';
import { OrgRole, OrgStatus } from 'src/enum';
import { z } from 'zod';

export const slugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes only');

// Initial owner is create-or-invite by email (docs/plan/09). Password is
// required for new users until the invite-email flow lands with M4.
const ownerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8).optional(),
});

export class CreateOrgDto extends createZodDto(
  z.object({
    name: z.string().min(1).max(200),
    slug: slugSchema,
    owner: ownerSchema,
  }),
) {}

export class UpdateOrgDto extends createZodDto(
  z.object({
    name: z.string().min(1).max(200).optional(),
    slug: slugSchema.optional(),
    status: z.enum([OrgStatus.Active, OrgStatus.Suspended]).optional(),
  }),
) {}

export class AddMemberDto extends createZodDto(
  z.object({
    email: z.string().email(),
    name: z.string().min(1).optional(),
    password: z.string().min(8).optional(),
    role: z.enum([OrgRole.Owner, OrgRole.Admin, OrgRole.Member]),
  }),
) {}

export class UpdateMemberDto extends createZodDto(
  z.object({
    role: z.enum([OrgRole.Owner, OrgRole.Admin, OrgRole.Member]),
  }),
) {}
