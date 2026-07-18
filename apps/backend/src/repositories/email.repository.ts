// Ported pattern from immich:server/src/repositories/email.repository.ts —
// nodemailer transport + react-email render. SMTP config from env (bootstrap);
// runtime overrides can land in system_config later.
import { Injectable } from '@nestjs/common';
import { render } from '@react-email/render';
import { createTransport, Transporter } from 'nodemailer';
import * as React from 'react';
import { ConfigRepository } from 'src/repositories/config.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class EmailRepository {
  private transporter?: Transporter;
  private from: string;

  constructor(
    private configRepository: ConfigRepository,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(EmailRepository.name);
    const { smtp } = this.configRepository.getEnv();
    this.from = smtp.from || 'EventLens <noreply@eventlens.local>';
    if (smtp.host) {
      this.transporter = createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.port === 465,
        auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
      });
    } else {
      this.logger.warn('SMTP_HOST not configured — emails will fail until it is set');
    }
  }

  async renderEmail(element: React.ReactElement): Promise<{ html: string; text: string }> {
    const html = await render(element);
    const text = await render(element, { plainText: true });
    return { html, text };
  }

  async sendEmail({ to, subject, html, text }: SendEmailOptions): Promise<string> {
    if (!this.transporter) {
      throw new Error('SMTP is not configured (SMTP_HOST missing)');
    }
    const info = await this.transporter.sendMail({ from: this.from, to, subject, html, text });
    return info.messageId as string;
  }
}
