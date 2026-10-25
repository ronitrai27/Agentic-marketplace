import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  build: {
    outDir: path.join(here, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Single catch-all for all API routes including SSE /stream endpoint
      '/api': {
        target: 'http://localhost:3008',
        changeOrigin: true,
      },
      '/execute': {
        target: 'http://localhost:3008',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3008',
        changeOrigin: true,
      },
    },
  },
});
