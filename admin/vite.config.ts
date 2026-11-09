import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The API runs separately (see server/README.md); proxying keeps its sign-in cookie on this origin.
const proxy = { '/v1': 'http://localhost:3000' };

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: { port: 5180, proxy },
  preview: { port: 4180, proxy },
});
