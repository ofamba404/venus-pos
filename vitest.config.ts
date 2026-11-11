import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/dual-run/**/*.test.ts'],
    setupFiles: ['tests/dual-run/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/data/**'],
    },
  },
  resolve: {
    alias: {
      '@domain': path.resolve(__dirname, 'src/domain'),
      '@data': path.resolve(__dirname, 'src/data'),
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@app': path.resolve(__dirname, 'src/app'),
      '@platform': path.resolve(__dirname, 'src/platform'),
    },
  },
});
