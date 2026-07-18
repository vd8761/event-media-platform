// Auth guard (pattern from immich:web/src/lib/utils/auth.ts authenticate()):
// resolve the session before rendering any (app) route; bounce to /login.
import { api, ApiError, type Me } from '$lib/api';
import { redirect } from '@sveltejs/kit';

export async function load(): Promise<{ me: Me }> {
  try {
    const me = await api.me();
    return { me };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirect(302, '/login');
    }
    throw error;
  }
}
