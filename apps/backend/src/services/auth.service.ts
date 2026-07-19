// Ported pattern from immich:server/src/services/auth.service.ts. Credential
// priority per docs/plan/09-api-surface.md §1: gallery token first, then
// session. Shared-link branch → participant gallery-token branch; roles become
// super-admin / org-role checks.
import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { IncomingHttpHeaders } from 'node:http';
import { AdminSignupDto, AuthDto, ChangePasswordDto, LoginDetails, LoginDto, LoginResponseDto } from 'src/dtos/auth.dto';
import { OrgRole } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { OrganizationRepository } from 'src/repositories/organization.repository';
import { ParticipantRepository } from 'src/repositories/participant.repository';
import { SessionRepository } from 'src/repositories/session.repository';
import { UserRepository } from 'src/repositories/user.repository';

export const SALT_ROUNDS = 10;
export const SESSION_COOKIE = 'el_session';
export const GALLERY_TOKEN_HEADER = 'x-gallery-token';
export const GALLERY_TOKEN_QUERY = 'token';

// member < admin < owner (docs/plan/09 §1)
const ROLE_ORDER: Record<OrgRole, number> = {
  [OrgRole.Member]: 0,
  [OrgRole.Admin]: 1,
  [OrgRole.Owner]: 2,
};

export interface AuthenticateOptions {
  superAdmin?: boolean;
  orgRole?: OrgRole;
  participant?: boolean;
  // Opt-in membership bypass for super admins on org-administration routes.
  // Deliberately fail-closed: without this flag a super admin is treated as a
  // non-member, so any org-scoped route added later (and every event route)
  // stays closed to them until someone opts it in on purpose.
  allowSuperAdmin?: boolean;
}

export interface AuthenticateRequest {
  headers: IncomingHttpHeaders;
  queryParams: Record<string, string>;
  pathParams: Record<string, string>;
  options: AuthenticateOptions;
}

@Injectable()
export class AuthService {
  constructor(
    private configRepository: ConfigRepository,
    private cryptoRepository: CryptoRepository,
    private eventRepository: EventRepository,
    private organizationRepository: OrganizationRepository,
    private participantRepository: ParticipantRepository,
    private sessionRepository: SessionRepository,
    private userRepository: UserRepository,
  ) {}

  async authenticate({ headers, queryParams, pathParams, options }: AuthenticateRequest): Promise<AuthDto> {
    const auth = await this.validate(headers, queryParams);

    if (options.participant) {
      if (auth.participant) {
        return auth;
      }
      // org staff with a session may also hit participant-capable routes
    }

    if (!auth.user) {
      throw new UnauthorizedException('Authentication required');
    }

    if (options.superAdmin && !auth.user.isSuperAdmin) {
      throw new ForbiddenException('Forbidden');
    }

    if (options.orgRole) {
      await this.verifyOrgRole(auth, options.orgRole, pathParams, options.allowSuperAdmin ?? false);
    }

    return auth;
  }

  // Credential priority: gallery token → session (Immich shared-link-first pattern).
  private async validate(headers: IncomingHttpHeaders, queryParams: Record<string, string>): Promise<AuthDto> {
    const galleryToken = (queryParams[GALLERY_TOKEN_QUERY] as string) || (headers[GALLERY_TOKEN_HEADER] as string);
    if (galleryToken) {
      const participant = await this.participantRepository.getByTokenHash(
        this.cryptoRepository.hashSha256(galleryToken),
      );
      if (participant) {
        return { participant };
      }
    }

    const sessionToken = this.extractSessionToken(headers);
    if (sessionToken) {
      const session = await this.sessionRepository.getByToken(this.cryptoRepository.hashSha256(sessionToken));
      if (session) {
        const { user, ...rest } = session;
        return { user, session: rest };
      }
    }

    return {};
  }

  private extractSessionToken(headers: IncomingHttpHeaders): string | undefined {
    const authorization = headers.authorization;
    if (authorization) {
      const [type, token] = authorization.split(' ');
      if (type?.toLowerCase() === 'bearer' && token) {
        return token;
      }
    }

    const cookieHeader = headers.cookie;
    if (cookieHeader) {
      for (const part of cookieHeader.split(';')) {
        const [name, ...rest] = part.trim().split('=');
        if (name === SESSION_COOKIE) {
          return decodeURIComponent(rest.join('='));
        }
      }
    }

    return undefined;
  }

  // Org resolved from orgId/eventId path params, never from the body
  // (docs/plan/09-api-surface.md §1).
  //
  // Super admins administer organizations but have no access to the media
  // inside them: they may bypass membership only on routes that opted in via
  // { allowSuperAdmin: true }, and never on an event-scoped route. Every
  // event route carries :eventId, so that second check is what keeps photos,
  // people and participants out of reach even if a future route opts in by
  // mistake.
  private async verifyOrgRole(
    auth: AuthDto,
    requiredRole: OrgRole,
    pathParams: Record<string, string>,
    allowSuperAdmin: boolean,
  ): Promise<void> {
    const isEventScoped = !!pathParams.eventId;
    if (auth.user!.isSuperAdmin && allowSuperAdmin && !isEventScoped) {
      return;
    }

    let orgId = pathParams.orgId;
    if (!orgId && pathParams.eventId) {
      orgId = (await this.eventRepository.getOrgId(pathParams.eventId)) ?? '';
    }
    if (!orgId) {
      throw new ForbiddenException('Forbidden');
    }

    const membership = await this.organizationRepository.getMembership(orgId, auth.user!.id);
    if (!membership || ROLE_ORDER[membership.role] < ROLE_ORDER[requiredRole]) {
      throw new ForbiddenException('Forbidden');
    }
  }

  // --- login / logout ---

  async login(dto: LoginDto, details: LoginDetails): Promise<LoginResponseDto> {
    const user = await this.userRepository.getByEmail(dto.email);
    if (!user || !this.cryptoRepository.compareBcrypt(dto.password, user.password)) {
      throw new UnauthorizedException('Incorrect email or password');
    }

    return this.createSession(user.id, user.email, user.name, user.isSuperAdmin, details);
  }

  async logout(auth: AuthDto): Promise<void> {
    if (auth.session) {
      await this.sessionRepository.delete(auth.session.id);
    }
  }

  async adminSignup(dto: AdminSignupDto): Promise<LoginResponseDto> {
    if (await this.userRepository.hasAny()) {
      throw new BadRequestException('The server already has an admin');
    }

    const user = await this.userRepository.create({
      email: dto.email,
      name: dto.name,
      password: await this.cryptoRepository.hashBcrypt(dto.password, SALT_ROUNDS),
      isSuperAdmin: true,
    });

    return this.createSession(user.id, user.email, user.name, true, {
      clientIp: '',
      isSecure: false,
      deviceOs: '',
      deviceType: '',
    });
  }

  async changePassword(auth: AuthDto, dto: ChangePasswordDto): Promise<void> {
    const user = await this.userRepository.getById(auth.user!.id);
    if (!user || !this.cryptoRepository.compareBcrypt(dto.password, user.password)) {
      throw new BadRequestException('Wrong password');
    }

    await this.userRepository.update(user.id, {
      password: await this.cryptoRepository.hashBcrypt(dto.newPassword, SALT_ROUNDS),
    });
  }

  private async createSession(
    userId: string,
    email: string,
    name: string,
    isSuperAdmin: boolean,
    details: LoginDetails,
  ): Promise<LoginResponseDto> {
    const { sessionTtlDays } = this.configRepository.getEnv();
    const token = this.cryptoRepository.randomBytesAsText(32);
    const expiresAt = new Date(Date.now() + sessionTtlDays * 24 * 60 * 60 * 1000);

    await this.sessionRepository.create({
      userId,
      token: this.cryptoRepository.hashSha256(token),
      deviceOs: details.deviceOs,
      deviceType: details.deviceType,
      expiresAt,
    });

    return { userId, email, name, isSuperAdmin, accessToken: token };
  }
}
