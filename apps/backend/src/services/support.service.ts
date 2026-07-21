// Support messages from the Help dialog (organiser) and the public event
// pages. Every submission is stored first and emailed second: the admin
// Support tab is the source of truth, and a mail outage must never lose a
// message. Delivery failures are logged, not thrown, for the same reason.
import { Injectable } from '@nestjs/common';
import { createElement } from 'react';
import { SupportRequestEmail, subject as supportSubject } from 'src/emails/support-request.email';
import { SupportSource, SupportStatus } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { EmailRepository } from 'src/repositories/email.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { OrganizationRepository } from 'src/repositories/organization.repository';
import { SupportRepository } from 'src/repositories/support.repository';
import { UserRepository } from 'src/repositories/user.repository';
import {
  CreatePublicSupportTicketDto,
  CreateSupportTicketDto,
  UpdateSupportTicketDto,
} from 'src/dtos/support.dto';

@Injectable()
export class SupportService {
  constructor(
    private configRepository: ConfigRepository,
    private emailRepository: EmailRepository,
    private eventRepository: EventRepository,
    private logger: LoggingRepository,
    private organizationRepository: OrganizationRepository,
    private supportRepository: SupportRepository,
    private userRepository: UserRepository,
  ) {
    this.logger.setContext(SupportService.name);
  }

  // Organiser submission: identity comes from the session, so the form only
  // needs the message.
  async createForOrg(orgId: string, userId: string, dto: CreateSupportTicketDto): Promise<{ id: string }> {
    const [org, user] = await Promise.all([
      this.organizationRepository.getById(orgId),
      this.userRepository.getById(userId),
    ]);

    const ticket = await this.supportRepository.create({
      source: SupportSource.Organization,
      orgId,
      userId,
      eventId: null,
      name: user?.name ?? null,
      email: user?.email ?? null,
      message: dto.message,
    });

    await this.notify({
      source: SupportSource.Organization,
      message: dto.message,
      name: user?.name ?? null,
      email: user?.email ?? null,
      orgName: org?.name ?? null,
      eventName: null,
    });

    return { id: ticket.id };
  }

  // Public submission from a guest page. Unauthenticated, so nothing here is
  // trusted for anything beyond display — the event id is resolved against the
  // database rather than echoed back.
  async createPublic(dto: CreatePublicSupportTicketDto): Promise<{ id: string }> {
    const event = dto.eventId ? await this.eventRepository.getById(dto.eventId) : null;

    const ticket = await this.supportRepository.create({
      source: SupportSource.Public,
      orgId: event?.orgId ?? null,
      userId: null,
      eventId: event?.id ?? null,
      name: dto.name ?? null,
      email: dto.email ?? null,
      message: dto.message,
    });

    await this.notify({
      source: SupportSource.Public,
      message: dto.message,
      name: dto.name ?? null,
      email: dto.email ?? null,
      orgName: null,
      eventName: event?.name ?? null,
    });

    return { id: ticket.id };
  }

  list(status?: SupportStatus) {
    return this.supportRepository.list(status);
  }

  countOpen() {
    return this.supportRepository.countOpen();
  }

  async update(id: string, dto: UpdateSupportTicketDto): Promise<void> {
    await this.supportRepository.setStatus(id, dto.status);
  }

  // Sent straight through the email repository rather than the notification
  // queue: this is internal mail with no participant and no email_log template,
  // and the ticket row already survives if delivery fails.
  private async notify(props: {
    source: SupportSource;
    message: string;
    name: string | null;
    email: string | null;
    orgName: string | null;
    eventName: string | null;
  }): Promise<void> {
    const { email, publicBaseUrl } = this.configRepository.getEnv();
    if (!email.supportTo) {
      this.logger.warn('EL_SUPPORT_EMAIL is not set — support ticket stored but not emailed');
      return;
    }

    const emailProps = { ...props, adminUrl: `${publicBaseUrl}/admin/support` };

    try {
      const { html, text } = await this.emailRepository.renderEmail(
        createElement(SupportRequestEmail, emailProps),
      );
      await this.emailRepository.sendEmail({
        to: email.supportTo,
        subject: supportSubject(emailProps),
        html,
        text,
      });
    } catch (error) {
      this.logger.error(`Failed to email support ticket: ${error}`);
    }
  }
}
