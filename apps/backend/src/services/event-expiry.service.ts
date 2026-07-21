// Event expiration and media retention.
//
// Two sweeps, deliberately a grace period apart:
//   EventExpirySweep — hourly. An event has passed `expires_at`: participant
//     links are already dark (that check is computed, not swept), so this only
//     tells the owner and sets the purge deadline.
//   EventPurgeSweep  — daily. The grace period has elapsed and nobody
//     extended, so the media is deleted from R2.
//
// Deleting event media is irreversible, so nothing here deletes on the same
// tick as the link going dark, and every purge re-checks that the event is
// still expired before acting.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OnJob } from 'src/decorators';
import { EmailTemplate, JobName, JobStatus, OrgRole, QueueName } from 'src/enum';
import { EventRepository } from 'src/repositories/event.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { OrganizationRepository } from 'src/repositories/organization.repository';
import { SystemConfigRepository } from 'src/repositories/system-config.repository';
import { EventRow } from 'src/schema';
import { isEventExpired, isEventPurged, purgeDeadline } from 'src/utils/event-expiry';
import { StorageKeys } from 'src/utils/storage-keys';
import { JobOf } from 'src/types';

@Injectable()
export class EventExpiryService {
  constructor(
    private eventRepository: EventRepository,
    private jobRepository: JobRepository,
    private logger: LoggingRepository,
    private organizationRepository: OrganizationRepository,
    private systemConfigRepository: SystemConfigRepository,
  ) {
    this.logger.setContext(EventExpiryService.name);
  }

  // --- organizer actions ---

  // Pushing the date out revives the galleries immediately (expiry is
  // computed) and cancels any scheduled purge. The notified/acknowledged
  // marks are cleared so a later expiry notifies again rather than staying
  // silent because it already fired once.
  async extend(orgId: string, eventId: string, expiresAt: Date | null): Promise<EventRow> {
    const event = await this.getEvent(orgId, eventId);
    if (isEventPurged(event)) {
      throw new BadRequestException('This event’s media has already been deleted and cannot be extended');
    }
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('New expiry must be in the future');
    }

    return this.eventRepository.setExpiryState(eventId, {
      expiresAt,
      expiryNotifiedAt: null,
      expiryAcknowledgedAt: null,
      purgeAfter: null,
    });
  }

  // "I've seen this." Records who knew, without changing the deadline — the
  // purge still happens after the grace period.
  async acknowledge(orgId: string, eventId: string): Promise<EventRow> {
    const event = await this.getEvent(orgId, eventId);
    if (!isEventExpired(event)) {
      throw new BadRequestException('This event has not expired yet');
    }
    return this.eventRepository.setExpiryState(eventId, { expiryAcknowledgedAt: new Date() });
  }

  // Opt out of the grace period. Only reachable for an already-expired event,
  // so an accidental click cannot destroy a live gallery.
  async purgeNow(orgId: string, eventId: string): Promise<EventRow> {
    const event = await this.getEvent(orgId, eventId);
    if (!isEventExpired(event)) {
      throw new BadRequestException('Set an expiry date in the past before deleting the media');
    }
    if (isEventPurged(event)) {
      return event;
    }
    await this.purge(event);
    return this.eventRepository.setExpiryState(eventId, { purgedAt: new Date(), purgeAfter: null });
  }

  // --- sweeps ---

  @OnJob({ name: JobName.EventExpirySweep, queue: QueueName.Background })
  async handleEventExpirySweep(): Promise<JobStatus> {
    const now = new Date();
    const { purgeGraceHours } = await this.systemConfigRepository.getEventRetentionConfig();
    const events = await this.eventRepository.findNewlyExpired(now);

    for (const event of events) {
      // Recorded before the email is queued: a send failure must not leave the
      // event eligible forever, mailing the owner on every sweep.
      await this.eventRepository.setExpiryState(event.id, {
        expiryNotifiedAt: now,
        purgeAfter: purgeDeadline(new Date(event.expiresAt!), purgeGraceHours),
      });
      await this.jobRepository.queue({ name: JobName.SendEventExpiry, data: { eventId: event.id } });
      this.logger.log(`Event ${event.id} expired — owner notified, media purges after ${purgeGraceHours}h`);
    }

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.EventPurgeSweep, queue: QueueName.StorageCleanup })
  async handleEventPurgeSweep(): Promise<JobStatus> {
    const now = new Date();
    const events = await this.eventRepository.findDueForPurge(now);

    for (const event of events) {
      // Re-read rather than trusting the sweep's snapshot: an organizer may
      // have extended between the query and this iteration.
      const current = await this.eventRepository.getById(event.id);
      if (!current || current.purgedAt || !isEventExpired(current, now)) {
        this.logger.log(`Skipping purge for event ${event.id} — no longer due`);
        continue;
      }

      await this.purge(current);
      await this.eventRepository.setExpiryState(current.id, { purgedAt: now, purgeAfter: null });
      this.logger.log(`Purged media for expired event ${current.id}`);
    }

    return JobStatus.Success;
  }

  // --- internals ---

  // Queues the R2 prefix delete rather than doing it inline: an event can hold
  // tens of thousands of objects, and the storageCleanup queue already owns
  // batched deletes with retries.
  private async purge(event: EventRow): Promise<void> {
    await this.jobRepository.queue({
      name: JobName.CleanupPrefix,
      data: { prefix: StorageKeys.eventPrefix(event.orgId, event.id) },
    });
  }

  private async getEvent(orgId: string, eventId: string): Promise<EventRow> {
    const event = await this.eventRepository.getById(eventId);
    // orgId comes from the guard-verified path, so this also stops an event
    // from one org being addressed through another's route.
    if (!event || event.deletedAt || event.orgId !== orgId) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  // Owners only — the people who can actually extend or delete.
  async getOwnerEmails(orgId: string): Promise<{ email: string; name: string }[]> {
    const members = await this.organizationRepository.listMembers(orgId);
    return members.filter((member) => member.role === OrgRole.Owner).map(({ email, name }) => ({ email, name }));
  }
}
