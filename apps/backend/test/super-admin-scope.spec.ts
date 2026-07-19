// Security boundary: a super admin administers organizations but must never
// reach the media inside them (photos, people, participants, imports).
//
// The rule lives in AuthService.verifyOrgRole and is deliberately fail-closed:
// the membership bypass applies only when a route opts in with
// { allowSuperAdmin: true }, and never when the route is event-scoped. These
// tests pin both halves — a future route that forgets to opt in stays closed,
// and one that opts in by mistake still cannot reach event data.
import { ForbiddenException } from '@nestjs/common';
import { OrgRole } from 'src/enum';
import { AuthService, AuthenticateOptions } from 'src/services/auth.service';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { beforeEach, describe, expect, it } from 'vitest';

const SUPER_ADMIN_TOKEN = 'super-admin-session-token';
const MEMBER_TOKEN = 'member-session-token';

const SUPER_ADMIN = { id: 'sa-1', email: 'root@eventlens.test', name: 'Root', isSuperAdmin: true };
const MEMBER = { id: 'u-1', email: 'staff@org.test', name: 'Staff', isSuperAdmin: false };

const EVENT_ID = 'event-1';
const ORG_ID = 'org-1';

describe('super admin is scoped out of event data', () => {
  let authService: AuthService;
  let crypto: CryptoRepository;

  beforeEach(() => {
    crypto = new CryptoRepository();

    const usersByTokenHash = new Map<string, typeof SUPER_ADMIN>([
      [crypto.hashSha256(SUPER_ADMIN_TOKEN).toString('hex'), SUPER_ADMIN],
      [crypto.hashSha256(MEMBER_TOKEN).toString('hex'), MEMBER],
    ]);

    const sessionRepository = {
      getByToken: async (tokenHash: Buffer) => {
        const user = usersByTokenHash.get(tokenHash.toString('hex'));
        return user ? { id: 'session-1', userId: user.id, user } : undefined;
      },
    };

    // MEMBER belongs to ORG_ID as an admin; SUPER_ADMIN belongs to nothing.
    const organizationRepository = {
      getMembership: async (orgId: string, userId: string) =>
        orgId === ORG_ID && userId === MEMBER.id ? { orgId, userId, role: OrgRole.Admin } : undefined,
    };

    const eventRepository = { getOrgId: async () => ORG_ID };
    const participantRepository = { getByTokenHash: async () => undefined };

    authService = new AuthService(
      { getEnv: () => ({ sessionTtlDays: 90 }) } as any,
      crypto,
      eventRepository as any,
      organizationRepository as any,
      participantRepository as any,
      sessionRepository as any,
      {} as any,
    );
  });

  const authenticate = (token: string, options: AuthenticateOptions, pathParams: Record<string, string>) =>
    authService.authenticate({
      headers: { authorization: `Bearer ${token}` },
      queryParams: {},
      pathParams,
      options,
    });

  it('denies a super admin every event-scoped route', async () => {
    // Each of these is a real route shape: assets, people, participants,
    // imports and the event itself all resolve org access via :eventId.
    for (const role of [OrgRole.Member, OrgRole.Admin, OrgRole.Owner]) {
      await expect(authenticate(SUPER_ADMIN_TOKEN, { orgRole: role }, { eventId: EVENT_ID })).rejects.toThrow(
        ForbiddenException,
      );
    }
  });

  it('denies a super admin an event-scoped route even if it opts into the bypass', async () => {
    // Defence in depth: allowSuperAdmin must not be able to unlock event data.
    await expect(
      authenticate(SUPER_ADMIN_TOKEN, { orgRole: OrgRole.Member, allowSuperAdmin: true }, { eventId: EVENT_ID }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('denies a super admin org-scoped routes that did not opt in', async () => {
    // GET/POST /orgs/:orgId/events is org-scoped but exposes event names, so
    // it deliberately stays closed.
    await expect(authenticate(SUPER_ADMIN_TOKEN, { orgRole: OrgRole.Member }, { orgId: ORG_ID })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows a super admin org-administration routes that opted in', async () => {
    const auth = await authenticate(
      SUPER_ADMIN_TOKEN,
      { orgRole: OrgRole.Owner, allowSuperAdmin: true },
      { orgId: ORG_ID },
    );
    expect(auth.user?.isSuperAdmin).toBe(true);
  });

  it('still lets an ordinary member reach their own org events', async () => {
    const auth = await authenticate(MEMBER_TOKEN, { orgRole: OrgRole.Member }, { eventId: EVENT_ID });
    expect(auth.user?.id).toBe(MEMBER.id);
  });

  it('does not let a member exceed their role', async () => {
    await expect(authenticate(MEMBER_TOKEN, { orgRole: OrgRole.Owner }, { orgId: ORG_ID })).rejects.toThrow(
      ForbiddenException,
    );
  });
});
