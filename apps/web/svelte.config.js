import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Static SPA, all loaders run in the browser (docs/plan/10 §intro) — with
    // the exception of the three public pages, which prerender to real HTML.
    //
    // The fallback must NOT be index.html: `/` is now prerendered, and the
    // adapter writes the fallback last, silently overwriting the landing page
    // with an empty shell. Naming it 200.html keeps them apart; vercel.json
    // rewrites unmatched paths there.
    adapter: adapter({
      fallback: '200.html',
    }),
  },
};

export default config;
