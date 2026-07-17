import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthDto } from 'src/dtos/auth.dto';
import { CreateOrgDto, UpdateOrgDto } from 'src/dtos/org.dto';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { AdminService, QueueAction } from 'src/services/admin.service';
import { OrganizationService } from 'src/services/organization.service';

@ApiTags('Super Admin')
@Controller('admin')
export class AdminController {
  constructor(
    private adminService: AdminService,
    private organizationService: OrganizationService,
  ) {}

  @Get('organizations')
  @Authenticated({ superAdmin: true })
  listOrganizations() {
    return this.organizationService.list();
  }

  @Post('organizations')
  @Authenticated({ superAdmin: true })
  createOrganization(@Auth() auth: AuthDto, @Body() dto: CreateOrgDto) {
    return this.organizationService.create(dto, auth.user!.id);
  }

  @Get('organizations/:orgId')
  @Authenticated({ superAdmin: true })
  getOrganization(@Param('orgId') orgId: string) {
    return this.organizationService.get(orgId);
  }

  @Put('organizations/:orgId')
  @Authenticated({ superAdmin: true })
  updateOrganization(@Param('orgId') orgId: string, @Body() dto: UpdateOrgDto) {
    return this.organizationService.update(orgId, dto);
  }

  @Delete('organizations/:orgId')
  @HttpCode(204)
  @Authenticated({ superAdmin: true })
  removeOrganization(@Param('orgId') orgId: string) {
    return this.organizationService.remove(orgId);
  }

  @Get('stats')
  @Authenticated({ superAdmin: true })
  getStats() {
    return this.adminService.getStats();
  }

  @Get('queues')
  @Authenticated({ superAdmin: true })
  getQueues() {
    return this.adminService.getQueues();
  }

  @Post('queues/:name/:action')
  @HttpCode(204)
  @Authenticated({ superAdmin: true })
  runQueueAction(@Param('name') name: string, @Param('action') action: QueueAction) {
    return this.adminService.runQueueAction(name, action);
  }
}
