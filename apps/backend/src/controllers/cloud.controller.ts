// Cloud accounts + OAuth endpoints (docs/plan/09 §Cloud imports).
import { BadRequestException, Controller, Delete, Get, HttpCode, Param, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthDto } from 'src/dtos/auth.dto';
import { CloudProvider, OrgRole } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { CloudService } from 'src/services/cloud.service';

function parseProvider(value: string): CloudProvider {
  if (!Object.values(CloudProvider).includes(value as CloudProvider)) {
    throw new BadRequestException(`Unknown provider: ${value}`);
  }
  return value as CloudProvider;
}

@ApiTags('Cloud Imports')
@Controller()
export class CloudController {
  constructor(private cloudService: CloudService) {}

  @Get('orgs/:orgId/cloud/:provider/authorize')
  @Authenticated({ orgRole: OrgRole.Admin })
  authorize(
    @Auth() auth: AuthDto,
    @Param('orgId') orgId: string,
    @Param('provider') provider: string,
    @Res() res: Response,
  ) {
    res.redirect(302, this.cloudService.getAuthorizeUrl(orgId, auth.user!.id, parseProvider(provider)));
  }

  // provider redirect target — authenticated by the encrypted state blob
  @Get('cloud/:provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    if (error || !code) {
      throw new BadRequestException(`OAuth failed: ${error || 'missing code'}`);
    }
    const redirect = await this.cloudService.handleCallback(parseProvider(provider), code, state);
    res.redirect(302, redirect);
  }

  @Get('orgs/:orgId/cloud/accounts')
  @Authenticated({ orgRole: OrgRole.Admin })
  listAccounts(@Param('orgId') orgId: string) {
    return this.cloudService.listAccounts(orgId);
  }

  @Delete('orgs/:orgId/cloud/accounts/:accountId')
  @HttpCode(204)
  @Authenticated({ orgRole: OrgRole.Admin })
  disconnect(@Param('orgId') orgId: string, @Param('accountId') accountId: string) {
    return this.cloudService.disconnect(orgId, accountId);
  }

  @Get('orgs/:orgId/cloud/accounts/:accountId/folders')
  @Authenticated({ orgRole: OrgRole.Admin })
  listFolders(
    @Param('orgId') orgId: string,
    @Param('accountId') accountId: string,
    @Query('parentId') parentId?: string,
  ) {
    return this.cloudService.listFolders(orgId, accountId, parentId || undefined);
  }
}
