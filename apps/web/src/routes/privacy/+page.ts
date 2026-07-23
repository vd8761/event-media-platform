// Prerendered to real HTML — see the note in src/routes/+page.ts. Google's
// review fetches the privacy policy URL directly, and a page that is empty
// without JavaScript cannot be assessed. No load function to move: this page
// is static content.
export const prerender = true;
export const ssr = true;
