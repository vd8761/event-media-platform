import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  CreatePublicSupportTicketDto,
  CreateSupportTicketDto,
  UpdateSupportTicketDto,
} from 'src/dtos/support.dto';
import { OrgRole, SupportStatus } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { SupportService } from 'src/services/support.service';

@ApiTags('Support')
@Controller()
export class SupportController {
  constructor(private supportService: SupportService) {}

  // Organiser Help dialog. Member-level: anyone who can use the app can ask
  // for help, not just owners.
  @Post('orgs/:orgId/support')
  @Authenticated({ orgRole: OrgRole.Member })
  create(@Auth() auth: AuthDto, @Param('orgId') orgId: string, @Body() dto: CreateSupportTicketDto) {
    return this.supportService.createForOrg(orgId, auth.user!.id, dto);
  }

  // Public event pages. Unauthenticated by design — a guest who cannot reach
  // their gallery has no session to authenticate with.
  @Post('public/support')
  createPublic(@Body() dto: CreatePublicSupportTicketDto) {
    return this.supportService.createPublic(dto);
  }

  @Get('admin/support')
  @Authenticated({ superAdmin: true })
  list(@Query('status') status?: SupportStatus) {
    return this.supportService.list(status);
  }

  @Put('admin/support/:id')
  @HttpCode(204)
  @Authenticated({ superAdmin: true })
  update(@Param('id') id: string, @Body() dto: UpdateSupportTicketDto) {
    return this.supportService.update(id, dto);
  }
}
