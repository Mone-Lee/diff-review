/**
 * 静态分享门户构建配置：生成可部署到任意目录且不依赖本地 API 的独立页面。
 */
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist/share',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(process.cwd(), 'share.html')
    }
  }
});
