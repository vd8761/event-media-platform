// Ported pattern from immich:server/src/repositories/email.repository.ts —
// react-email render + a pluggable transport. Two providers are supported so
// the same build runs against Mailpit locally and Resend in production:
//   EMAIL_PROVIDER=smtp   → nodemailer (Mailpit, Resend's SMTP gateway, SES…)
//   EMAIL_PROVIDER=resend → Resend's REST API
// Unset picks Resend when RESEND_API_KEY is present, otherwise SMTP.
import { Injectable } from '@nestjs/common';
import { render } from '@react-email/render';
import { createTransport, Transporter } from 'nodemailer';
import * as React from 'react';
import { ConfigRepository } from 'src/repositories/config.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 15_000;

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class EmailRepository {
  private transporter?: Transporter;
  private provider: 'resend' | 'smtp';
  private resendApiKey?: string;
  private from: string;

  constructor(
    private configRepository: ConfigRepository,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(EmailRepository.name);
    const { provider, from, resend, smtp } = this.configRepository.getEnv().email;
    this.provider = provider;
    this.from = from;

    if (provider === 'resend') {
      this.resendApiKey = resend.apiKey;
      if (!this.resendApiKey) {
        this.logger.warn('EMAIL_PROVIDER=resend but RESEND_API_KEY is not set — emails will fail');
      }
      return;
    }

    if (smtp.host) {
      this.transporter = createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
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

  async sendEmail(options: SendEmailOptions): Promise<string> {
    return this.provider === 'resend' ? this.sendViaResend(options) : this.sendViaSmtp(options);
  }

  private async sendViaSmtp({ to, subject, html, text }: SendEmailOptions): Promise<string> {
    if (!this.transporter) {
      throw new Error('SMTP is not configured (SMTP_HOST missing)');
    }
    const info = await this.transporter.sendMail({ from: this.from, to, subject, html, text });
    return info.messageId as string;
  }

  // Plain fetch rather than the `resend` SDK: one HTTP call, no extra dep, and
  // the caller (notification.service) already owns retry via BullMQ.
  private async sendViaResend({ to, subject, html, text }: SendEmailOptions): Promise<string> {
    if (!this.resendApiKey) {
      throw new Error('Resend is not configured (RESEND_API_KEY missing)');
    }

    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.resendApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: this.from, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Resend returns { statusCode, name, message }; surface it so the failed
      // job in the queue dashboard says why rather than just "500".
      const detail = await response.text().catch(() => '');
      throw new Error(`Resend rejected the message (${response.status}): ${detail || response.statusText}`);
    }

    const body = (await response.json()) as { id?: string };
    return body.id ?? '';
  }
}
