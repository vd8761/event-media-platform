// One place that answers "what is this organisation allowed, and has it run
// out". Both the enforcement points and the UI read from here, so the number a
// user is shown in the sidebar is by construction the same number that blocks
// their upload — a quota that displays one figure and enforces another is worse
// than no quota at all.
import { BadRequestException, Injectable } from '@nestjs/common';
import { OrgPlan, PLAN_LIMITS } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { OrganizationRepository } from 'src/repositories/organization.repository';
import { Organization } from 'src/schema';

export interface QuotaStatus {
  plan: OrgPlan;
  storage: { usedBytes: number; limitBytes: number; remainingBytes: number };
  events: { used: number; limit: number; remaining: number };
  // True when a super admin has negotiated limits for this org rather than
  // taking the plan's own. Surfaced so the UI can say "custom" instead of
  // quoting a plan figure that does not apply.
  hasCustomLimits: boolean;
}

const formatBytes = (bytes: number) => {
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 1 ? `${Number(gb.toFixed(gb >= 10 ? 0 : 1))} GB` : `${Math.round(bytes / (1024 * 1024))} MB`;
};

@Injectable()
export class QuotaService {
  constructor(
    private assetRepository: AssetRepository,
    private eventRepository: EventRepository,
    private organizationRepository: OrganizationRepository,
  ) {}

  // Overrides win, and only Enterprise is allowed to have them (enforced where
  // they are set). Reading is deliberately permissive: if an org was downgraded
  // while holding an override, we still honour the stored number rather than
  // silently shrinking a customer mid-contract.
  limitsFor(org: Pick<Organization, 'plan' | 'storageLimitBytes' | 'eventLimit'>) {
    const plan = PLAN_LIMITS[org.plan];
    return {
      storageBytes: org.storageLimitBytes ?? plan.storageBytes,
      events: org.eventLimit ?? plan.events,
      hasCustomLimits: org.storageLimitBytes !== null || org.eventLimit !== null,
    };
  }

  async getStatus(orgId: string): Promise<QuotaStatus> {
    const org = await this.organizationRepository.getById(orgId);
    if (!org) {
      throw new BadRequestException('Organization not found');
    }

    const limits = this.limitsFor(org);
    const [usedBytes, usedEvents] = await Promise.all([
      this.assetRepository.getOrgStorageBytes(orgId),
      this.eventRepository.countForOrg(orgId),
    ]);

    return {
      plan: org.plan,
      storage: {
        usedBytes,
        limitBytes: limits.storageBytes,
        // Clamped at zero: an org that went over via a super-admin downgrade
        // should read "0 remaining", not a negative number.
        remainingBytes: Math.max(0, limits.storageBytes - usedBytes),
      },
      events: {
        used: usedEvents,
        limit: limits.events,
        remaining: Math.max(0, limits.events - usedEvents),
      },
      hasCustomLimits: limits.hasCustomLimits,
    };
  }

  // Called before an upload is accepted. Takes the incoming size so the check
  // is "would this put them over", not "are they already over" — otherwise the
  // last upload before the limit is always allowed to be arbitrarily large.
  async assertStorageAvailable(orgId: string, incomingBytes: number): Promise<void> {
    const status = await this.getStatus(orgId);
    if (status.storage.usedBytes + incomingBytes <= status.storage.limitBytes) {
      return;
    }

    throw new BadRequestException(
      `Storage limit reached — ${formatBytes(status.storage.usedBytes)} of ` +
        `${formatBytes(status.storage.limitBytes)} used on the ${status.plan} plan. ` +
        `${this.upgradeHint(status.plan)}`,
    );
  }

  async assertEventAvailable(orgId: string): Promise<void> {
    const status = await this.getStatus(orgId);
    if (status.events.used < status.events.limit) {
      return;
    }

    throw new BadRequestException(
      `Event limit reached — ${status.events.used} of ${status.events.limit} events on the ` +
        `${status.plan} plan. ${this.upgradeHint(status.plan)}`,
    );
  }

  // Named for what the customer can do about it, not for what failed. An error
  // that only says "limit reached" leaves someone stuck on a page with no idea
  // whether this is permanent.
  private upgradeHint(plan: OrgPlan): string {
    switch (plan) {
      case OrgPlan.Starter: {
        return 'Upgrade to Pro for 10 GB and 5 events.';
      }
      case OrgPlan.Pro: {
        return 'Upgrade to Enterprise for more.';
      }
      default: {
        return 'Contact your administrator to raise this limit.';
      }
    }
  }
}
