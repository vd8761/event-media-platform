import { api } from '$lib/api';
import { redirect } from '@sveltejs/kit';

export async function load({ parent }) {
  // Events belong to organizations, and a super admin is a member of none —
  // this page would be permanently empty for them. Send them to the surface
  // they actually own instead of a dead end.
  const { me } = await parent();
  if (me.isSuperAdmin && me.organizations.length === 0) {
    redirect(302, '/admin/organizations');
  }

  const events = await api.events.listMine();
  return { events };
}
