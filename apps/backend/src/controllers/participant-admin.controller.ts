// Org-facing participants dashboard (docs/plan/09 §Participants).
import { Controller, Delete, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JobName, OrgRole } from 'src/enum';
import { Authenticated } from 'src/middleware/auth.guard';
import { JobRepository } from 'src/repositories/job.repository';
import { ParticipantRepository } from 'src/repositories/participant.repository';
import { GalleryTokenService } from 'src/services/gallery-token.service';

@ApiTags('Participants')
@Controller('events/:eventId/participants')
export class ParticipantAdminController {
  constructor(
    private galleryTokenService: GalleryTokenService,
    private jobRepository: JobRepository,
    private participantRepository: ParticipantRepository,
  ) {}

  @Get()
  @Authenticated({ orgRole: OrgRole.Member })
  list(@Param('eventId') eventId: string) {
    return this.participantRepository.listByEvent(eventId);
  }

  // regenerate token + resend the gallery email (docs/plan/07 §4/§5)
  @Post(':participantId/resend')
  @HttpCode(204)
  @Authenticated({ orgRole: OrgRole.Admin })
  async resend(@Param('eventId') eventId: string, @Param('participantId') participantId: string) {
    const participant = await this.getScoped(eventId, participantId);
    const token = this.galleryTokenService.generate();
    await this.participantRepository.update(participant.id, {
      galleryTokenHash: token.hash,
      galleryTokenEnc: token.enc,
    });
    await this.jobRepository.queue({ name: JobName.SendGalleryEmail, data: { participantId: participant.id } });
  }

  // right-to-erasure: matches + selfie object + log rows (docs/plan/07 §6)
  @Delete(':participantId')
  @HttpCode(204)
  @Authenticated({ orgRole: OrgRole.Admin })
  async remove(@Param('eventId') eventId: string, @Param('participantId') participantId: string) {
    const participant = await this.getScoped(eventId, participantId);
    if (participant.selfieKey) {
      await this.jobRepository.queue({ name: JobName.CleanupKeys, data: { keys: [participant.selfieKey] } });
    }
    await this.participantRepository.hardDelete(participant.id);
  }

  private async getScoped(eventId: string, participantId: string) {
    const participant = await this.participantRepository.getById(participantId);
    if (!participant || participant.eventId !== eventId) {
      throw new NotFoundException('Participant not found');
    }
    return participant;
  }
}
