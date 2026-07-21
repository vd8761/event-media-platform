import { redirect } from '@sveltejs/kit';

export async function load({ parent }) {
  // Photos is org-scoped, and a super admin belongs to none — send them to the
  // surface they actually own rather than an empty timeline.
  const { me } = await parent();
  if (me.isSuperAdmin && me.organizations.length === 0) {
    redirect(302, '/admin/organizations');
  }
  return {};
}
