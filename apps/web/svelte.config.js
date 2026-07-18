import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // static SPA, all loaders run in the browser (docs/plan/10 §intro)
    adapter: adapter({
      fallback: 'index.html',
    }),
  },
};

export default config;
