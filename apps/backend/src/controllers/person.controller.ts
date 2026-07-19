import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OrgRole } from 'src/enum';
import { Authenticated } from 'src/middleware/auth.guard';
import { MergePeopleDto, PersonService, SetPersonCoverDto, UpdatePersonDto } from 'src/services/person.service';

@ApiTags('People')
@Controller('events/:eventId/people')
export class PersonController {
  constructor(private personService: PersonService) {}

  @Get()
  @Authenticated({ orgRole: OrgRole.Member })
  list(@Param('eventId') eventId: string) {
    return this.personService.list(eventId);
  }

  @Put(':personId')
  @Authenticated({ orgRole: OrgRole.Admin })
  update(@Param('eventId') eventId: string, @Param('personId') personId: string, @Body() dto: UpdatePersonDto) {
    return this.personService.update(eventId, personId, dto);
  }

  @Get(':personId')
  @Authenticated({ orgRole: OrgRole.Member })
  get(@Param('eventId') eventId: string, @Param('personId') personId: string) {
    return this.personService.get(eventId, personId);
  }

  @Put(':personId/cover')
  @Authenticated({ orgRole: OrgRole.Admin })
  setCover(@Param('eventId') eventId: string, @Param('personId') personId: string, @Body() dto: SetPersonCoverDto) {
    return this.personService.setCover(eventId, personId, dto.faceId);
  }

  @Post(':personId/merge')
  @Authenticated({ orgRole: OrgRole.Admin })
  merge(@Param('eventId') eventId: string, @Param('personId') personId: string, @Body() dto: MergePeopleDto) {
    return this.personService.merge(eventId, personId, dto.ids);
  }

  @Get(':personId/assets')
  @Authenticated({ orgRole: OrgRole.Member })
  getAssets(@Param('eventId') eventId: string, @Param('personId') personId: string) {
    return this.personService.getAssets(eventId, personId);
  }
}
