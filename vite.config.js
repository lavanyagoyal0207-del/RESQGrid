import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      [
        '/incidents',
        '/intelligence',
        '/reports',
        '/report',
        '/voice-report',
        '/operator',
        '/brief',
        '/resources',
        '/alerts',
        '/analytics',
      ].map((path) => [
        path,
        {
          target: process.env.RESQGRID_API_PROXY_TARGET || 'http://127.0.0.1:5000',
          changeOrigin: true,
        },
      ])
    ),
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    restoreMocks: true,
  },
});
