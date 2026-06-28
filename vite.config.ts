import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// pdfjs-dist ships a worker file that needs to be copied as-is and
// served from a stable URL, so we exclude it from bundling/optimization.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
  worker: {
    format: 'es',
  },
});
