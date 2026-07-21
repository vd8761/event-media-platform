import { redirect } from '@sveltejs/kit';

// Photos is the new home surface — the org-wide timeline, the way Immich opens
// on the photo grid. Super admins have no organization, so /photos bounces
// them onward to /admin/organizations.
export function load() {
  redirect(302, '/photos');
}
