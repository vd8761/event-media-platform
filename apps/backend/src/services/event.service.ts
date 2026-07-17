import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateEventDto, UpdateEventDto } from 'src/dtos/event.dto';
import { EventRepository } from 'src/repositories/event.repository';
import { EventRow } from 'src/schema';

@Injectable()
export class EventService {
  constructor(private eventRepository: EventRepository) {}

  listByOrg(orgId: string): Promise<EventRow[]> {
    return this.eventRepository.listByOrg(orgId);
  }

  async get(orgId: string, eventId: string): Promise<EventRow> {
    const event = await this.eventRepository.getById(eventId);
    if (!event || event.orgId !== orgId) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  async create(orgId: string, dto: CreateEventDto): Promise<EventRow> {
    if (await this.eventRepository.getBySlug(dto.slug)) {
      throw new BadRequestException('Slug already in use');
    }
    return this.eventRepository.create({
      orgId,
      name: dto.name,
      slug: dto.slug,
      description: dto.description ?? null,
      startsAt: dto.startsAt ?? null,
      endsAt: dto.endsAt ?? null,
    });
  }

  async update(orgId: string, eventId: string, dto: UpdateEventDto): Promise<EventRow> {
    const event = await this.get(orgId, eventId);
    if (dto.slug && dto.slug !== event.slug) {
      const existing = await this.eventRepository.getBySlug(dto.slug);
      if (existing && existing.id !== eventId) {
        throw new BadRequestException('Slug already in use');
      }
    }
    return this.eventRepository.update(orgId, eventId, {
      ...dto,
      config: dto.config ? { ...event.config, ...dto.config } : undefined,
    });
  }

  async remove(orgId: string, eventId: string): Promise<void> {
    await this.get(orgId, eventId);
    // R2 prefix cleanup job lands with the storage pipeline in M2
    // (docs/plan/04-storage-r2.md §6)
    await this.eventRepository.softDelete(orgId, eventId);
  }
}
