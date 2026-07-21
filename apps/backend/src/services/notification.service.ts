// M4 (docs/plan/07 §5): queue-driven email dispatch on the notification queue.
// Cadence — notify once, then digest with a ≥6h throttle that is re-checked at
// send time (the delayed job accumulates new matches naturally).
import { Injectable } from '@nestjs/common';
import { createElement } from 'react';
import { OnJob } from 'src/decorators';
import { EventExpiredEmail, subject as eventExpiredSubject } from 'src/emails/event-expired.email';
import { GalleryReadyEmail, subject as galleryReadySubject } from 'src/emails/gallery-ready.email';
import { GalleryUpdateEmail, subject as galleryUpdateSubject } from 'src/emails/gallery-update.email';
import { NoFaceDetectedEmail, subject as noFaceSubject } from 'src/emails/no-face-detected.email';
import { SelfieReceivedEmail, subject as selfieReceivedSubject } from 'src/emails/selfie-received.email';
import { EmailTemplate, JobName, JobStatus, QueueName } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { EmailLogRepository } from 'src/repositories/email-log.repository';
import { EmailRepository } from 'src/repositories/email.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { ParticipantRepository } from 'src/repositories/participant.repository';
import { EventExpiryService } from 'src/services/event-expiry.service';
import { GalleryTokenService } from 'src/services/gallery-token.service';
import { JobOf } from 'src/types';

export const DIGEST_THROTTLE_MS = 6 * 60 * 60 * 1000; // ≥6h between digests

@Injectable()
export class NotificationService {
  constructor(
    private assetRepository: AssetRepository,
    private configRepository: ConfigRepository,
    private emailLogRepository: EmailLogRepository,
    private emailRepository: EmailRepository,
    private eventExpiryService: EventExpiryService,
    private eventRepository: EventRepository,
    private galleryTokenService: GalleryTokenService,
    private logger: LoggingRepository,
    private participantRepository: ParticipantRepository,
  ) {
    this.logger.setContext(NotificationService.name);
  }

  // Immediate acknowledgement — queued by the intake endpoint, so it goes out
  // while the selfie is still being embedded.
  @OnJob({ name: JobName.SendSelfieReceived, queue: QueueName.Notification })
  async handleSendSelfieReceived({ participantId }: JobOf<JobName.SendSelfieReceived>): Promise<JobStatus> {
    const context = await this.loadContext(participantId);
    if (!context) {
      return JobStatus.Skipped;
    }
    const { participant, eventName, galleryUrl, expiresAt } = context;

    // Told up front, in the first message they get, so nobody discovers the
    // deadline only after the gallery has already closed.
    const props = { eventName, galleryUrl, expiresAt };
    return this.send(
      participant,
      EmailTemplate.SelfieReceived,
      selfieReceivedSubject(props),
      createElement(SelfieReceivedEmail, props),
    );
  }

  @OnJob({ name: JobName.SendGalleryEmail, queue: QueueName.Notification })
  async handleSendGalleryEmail({ participantId }: JobOf<JobName.SendGalleryEmail>): Promise<JobStatus> {
    const context = await this.loadContext(participantId);
    if (!context) {
      return JobStatus.Skipped;
    }
    const { participant, eventName, galleryUrl } = context;

    const matchCount = await this.participantRepository.countMatches(participantId);
    if (matchCount === 0) {
      this.logger.debug(`Gallery email for ${participantId} skipped — no matches yet`);
      return JobStatus.Skipped;
    }

    // Everyone already got the link in the "selfie received" email, so this
    // follow-up only earns its place for people who opened that link while it
    // still said "processing" — they saw an unfinished page and are waiting.
    // Anyone who hasn't opened it yet will simply find their photos there.
    if (!participant.awaitingResultNotice) {
      this.logger.debug(`Gallery email for ${participantId} skipped — participant has not opened a pending gallery`);
      return JobStatus.Skipped;
    }

    const props = { eventName, matchCount, galleryUrl };
    const status = await this.send(
      participant,
      EmailTemplate.GalleryReady,
      galleryReadySubject(props),
      createElement(GalleryReadyEmail, props),
    );

    if (status === JobStatus.Success) {
      const now = new Date();
      // clear the flag so a later batch of matches goes down the digest path
      await this.participantRepository.update(participantId, {
        notifiedFirstAt: now,
        lastNotifiedAt: now,
        awaitingResultNotice: false,
      });
    }
    return status;
  }

  @OnJob({ name: JobName.SendDigest, queue: QueueName.Notification })
  async handleSendDigest({ participantId }: JobOf<JobName.SendDigest>): Promise<JobStatus> {
    const context = await this.loadContext(participantId);
    if (!context) {
      return JobStatus.Skipped;
    }
    const { participant, eventName, galleryUrl } = context;

    if (!participant.notifiedFirstAt) {
      // never had the first email — send that instead
      return this.handleSendGalleryEmail({ participantId });
    }

    // throttle re-check at send time (docs/plan/07 §5)
    const since = participant.lastNotifiedAt ?? participant.notifiedFirstAt;
    const elapsed = Date.now() - since.getTime();
    if (elapsed < DIGEST_THROTTLE_MS) {
      this.logger.debug(`Digest for ${participantId} throttled (${Math.round(elapsed / 60_000)} min since last)`);
      return JobStatus.Skipped;
    }

    const newCount = await this.participantRepository.countMatches(participantId, since);
    if (newCount === 0) {
      return JobStatus.Skipped;
    }

    const props = { eventName, newCount, galleryUrl };
    const status = await this.send(
      participant,
      EmailTemplate.GalleryUpdate,
      galleryUpdateSubject(props),
      createElement(GalleryUpdateEmail, props),
    );

    if (status === JobStatus.Success) {
      await this.participantRepository.update(participantId, { lastNotifiedAt: new Date() });
    }
    return status;
  }

  @OnJob({ name: JobName.SendNoFaceEmail, queue: QueueName.Notification })
  async handleSendNoFaceEmail({ participantId }: JobOf<JobName.SendNoFaceEmail>): Promise<JobStatus> {
    const context = await this.loadContext(participantId);
    if (!context) {
      return JobStatus.Skipped;
    }
    const { participant, eventName, eventSlug } = context;

    const props = { eventName, eventUrl: this.galleryTokenService.eventUrl(eventSlug) };
    return this.send(
      participant,
      EmailTemplate.NoFaceDetected,
      noFaceSubject(),
      createElement(NoFaceDetectedEmail, props),
    );
  }

  private async loadContext(participantId: string) {
    const participant = await this.participantRepository.getById(participantId);
    if (!participant) {
      this.logger.warn(`Participant ${participantId} not found`);
      return undefined;
    }
    const event = await this.eventRepository.getById(participant.eventId);
    if (!event) {
      return undefined;
    }
    const rawToken = this.galleryTokenService.decrypt(participant);
    return {
      participant,
      eventName: event.name,
      eventSlug: event.slug,
      expiresAt: event.expiresAt,
      galleryUrl: rawToken ? this.galleryTokenService.galleryUrl(rawToken) : '',
    };
  }

  // Organizer-facing. Unlike every other job here the recipients are staff,
  // so there is no participant and no gallery token — the email links to the
  // event page in the app, where the extend/delete actions live behind the
  // normal login rather than a magic link.
  @OnJob({ name: JobName.SendEventExpiry, queue: QueueName.Notification })
  async handleSendEventExpiry({ eventId }: JobOf<JobName.SendEventExpiry>): Promise<JobStatus> {
    const event = await this.eventRepository.getById(eventId);
    if (!event || event.deletedAt || !event.expiresAt || !event.purgeAfter) {
      this.logger.warn(`SendEventExpiry skipped — event ${eventId} missing or no longer expiring`);
      return JobStatus.Skipped;
    }

    const owners = await this.eventExpiryService.getOwnerEmails(event.orgId);
    if (owners.length === 0) {
      // Nothing we can do from here, but the purge still goes ahead — so this
      // needs to be loud enough to notice in the log.
      this.logger.error(`Event ${eventId} expired but its organization has no owner to notify`);
      return JobStatus.Skipped;
    }

    const assetCount = await this.assetRepository.countForEvent(eventId);
    const manageUrl = `${this.configRepository.getEnv().publicBaseUrl}/events/${eventId}/settings`;

    let failed = 0;
    for (const owner of owners) {
      const props = {
        eventName: event.name,
        organizerName: owner.name,
        expiresAt: event.expiresAt,
        purgeAfter: event.purgeAfter,
        assetCount,
        manageUrl,
      };
      const ok = await this.sendToAddress(
        { eventId, toEmail: owner.email },
        EmailTemplate.EventExpired,
        eventExpiredSubject(props),
        createElement(EventExpiredEmail, props),
      );
      if (!ok) {
        failed++;
      }
    }

    // Partial success still counts: retrying would re-mail the owners who did
    // receive it, and the expiry mark has already been written.
    return failed === owners.length ? JobStatus.Failed : JobStatus.Success;
  }

  private async sendToAddress(
    context: { eventId: string; toEmail: string },
    template: EmailTemplate,
    subject: string,
    element: Parameters<EmailRepository['renderEmail']>[0],
  ): Promise<boolean> {
    const logId = await this.emailLogRepository.create({
      eventId: context.eventId,
      participantId: null,
      toEmail: context.toEmail,
      template,
      subject,
    });

    try {
      const { html, text } = await this.emailRepository.renderEmail(element);
      const messageId = await this.emailRepository.sendEmail({ to: context.toEmail, subject, html, text });
      await this.emailLogRepository.markSent(logId, messageId);
      this.logger.log(`Sent ${template} to ${context.toEmail}`);
      return true;
    } catch (error) {
      await this.emailLogRepository.markFailed(logId, `${error}`);
      this.logger.error(`Failed to send ${template} to ${context.toEmail}: ${error}`);
      return false;
    }
  }

  private async send(
    participant: { id: string; eventId: string; email: string },
    template: EmailTemplate,
    subject: string,
    element: Parameters<EmailRepository['renderEmail']>[0],
  ): Promise<JobStatus> {
    const logId = await this.emailLogRepository.create({
      eventId: participant.eventId,
      participantId: participant.id,
      toEmail: participant.email,
      template,
      subject,
    });

    try {
      const { html, text } = await this.emailRepository.renderEmail(element);
      const messageId = await this.emailRepository.sendEmail({ to: participant.email, subject, html, text });
      await this.emailLogRepository.markSent(logId, messageId);
      this.logger.log(`Sent ${template} to ${participant.email}`);
      return JobStatus.Success;
    } catch (error) {
      await this.emailLogRepository.markFailed(logId, `${error}`);
      this.logger.error(`Failed to send ${template} to ${participant.email}: ${error}`);
      return JobStatus.Failed;
    }
  }
}
