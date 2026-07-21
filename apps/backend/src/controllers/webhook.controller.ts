// Provider webhooks. Unauthenticated by necessity — the sender is Resend, not
// a logged-in user — so the signature is the only thing standing between the
// internet and these writes. Anything that fails verification is dropped
// before the body is looked at.
import { Body, Controller, Get, Headers, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { EmailStatus } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { EmailLogRepository } from 'src/repositories/email-log.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { GpuLifecycleService } from 'src/services/gpu-lifecycle.service';
import { verifySvixSignature } from 'src/utils/svix-signature';

// Only the states worth recording. `email.sent` is already written when we
// hand the message over, and opened/clicked are engagement rather than
// deliverability, so they are acknowledged and ignored.
const STATUS_BY_EVENT: Record<string, EmailStatus> = {
  'email.delivered': EmailStatus.Delivered,
  'email.bounced': EmailStatus.Bounced,
  'email.complained': EmailStatus.Complained,
  'email.failed': EmailStatus.Failed,
};

interface ResendEvent {
  type?: string;
  created_at?: string;
  data?: { email_id?: string; bounce?: { message?: string }; reason?: string };
}

@ApiExcludeController()
@Controller('webhooks')
export class WebhookController {
  constructor(
    private configRepository: ConfigRepository,
    private emailLogRepository: EmailLogRepository,
    private gpuLifecycleService: GpuLifecycleService,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(WebhookController.name);
  }

  // Polled by the shutdown script on the GPU box. Answering `keepAlive: false`
  // — or not answering at all — tells it to power itself down.
  //
  // Authenticated with a shared secret rather than a session: the caller is a
  // machine with no user. It is read-only and leaks only queue depth, so a
  // static token is proportionate.
  @Get('gpu/heartbeat')
  async gpuHeartbeat(@Headers('authorization') authorization: string) {
    const expected = this.configRepository.getEnv().gpuHeartbeatToken;
    if (!expected) {
      this.logger.warn('GPU heartbeat called but EL_GPU_HEARTBEAT_TOKEN is not set — rejecting');
      throw new UnauthorizedException();
    }
    const presented = (authorization ?? '').replace(/^Bearer\s+/i, '');
    // Constant-time: this token is long-lived, so a timing oracle on it is
    // worth closing even though the endpoint is read-only.
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException();
    }

    return this.gpuLifecycleService.heartbeat();
  }

  @Post('resend')
  @HttpCode(204)
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  async resend(
    @Req() request: Request & { rawBody?: Buffer },
    @Headers('svix-id') id: string,
    @Headers('svix-timestamp') timestamp: string,
    @Headers('svix-signature') signature: string,
    @Body() body: ResendEvent,
  ): Promise<void> {
    const secret = this.configRepository.getEnv().email.webhookSecret;
    if (!secret) {
      // Unconfigured means "not accepting webhooks" — anything else would let
      // an unauthenticated caller write delivery status.
      this.logger.warn('Resend webhook received but RESEND_WEBHOOK_SECRET is not set — rejecting');
      throw new UnauthorizedException();
    }

    // Signature is over the exact bytes received; the parsed body would
    // re-serialise differently and never match.
    const rawBody = request.rawBody?.toString('utf8');
    if (!rawBody) {
      this.logger.warn('Resend webhook rejected: raw body unavailable');
      throw new UnauthorizedException();
    }

    const result = verifySvixSignature(rawBody, { id, timestamp, signature }, secret);
    if (!result.valid) {
      // 401 rather than a quiet 2xx: a wrong secret then shows up as failed
      // deliveries in Resend's dashboard instead of silently doing nothing.
      this.logger.warn(`Resend webhook rejected: ${result.reason}`);
      throw new UnauthorizedException();
    }

    const status = body.type ? STATUS_BY_EVENT[body.type] : undefined;
    const messageId = body.data?.email_id;
    if (!status || !messageId) {
      return;
    }

    const occurredAt = body.created_at ? new Date(body.created_at) : new Date();
    const detail = body.data?.bounce?.message ?? body.data?.reason;
    const matched = await this.emailLogRepository.applyProviderStatus(
      messageId,
      status,
      Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
      detail,
    );

    if (matched) {
      this.logger.debug(`Resend webhook: ${body.type} → ${messageId}`);
    }
  }
}
