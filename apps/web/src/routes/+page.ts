// The landing page is prerendered to real HTML at build time, overriding the
// app-wide `ssr = false` in the root layout.
//
// This is not a preference. Google's OAuth branding review fetches this URL
// and reads the response body; as a pure client-rendered SPA the body was
// empty apart from a loader script, so the review reported that the home page
// "does not explain the purpose of your app" and that no app name appeared on
// it. Both were literally true of the HTML we served. The (app) routes stay a
// client SPA as designed (docs/plan/10) — only the three public pages that
// need to be readable without JavaScript opt in.
//
// Prerendering means no load function: it would run at build time, where there
// is no session and no API. The signed-in check moved into the page itself and
// runs in the browser after hydration.
export const prerender = true;
export const ssr = true;
