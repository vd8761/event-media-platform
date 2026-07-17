import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AddMemberDto, UpdateMemberDto } from 'src/dtos/org.dto';
import { Authenticated } from 'src/middleware/auth.guard';
import { OrgRole } from 'src/enum';
import { OrganizationService } from 'src/services/organization.service';

@ApiTags('Organizations')
@Controller('orgs')
export class OrganizationController {
  constructor(private organizationService: OrganizationService) {}

  @Get(':orgId')
  @Authenticated({ orgRole: OrgRole.Member })
  getOrganization(@Param('orgId') orgId: string) {
    return this.organizationService.get(orgId);
  }

  @Get(':orgId/members')
  @Authenticated({ orgRole: OrgRole.Owner })
  listMembers(@Param('orgId') orgId: string) {
    return this.organizationService.listMembers(orgId);
  }

  @Post(':orgId/members')
  @HttpCode(204)
  @Authenticated({ orgRole: OrgRole.Owner })
  addMember(@Param('orgId') orgId: string, @Body() dto: AddMemberDto) {
    return this.organizationService.addMember(orgId, dto);
  }

  @Put(':orgId/members/:userId')
  @HttpCode(204)
  @Authenticated({ orgRole: OrgRole.Owner })
  updateMember(@Param('orgId') orgId: string, @Param('userId') userId: string, @Body() dto: UpdateMemberDto) {
    return this.organizationService.updateMember(orgId, userId, dto);
  }

  @Delete(':orgId/members/:userId')
  @HttpCode(204)
  @Authenticated({ orgRole: OrgRole.Owner })
  removeMember(@Param('orgId') orgId: string, @Param('userId') userId: string) {
    return this.organizationService.removeMember(orgId, userId);
  }
}
