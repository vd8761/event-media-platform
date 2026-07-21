import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AddMemberDto, CreateOrgDto, UpdateMemberDto, UpdateOrgDto } from 'src/dtos/org.dto';
import { JobName, OrgRole } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { OrgMember, OrganizationRepository } from 'src/repositories/organization.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { Organization } from 'src/schema';
import { SALT_ROUNDS } from 'src/services/auth.service';
import { StorageKeys } from 'src/utils/storage-keys';

export interface OrgNotification {
  id: string;
  level: 'info' | 'warning';
  title: string;
  body: string;
  eventId: string;
  at: Date;
}

const SHELL_URL_TTL = 3600; // 1 h presigned, same as the gallery lists
// How close an expiry has to be before the bell mentions it.
const EXPIRY_WARNING_DAYS = 14;

@Injectable()
export class OrganizationService {
  constructor(
    private assetRepository: AssetRepository,
    private cryptoRepository: CryptoRepository,
    private eventRepository: EventRepository,
    private storageRepository: StorageRepository,
    private jobRepository: JobRepository,
    private organizationRepository: OrganizationRepository,
    private userRepository: UserRepository,
  ) {}

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
    const [events, storage] = await Promise.all([
      this.eventRepository.listForSidebar(orgId),
      this.assetRepository.getOrgStorage(orgId),
    ]);

    return {
      storage,
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
