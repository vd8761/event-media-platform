import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    // web-only development against the local backend
    proxy: {
      '/api': {
        target: process.env.EL_SERVER_URL || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
