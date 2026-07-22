import { api, ApiError } from '$lib/api';
import { redirect } from '@sveltejs/kit';

// `/` is the marketing landing page for anyone signed out, and a doorway
// straight through to the app for anyone signed in — someone with a live
// session does not want to be sold the product they are already using.
//
// Loads run in the browser (ssr = false), so this is a real session check
// rather than a guess at a cookie we cannot read.
export async function load(): Promise<{ signedIn: boolean }> {
  try {
    await api.me();
  } catch (error) {
    // 401 is the ordinary signed-out case. Anything else — API down, network
    // failure — still renders the landing page: a visitor who wanted to read
    // about the product should not be shown an error because the API is sick.
    void (error instanceof ApiError);
    return { signedIn: false };
  }

  redirect(302, '/photos');
}
