import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthDto } from 'src/dtos/auth.dto';
import { CreateEventDto, ExtendExpiryDto, ReprocessFacesDto, SetCoverDto, UpdateEventDto } from 'src/dtos/event.dto';
import { OrgRole } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { EventRepository } from 'src/repositories/event.repository';
import { AssetService } from 'src/services/asset.service';
import { EventExpiryService } from 'src/services/event-expiry.service';
import { EventService } from 'src/services/event.service';

@ApiTags('Events')
@Controller()
export class EventController {
  constructor(
    private assetService: AssetService,
    private eventService: EventService,
    private eventExpiryService: EventExpiryService,
    private eventRepository: EventRepository,
  ) {}

  @Get('events')
  @Authenticated()
  listMyEvents(@Auth() auth: AuthDto) {
    return this.eventRepository.listForUser(auth.user!.id);
  }

  @Get('orgs/:orgId/events')
  @Authenticated({ orgRole: OrgRole.Member })
  listEvents(@Param('orgId') orgId: string) {
    return this.eventService.listByOrg(orgId);
  }

  @Post('orgs/:orgId/events')
  @Authenticated({ orgRole: OrgRole.Admin })
  createEvent(@Param('orgId') orgId: string, @Body() dto: CreateEventDto) {
    return this.eventService.create(orgId, dto);
  }

  @Get('events/:eventId')
  @Authenticated({ orgRole: OrgRole.Member })
  async getEvent(@Param('eventId') eventId: string) {
    // guard verified org membership via the event's org (docs/plan/09 §1)
    const orgId = await this.eventRepository.getOrgId(eventId);
    return this.eventService.get(orgId ?? '', eventId);
  }

  @Get('events/:eventId/processing')
  @Authenticated({ orgRole: OrgRole.Member })
  getProcessingStatus(@Param('eventId') eventId: string) {
    return this.eventService.getProcessingStatus(eventId);
  }

  @Post('events/:eventId/reprocess-faces')
  @Authenticated({ orgRole: OrgRole.Admin })
  reprocessFaces(@Param('eventId') eventId: string, @Body() dto: ReprocessFacesDto) {
    return this.eventService.reprocessFaces(eventId, dto.force ?? false);
  }

  @Put('events/:eventId')
  @Authenticated({ orgRole: OrgRole.Admin })
  async updateEvent(@Param('eventId') eventId: string, @Body() dto: UpdateEventDto) {
    const orgId = await this.eventRepository.getOrgId(eventId);
    return this.eventService.update(orgId ?? '', eventId, dto);
  }

  // Org-wide Photos timeline: every event's photos in one date-ordered stream.
  @Get('orgs/:orgId/assets')
  @Authenticated({ orgRole: OrgRole.Member })
  listOrgAssets(
    @Param('orgId') orgId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const parsed = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return this.assetService.listForOrg(orgId, parsed, cursor);
  }

  // Sidebar thumbnail. null clears it and falls back to the newest photo.
  @Put('events/:eventId/cover')
  @Authenticated({ orgRole: OrgRole.Admin })
  async setCover(@Param('eventId') eventId: string, @Body() dto: SetCoverDto) {
    const orgId = await this.eventRepository.getOrgId(eventId);
    return this.eventRepository.setCover(orgId!, eventId, dto.assetId);
  }

  // --- expiration (docs/plan/07; migration 0007) ---
  //
  // Admin rather than Member: these change whether guests can reach their
  // photos, and one of them destroys media.

  @Post('events/:eventId/expiry/extend')
  @Authenticated({ orgRole: OrgRole.Admin })
  async extendExpiry(@Param('eventId') eventId: string, @Body() dto: ExtendExpiryDto) {
    const orgId = await this.eventRepository.getOrgId(eventId);
    return this.eventExpiryService.extend(orgId!, eventId, dto.expiresAt ? new Date(dto.expiresAt) : null);
  }

  @Post('events/:eventId/expiry/acknowledge')
  @Authenticated({ orgRole: OrgRole.Admin })
  async acknowledgeExpiry(@Param('eventId') eventId: string) {
    const orgId = await this.eventRepository.getOrgId(eventId);
    return this.eventExpiryService.acknowledge(orgId!, eventId);
  }

  // Skips the grace period. Irreversible, hence Owner rather than Admin.
  @Post('events/:eventId/expiry/purge')
  @Authenticated({ orgRole: OrgRole.Owner })
  async purgeExpiredMedia(@Param('eventId') eventId: string) {
    const orgId = await this.eventRepository.getOrgId(eventId);
    return this.eventExpiryService.purgeNow(orgId!, eventId);
  }

  @Delete('events/:eventId')
  @HttpCode(204)
  @Authenticated({ orgRole: OrgRole.Admin })
  async removeEvent(@Param('eventId') eventId: string) {
    const orgId = await this.eventRepository.getOrgId(eventId);
    return this.eventService.remove(orgId ?? '', eventId);
  }
}
