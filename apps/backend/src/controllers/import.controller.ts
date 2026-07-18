// Import endpoints (docs/plan/09 §Cloud imports; progress contract 08 §5).
// Deviation from the doc's /api/imports/{id}: routes stay under
// /events/{eventId}/imports so the org-role guard resolves scope from the path.
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { AuthDto } from 'src/dtos/auth.dto';
import { OrgRole } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { ImportService } from 'src/services/import.service';
import { z } from 'zod';

export class CreateImportDto extends createZodDto(
  z.object({
    accountId: z.string().uuid(),
    folderId: z.string().min(1),
    folderName: z.string().min(1).max(500),
    recursive: z.boolean().default(true),
  }),
) {}

@ApiTags('Cloud Imports')
@Controller('events/:eventId/imports')
export class ImportController {
  constructor(private importService: ImportService) {}

  @Post()
  @Authenticated({ orgRole: OrgRole.Admin })
  create(@Auth() auth: AuthDto, @Param('eventId') eventId: string, @Body() dto: CreateImportDto) {
    return this.importService.createImport(eventId, dto, auth.user!.id);
  }

  @Get()
  @Authenticated({ orgRole: OrgRole.Member })
  list(@Param('eventId') eventId: string) {
    return this.importService.listByEvent(eventId);
  }

  @Get(':importId')
  @Authenticated({ orgRole: OrgRole.Member })
  get(@Param('eventId') eventId: string, @Param('importId') importId: string) {
    return this.importService.getProgress(eventId, importId);
  }

  @Post(':importId/cancel')
  @HttpCode(204)
  @Authenticated({ orgRole: OrgRole.Admin })
  cancel(@Param('eventId') eventId: string, @Param('importId') importId: string) {
    return this.importService.cancel(eventId, importId);
  }
}
