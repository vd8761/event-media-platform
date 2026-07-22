import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AddMemberDto, CreateOrgDto, UpdateMemberDto, UpdateOrgDto } from 'src/dtos/org.dto';
import { AuditCategory, AuditLevel, JobName, OrgPlan, OrgRole } from 'src/enum';
import { PasswordResetEmail, subject as passwordResetSubject } from 'src/emails/password-reset.email';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { EmailRepository } from 'src/repositories/email.repository';
import { PasswordResetRepository } from 'src/repositories/password-reset.repository';
import { SessionRepository } from 'src/repositories/session.repository';
import { AuditLogService } from 'src/services/audit-log.service';
import { EventRepository } from 'src/repositories/event.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { OrgMember, OrganizationRepository } from 'src/repositories/organization.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { QuotaService } from 'src/services/quota.service';
import { Organization } from 'src/schema';
import { SALT_ROUNDS } from 'src/services/auth.service';
import { StorageKeys } from 'src/utils/storage-keys';

// One row of the super-admin organizations table. `owner` is nullable because
// an org whose owner account was deleted still exists and still needs to be
// visible — hiding it would make the orphan impossible to find and fix.
export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: OrgPlan;
  createdAt: Date;
  storageLimitBytes: number | null;
  eventLimit: number | null;
  owner: { id: string; email: string; name: string } | null;
  usage: {
    storage: { usedBytes: number; limitBytes: number; remainingBytes: number };
    events: { used: number; limit: number; remaining: number };
    hasCustomLimits: boolean;
  };
}

export interface OrgNotification {
  id: string;
  level: 'info' | 'warning';
  title: string;
  body: string;
  eventId: string;
  at: Date;
}

// Long enough that an organiser who reads email once a day still gets in,
// short enough that a link sitting in a mailbox is not a standing key.
const PASSWORD_RESET_TTL_MS = 24 * 60 * 60 * 1000;

const SHELL_URL_TTL = 3600; // 1 h presigned, same as the gallery lists
// How close an expiry has to be before the bell mentions it.
const EXPIRY_WARNING_DAYS = 14;

@Injectable()
export class OrganizationService {
  constructor(
    private assetRepository: AssetRepository,
    private auditLogService: AuditLogService,
    private configRepository: ConfigRepository,
    private cryptoRepository: CryptoRepository,
    private emailRepository: EmailRepository,
    private passwordResetRepository: PasswordResetRepository,
    private sessionRepository: SessionRepository,
    private eventRepository: EventRepository,
    private storageRepository: StorageRepository,
    private jobRepository: JobRepository,
    private organizationRepository: OrganizationRepository,
    private personRepository: PersonRepository,
    private quotaService: QuotaService,
    private userRepository: UserRepository,
  ) {}

  // Super-admin organizations table. Resolves each org's effective limits here
  // rather than in the client: the "null means use the plan default" rule lives
  // in QuotaService, and duplicating it in the frontend is how the two drift.
  async listWithUsage(): Promise<OrgSummary[]> {
    const rows = await this.organizationRepository.listWithUsage();
    return rows.map((row) => {
      const limits = this.quotaService.limitsFor(row);
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status,
        plan: row.plan,
        createdAt: row.createdAt,
        storageLimitBytes: row.storageLimitBytes,
        eventLimit: row.eventLimit,
        owner:
          row.ownerId && row.ownerEmail
            ? { id: row.ownerId, email: row.ownerEmail, name: row.ownerName ?? '' }
            : null,
        usage: {
          storage: {
            usedBytes: row.usedBytes,
            limitBytes: limits.storageBytes,
            remainingBytes: Math.max(0, limits.storageBytes - row.usedBytes),
          },
          events: {
            used: row.usedEvents,
            limit: limits.events,
            remaining: Math.max(0, limits.events - row.usedEvents),
          },
          hasCustomLimits: limits.hasCustomLimits,
        },
      };
    });
  }

  list(): Promise<Organization[]> {
    return this.organizationRepository.list();
  }

  listForUser(userId: string) {
    return this.organizationRepository.listForUser(userId);
  }

  // Everything the app shell needs for one organization in a single call:
  // the events list with covers, and the storage figure in the sidebar footer.
  // One request rather than three keeps the shell from flashing in stages.
  async getShell(orgId: string) {
    const [events, storage, namedPeople] = await Promise.all([
      this.eventRepository.listForSidebar(orgId),
      this.assetRepository.getOrgStorage(orgId),
      // Counted here rather than fetched by the sidebar: it decides whether a
      // nav entry renders at all, so it has to arrive with the rest of the
      // shell or the entry would pop in a moment after the page settles.
      this.personRepository.countNamedForOrg(orgId),
    ]);

    return {
      storage,
      namedPeople,
      events: await Promise.all(
        events.map(async (event) => {
          const key = event.coverKey ?? event.fallbackCoverKey;
          return {
            id: event.id,
            name: event.name,
            slug: event.slug,
            status: event.status,
            startsAt: event.startsAt,
            expiresAt: event.expiresAt,
            purgedAt: event.purgedAt,
            assetCount: event.assetCount ?? 0,
            coverUrl: key ? await this.storageRepository.presignGet(key, { expiresIn: SHELL_URL_TTL }) : null,
          };
        }),
      ),
    };
  }

  // Account-usage statistics (Immich's UserUsageStatistic, per organisation):
  // org-wide totals plus a per-event photo/video/size breakdown.
  async getUsage(orgId: string) {
    const events = await this.assetRepository.getOrgUsageByEvent(orgId);

    return {
      events,
      totals: {
        events: events.length,
        photos: events.reduce((sum, event) => sum + event.photos, 0),
        videos: events.reduce((sum, event) => sum + event.videos, 0),
        bytes: events.reduce((sum, event) => sum + event.bytes, 0),
      },
    };
  }

  // Organizer-facing feed for the notification bell. Derived from event state
  // rather than a notifications table — there is nothing to mark as read yet,
  // and a stored feed would need its own lifecycle.
  async getNotifications(orgId: string) {
    const events = await this.eventRepository.listForSidebar(orgId);
    const now = Date.now();

    const items = events.flatMap((event): OrgNotification[] => {
      if (event.purgedAt) {
        return [
          {
            id: `purged-${event.id}`,
            level: 'info' as const,
            title: `${event.name} media deleted`,
            body: 'The photos for this expired event have been removed from storage.',
            eventId: event.id,
            at: event.purgedAt,
          },
        ];
      }

      if (!event.expiresAt) {
        return [];
      }

      const expiresAt = new Date(event.expiresAt);
      if (expiresAt.getTime() <= now) {
        return [
          {
            id: `expired-${event.id}`,
            level: 'warning' as const,
            title: `${event.name} has closed`,
            body: 'Guest links are shut. Extend the date or delete the photos.',
            eventId: event.id,
            at: event.expiresAt,
          },
        ];
      }

      // Only warn once it is close enough to act on; a date months out is not
      // news and would sit in the bell forever.
      const daysLeft = Math.ceil((expiresAt.getTime() - now) / 86_400_000);
      return daysLeft <= EXPIRY_WARNING_DAYS
        ? [
            {
              id: `expiring-${event.id}`,
              level: 'info' as const,
              title: `${event.name} closes in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
              body: 'Guest gallery links stop working then.',
              eventId: event.id,
              at: event.expiresAt,
            },
          ]
        : [];
    });

    // Most urgent first: warnings above notices, newest within each.
    items.sort((a, b) => {
      if (a.level !== b.level) {
        return a.level === 'warning' ? -1 : 1;
      }
      return new Date(b.at).getTime() - new Date(a.at).getTime();
    });

    return { items, unread: items.filter((item) => item.level === 'warning').length };
  }

  async get(orgId: string): Promise<Organization> {
    const org = await this.organizationRepository.getById(orgId);
    if (!org) {
      throw new NotFoundException('Organization not found');
    }
    return org;
  }

  // Super-admin: create org + initial owner (create-or-invite by email).
  async create(dto: CreateOrgDto, createdBy: string): Promise<Organization> {
    if (await this.organizationRepository.getBySlug(dto.slug)) {
      throw new BadRequestException('Slug already in use');
    }

    const owner = await this.resolveUser(dto.owner.email, dto.owner.name, dto.owner.password);
    const org = await this.organizationRepository.create({ name: dto.name, slug: dto.slug, createdBy });
    await this.organizationRepository.addMember(org.id, owner.id, OrgRole.Owner);
    return org;
  }

  async update(orgId: string, dto: UpdateOrgDto): Promise<Organization> {
    await this.get(orgId);
    if (dto.slug) {
      const existing = await this.organizationRepository.getBySlug(dto.slug);
      if (existing && existing.id !== orgId) {
        throw new BadRequestException('Slug already in use');
      }
    }
    return this.organizationRepository.update(orgId, dto);
  }

  // Super-admin only. Two rules live here rather than in the DTO because both
  // depend on the resulting plan, not just the submitted fields.
  //
  //  1. Only Enterprise may carry custom limits. Starter and Pro are fixed
  //     products; letting an admin quietly grant a Starter org 500 GB makes the
  //     plan meaningless and the billing unexplainable.
  //  2. Downgrading off Enterprise clears the overrides, so an org cannot keep
  //     negotiated limits it is no longer paying for.
  async updatePlan(
    orgId: string,
    dto: { plan?: OrgPlan; storageLimitBytes?: number | null; eventLimit?: number | null },
    actorId: string,
  ): Promise<Organization> {
    const before = await this.get(orgId);
    const plan = dto.plan ?? before.plan;

    const wantsOverride = dto.storageLimitBytes != null || dto.eventLimit != null;
    if (wantsOverride && plan !== OrgPlan.Enterprise) {
      throw new BadRequestException(
        'Custom storage and event limits are only available on the Enterprise plan. Change the plan first.',
      );
    }

    const patch: Parameters<OrganizationRepository['update']>[1] = { plan };
    if (plan === OrgPlan.Enterprise) {
      if (dto.storageLimitBytes !== undefined) {
        patch.storageLimitBytes = dto.storageLimitBytes;
      }
      if (dto.eventLimit !== undefined) {
        patch.eventLimit = dto.eventLimit;
      }
    } else {
      patch.storageLimitBytes = null;
      patch.eventLimit = null;
    }

    const after = await this.organizationRepository.update(orgId, patch);

    await this.auditLogService.record({
      category: AuditCategory.Subscription,
      action: before.plan === after.plan ? 'subscription.limits.changed' : 'subscription.plan.changed',
      level: AuditLevel.Warning,
      message:
        before.plan === after.plan
          ? `Custom limits changed for "${after.name}" (${after.plan})`
          : `"${after.name}" moved from ${before.plan} to ${after.plan}`,
      detail: {
        from: { plan: before.plan, storageLimitBytes: before.storageLimitBytes, eventLimit: before.eventLimit },
        to: { plan: after.plan, storageLimitBytes: after.storageLimitBytes, eventLimit: after.eventLimit },
      },
      orgId,
      userId: actorId,
    });

    return after;
  }

  async remove(orgId: string): Promise<void> {
    await this.get(orgId);
    await this.organizationRepository.softDelete(orgId);
    // cascade R2 deletion for the whole org (docs/plan/04-storage-r2.md §6)
    await this.jobRepository.queue({
      name: JobName.CleanupPrefix,
      data: { prefix: StorageKeys.orgPrefix(orgId) },
    });
  }

  // --- members ---

  listMembers(orgId: string): Promise<OrgMember[]> {
    return this.organizationRepository.listMembers(orgId);
  }

  async addMember(orgId: string, dto: AddMemberDto): Promise<void> {
    await this.get(orgId);
    const user = await this.resolveUser(dto.email, dto.name ?? dto.email.split('@')[0], dto.password);
    await this.organizationRepository.addMember(orgId, user.id, dto.role);
  }

  async updateMember(orgId: string, userId: string, dto: UpdateMemberDto): Promise<void> {
    const membership = await this.organizationRepository.getMembership(orgId, userId);
    if (!membership) {
      throw new NotFoundException('Member not found');
    }
    await this.ensureNotLastOwner(orgId, userId, dto.role);
    await this.organizationRepository.addMember(orgId, userId, dto.role);
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    const membership = await this.organizationRepository.getMembership(orgId, userId);
    if (!membership) {
      throw new NotFoundException('Member not found');
    }
    await this.ensureNotLastOwner(orgId, userId);
    await this.organizationRepository.removeMember(orgId, userId);
  }

  private async ensureNotLastOwner(orgId: string, userId: string, newRole?: OrgRole): Promise<void> {
    if (newRole === OrgRole.Owner) {
      return;
    }
    const members = await this.organizationRepository.listMembers(orgId);
    const owners = members.filter((member) => member.role === OrgRole.Owner);
    if (owners.length === 1 && owners[0].userId === userId) {
      throw new BadRequestException('Cannot remove the last owner');
    }
  }

  // Super-admin password reset for an organization account.
  //
  // The new password is generated here, emailed to the account holder, and
  // never returned to the caller. A super admin who could read it could sign
  // in as the organization and act as them inside an account full of other
  // people's photos, with the audit trail showing the organization rather than
  // the admin. Generating it out of reach keeps "admin reset the password"
  // and "admin used the account" as two distinguishable events.
  async resetMemberPassword(orgId: string, userId: string, actorId: string): Promise<void> {
    const membership = await this.organizationRepository.getMembership(orgId, userId);
    if (!membership) {
      throw new NotFoundException('Member not found');
    }
    const user = await this.userRepository.getById(userId);
    if (!user) {
      throw new NotFoundException('Member not found');
    }

    // The account is locked rather than given a new usable password: the
    // existing password is replaced with a random value nobody holds, so the
    // old credential dies immediately and the only way back in is the emailed
    // link. This matters when the reason for the reset is that someone else
    // knows the current password.
    await this.userRepository.update(user.id, {
      password: await this.cryptoRepository.hashBcrypt(this.cryptoRepository.randomBytesAsText(32), SALT_ROUNDS),
    });

    // Sign them out everywhere. A reset that leaves live sessions running does
    // not actually take the account back from whoever prompted the reset.
    await this.sessionRepository.deleteForUser(user.id);

    // Any earlier outstanding link stops working — two live reset paths for
    // one account is one more than should ever exist.
    await this.passwordResetRepository.invalidateForUser(user.id);

    const token = this.cryptoRepository.randomBytesAsText(32);
    await this.passwordResetRepository.create({
      userId: user.id,
      // Hash only. The raw token exists in exactly one place: the email.
      token: this.cryptoRepository.hashSha256(token),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      createdBy: actorId,
    });

    const { html, text } = await this.emailRepository.renderEmail(
      PasswordResetEmail({
        name: user.name,
        resetUrl: `${this.configRepository.getEnv().publicBaseUrl}/reset-password?token=${encodeURIComponent(token)}`,
        expiresInHours: PASSWORD_RESET_TTL_MS / (60 * 60 * 1000),
      }),
    );
    await this.emailRepository.sendEmail({ to: user.email, subject: passwordResetSubject(), html, text });

    await this.auditLogService.record({
      category: AuditCategory.Auth,
      action: 'password.reset.admin',
      level: AuditLevel.Warning,
      message: `Super admin reset the password for ${user.email}`,
      orgId,
      userId: actorId,
      // The password itself is deliberately absent. This row records that a
      // reset happened and who did it, not what the credential is.
      detail: { targetUserId: user.id, targetEmail: user.email },
    });
  }

  private async resolveUser(email: string, name: string, password?: string) {
    const existing = await this.userRepository.getByEmail(email);
    if (existing) {
      return existing;
    }
    if (!password) {
      throw new BadRequestException(`User ${email} does not exist — provide a password to create them`);
    }
    return this.userRepository.create({
      email,
      name,
      password: await this.cryptoRepository.hashBcrypt(password, SALT_ROUNDS),
    });
  }
}
