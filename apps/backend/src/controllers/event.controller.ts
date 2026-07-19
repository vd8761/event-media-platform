import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthDto } from 'src/dtos/auth.dto';
import { CreateEventDto, ReprocessFacesDto, SetFeaturePhotoDto, UpdateEventDto } from 'src/dtos/event.dto';
import { OrgRole } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { EventRepository } from 'src/repositories/event.repository';
import { EventService } from 'src/services/event.service';

@ApiTags('Events')
@Controller()
export class EventController {
  constructor(
    private eventService: EventService,
    private eventRepository: EventRepository,
  ) {}

  @Get('events')
  @Authenticated()
  listMyEvents(@Auth() auth: AuthDto) {
    return this.eventRepository.listForUser(auth.user!.id, auth.user!.isSuperAdmin);
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

  // Shared event cover. Organisers set it here; participants set the same
  // field through the public gallery route.
  @Put('events/:eventId/feature-photo')
  @HttpCode(204)
  @Authenticated({ orgRole: OrgRole.Member })
  setFeaturePhoto(@Param('eventId') eventId: string, @Body() dto: SetFeaturePhotoDto) {
    return this.eventService.setFeaturePhoto(eventId, dto.assetId);
  }

  @Put('events/:eventId')
  @Authenticated({ orgRole: OrgRole.Admin })
  async updateEvent(@Param('eventId') eventId: string, @Body() dto: UpdateEventDto) {
    const orgId = await this.eventRepository.getOrgId(eventId);
    return this.eventService.update(orgId ?? '', eventId, dto);
  }

  @Delete('events/:eventId')
  @HttpCode(204)
  @Authenticated({ orgRole: OrgRole.Admin })
  async removeEvent(@Param('eventId') eventId: string) {
    const orgId = await this.eventRepository.getOrgId(eventId);
    return this.eventService.remove(orgId ?? '', eventId);
  }
}
