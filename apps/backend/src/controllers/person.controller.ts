import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OrgRole } from 'src/enum';
import { Authenticated } from 'src/middleware/auth.guard';
import { PersonService, UpdatePersonDto } from 'src/services/person.service';

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

  @Get(':personId/assets')
  @Authenticated({ orgRole: OrgRole.Member })
  getAssets(@Param('eventId') eventId: string, @Param('personId') personId: string) {
    return this.personService.getAssets(eventId, personId);
  }
}
