import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AddMemberDto, CreateOrgDto, UpdateMemberDto, UpdateOrgDto } from 'src/dtos/org.dto';
import { JobName, OrgRole } from 'src/enum';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { OrgMember, OrganizationRepository } from 'src/repositories/organization.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { Organization } from 'src/schema';
import { SALT_ROUNDS } from 'src/services/auth.service';
import { StorageKeys } from 'src/utils/storage-keys';

@Injectable()
export class OrganizationService {
  constructor(
    private cryptoRepository: CryptoRepository,
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
