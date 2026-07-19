import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { CreateEventDto, UpdateEventDto } from 'src/dtos/event.dto';
import { AssetStatus, AssetType, JobName } from 'src/enum';
import { EventRepository } from 'src/repositories/event.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { DB, EventRow } from 'src/schema';
import { StorageKeys } from 'src/utils/storage-keys';

@Injectable()
export class EventService {
  constructor(
    @InjectKysely() private db: Kysely<DB>,
    private eventRepository: EventRepository,
    private jobRepository: JobRepository,
  ) {}

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

  // Pipeline progress for one event: how far media processing and face
  // detection have got, and how many faces are still unclustered. Everything
  // is counted from the database, so it stays correct across restarts and is
  // not affected by queue history being trimmed.
  async getProcessingStatus(eventId: string) {
    const [assets] = await sql<{
      total: number;
      processed: number;
      failed: number;
      pendingMedia: number;
      images: number;
      facesDetected: number;
      pendingDetection: number;
      withFaces: number;
      withoutFaces: number;
    }>`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE status = ${AssetStatus.Processed})::int AS processed,
        count(*) FILTER (WHERE status = ${AssetStatus.Failed})::int AS failed,
        count(*) FILTER (WHERE status NOT IN (${AssetStatus.Processed}, ${AssetStatus.Failed}))::int AS "pendingMedia",
        count(*) FILTER (WHERE type = ${AssetType.Image})::int AS images,
        coalesce(sum(face_count) FILTER (WHERE faces_detected_at IS NOT NULL), 0)::int AS "facesDetected",
        count(*) FILTER (
          WHERE type = ${AssetType.Image} AND faces_detected_at IS NULL AND status <> ${AssetStatus.Failed}
        )::int AS "pendingDetection",
        count(*) FILTER (WHERE faces_detected_at IS NOT NULL AND face_count > 0)::int AS "withFaces",
        count(*) FILTER (WHERE faces_detected_at IS NOT NULL AND face_count = 0)::int AS "withoutFaces"
      FROM asset
      WHERE event_id = ${eventId} AND deleted_at IS NULL
    `
      .execute(this.db)
      .then((result) => result.rows);

    const [faces] = await sql<{ total: number; assigned: number; unassigned: number; people: number }>`
      SELECT
        count(af.id)::int AS total,
        count(af.id) FILTER (WHERE af.person_id IS NOT NULL)::int AS assigned,
        count(af.id) FILTER (WHERE af.person_id IS NULL)::int AS unassigned,
        (SELECT count(*)::int FROM person WHERE event_id = ${eventId}) AS people
      FROM asset_face af
      JOIN asset a ON a.id = af.asset_id
      WHERE a.event_id = ${eventId} AND a.deleted_at IS NULL AND af.deleted_at IS NULL
    `
      .execute(this.db)
      .then((result) => result.rows);

    return { assets, faces };
  }

  // Manual re-run for an operator whose pipeline stalled (ML sidecar was down,
  // queue was paused, …). `force` also drops existing clusters first.
  async reprocessFaces(eventId: string, force: boolean): Promise<{ queued: number }> {
    const rows = await this.db
      .selectFrom('asset')
      .select('id')
      .where('eventId', '=', eventId)
      .where('deletedAt', 'is', null)
      .where('type', '=', AssetType.Image)
      .where('status', '=', AssetStatus.Processed)
      .$if(!force, (query) => query.where('facesDetectedAt', 'is', null))
      .execute();

    await this.jobRepository.queueAll(
      rows.map((asset) => ({ name: JobName.FaceDetect as const, data: { assetId: asset.id } })),
    );
    await this.jobRepository.queue({ name: JobName.FaceRecognizeQueueAll, data: { eventId, force } });

    return { queued: rows.length };
  }

  async remove(orgId: string, eventId: string): Promise<void> {
    await this.get(orgId, eventId);
    await this.eventRepository.softDelete(orgId, eventId);
    // cascade R2 deletion by prefix (docs/plan/04-storage-r2.md §6)
    await this.jobRepository.queue({
      name: JobName.CleanupPrefix,
      data: { prefix: StorageKeys.eventPrefix(orgId, eventId) },
    });
  }
}
