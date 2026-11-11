import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import path from 'node:path';

const BUILD_ID = `${process.env.GIT_SHA || 'dev'}-${Date.now().toString(36)}`;

export default defineConfig({
  // Phase 1–9: serve under /next/ beside legacy. Phase 10 switches to '/'.
  base: '/next/',
  plugins: [preact()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      '@domain': path.resolve(__dirname, 'src/domain'),
      '@data': path.resolve(__dirname, 'src/data'),
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@app': path.resolve(__dirname, 'src/app'),
      '@platform': path.resolve(__dirname, 'src/platform'),
    },
  },
  build: {
    outDir: 'dist/next',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        auth: path.resolve(__dirname, 'auth.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  publicDir: 'public',
});
