import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite configuration.
 *
 * In development the client proxies /api and /uploads to the Express server, so
 * the browser sees a single origin and no CORS preflight is needed. That is also
 * why the API client defaults to a relative "/api/v1" base URL: the same code
 * works behind a reverse proxy in production.
 */
export default defineConfig({
  plugins: [react()],
  // Pin PostCSS resolution to this project. Without this, Vite walks up the
  // directory tree and can pick up an unrelated postcss.config file from a parent
  // directory, which would make the build depend on files outside the repository.
  css: {
    postcss: { plugins: [] },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:4000',
        changeOrigin: true,
      },
      '/uploads': {
        target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
