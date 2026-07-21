import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    // web-only development against the local backend
    proxy: {
      '/api': {
        // 127.0.0.1 rather than localhost: on Windows localhost resolves to
        // ::1 first, so if anything else on the machine is bound to :3001 over
        // IPv6 the proxy silently reaches that instead of the backend.
        target: process.env.EL_SERVER_URL || 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
});
