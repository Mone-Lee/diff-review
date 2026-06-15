import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const devServerPort = Number(process.env.DIFF_REVIEW_VITE_PORT ?? 5173);
const apiUrl = process.env.DIFF_REVIEW_API_URL ?? 'http://127.0.0.1:4966';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: Number.isNaN(devServerPort) ? 5173 : devServerPort,
    strictPort: Boolean(process.env.DIFF_REVIEW_VITE_PORT),
    proxy: {
      '/api': apiUrl
    }
  },
  build: {
    outDir: 'dist/web',
    emptyOutDir: true
  }
});
