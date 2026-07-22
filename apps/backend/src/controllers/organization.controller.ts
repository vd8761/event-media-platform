import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthDto } from 'src/dtos/auth.dto';
import { AddMemberDto, UpdateMemberDto } from 'src/dtos/org.dto';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { OrgRole } from 'src/enum';
import { OrganizationService } from 'src/services/organization.service';
import { PersonService } from 'src/services/person.service';
import { QuotaService } from 'src/services/quota.service';
import { AssetService } from 'src/services/asset.service';

@ApiTags('Organizations')
@Controller('orgs')
export class OrganizationController {
  constructor(
    private organizationService: OrganizationService,
    private personService: PersonService,
    private assetService: AssetService,
    private quotaService: QuotaService,
  ) {}

  @Get(':orgId')
  @Authenticated({ orgRole: OrgRole.Member, allowSuperAdmin: true })
  getOrganization(@Param('orgId') orgId: string) {
    return this.organizationService.get(orgId);
  }

  // App-shell payload: sidebar events with covers + the storage footer.
  // Member-level because everyone who can see the app needs the shell.
  @Get(':orgId/shell')
  @Authenticated({ orgRole: OrgRole.Member })
  getShell(@Param('orgId') orgId: string) {
    return this.organizationService.getShell(orgId);
  }

  // Account stats. Member-level: usage figures are org-wide context, not
  // owner-only settings.
  // Plan, limits and current consumption. Member-level: everyone in the org
  // sees the same quota bar, and it is their own data.
  @Get(':orgId/quota')
  getQuota(@Param('orgId') orgId: string) {
    return this.quotaService.getStatus(orgId);
  }

  @Get(':orgId/usage')
  @Authenticated({ orgRole: OrgRole.Member })
  getUsage(@Param('orgId') orgId: string) {
    return this.organizationService.getUsage(orgId);
  }

  @Get(':orgId/notifications')
  @Authenticated({ orgRole: OrgRole.Member })
  getNotifications(@Param('orgId') orgId: string) {
    return this.organizationService.getNotifications(orgId);
  }

  // Org-wide People grid. Member-level: anyone in the org can browse people,
  // same as the sidebar events. A super admin is deliberately excluded — they
  // have no access to the faces inside an org's events.
  @Get(':orgId/people')
  @Authenticated({ orgRole: OrgRole.Member })
  listPeople(@Param('orgId') orgId: string) {
    return this.personService.listForOrg(orgId);
  }

  // Org-wide Map markers. Member-level, same reasoning as /people.
  @Get(':orgId/map-markers')
  @Authenticated({ orgRole: OrgRole.Member })
  getMapMarkers(@Param('orgId') orgId: string) {
    return this.assetService.getMapMarkers(orgId);
  }

  @Get(':orgId/members')
  @Authenticated({ orgRole: OrgRole.Owner, allowSuperAdmin: true })
  listMembers(@Param('orgId') orgId: string) {
    return this.organizationService.listMembers(orgId);
  }

  @Post(':orgId/members')
  @HttpCode(204)
  @Authenticated({ orgRole: OrgRole.Owner, allowSuperAdmin: true })
  addMember(@Param('orgId') orgId: string, @Body() dto: AddMemberDto) {
    return this.organizationService.addMember(orgId, dto);
  }

  @Put(':orgId/members/:userId')
  @HttpCode(204)
  @Authenticated({ orgRole: OrgRole.Owner, allowSuperAdmin: true })
  updateMember(@Param('orgId') orgId: string, @Param('userId') userId: string, @Body() dto: UpdateMemberDto) {
    return this.organizationService.updateMember(orgId, userId, dto);
  }

  // Super admin only, deliberately not owner-accessible. An org owner who wants
  // a new password can change their own; this exists for the case where they
  // have lost access entirely, and it returns nothing — the generated password
  // goes to the account holder's inbox, never to the caller.
  @Post(':orgId/members/:userId/reset-password')
  @HttpCode(204)
  @Authenticated({ superAdmin: true })
  resetMemberPassword(@Param('orgId') orgId: string, @Param('userId') userId: string, @Auth() auth: AuthDto) {
    return this.organizationService.resetMemberPassword(orgId, userId, auth.user!.id);
  }

  @Delete(':orgId/members/:userId')
  @HttpCode(204)
  @Authenticated({ orgRole: OrgRole.Owner, allowSuperAdmin: true })
  removeMember(@Param('orgId') orgId: string, @Param('userId') userId: string) {
    return this.organizationService.removeMember(orgId, userId);
  }
}
