import { createZodDto } from 'nestjs-zod';
import { SupportStatus } from 'src/enum';
import { z } from 'zod';

// Long enough for a real description, capped so the column cannot be used as a
// dumping ground.
const messageSchema = z.string().min(1).max(5000);

export class CreateSupportTicketDto extends createZodDto(z.object({ message: messageSchema })) {}

// The public form asks for the same message plus a name and email — both
// optional, because a guest who cannot find their photos should not be forced
// to hand over contact details just to say so.
export class CreatePublicSupportTicketDto extends createZodDto(
  z.object({
    message: messageSchema,
    name: z.string().min(1).max(200).optional(),
    email: z.string().email().optional(),
    eventId: z.string().uuid().optional(),
  }),
) {}

export class UpdateSupportTicketDto extends createZodDto(
  z.object({ status: z.nativeEnum(SupportStatus) }),
) {}
