import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/dual-run/**/*.test.ts'],
    setupFiles: ['tests/dual-run/setup.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['src/domain/**', 'src/data/**'],
      thresholds: {
        'src/domain/**': {
          lines: 95,
          branches: 95,
          functions: 95,
          statements: 95,
        },
        'src/data/**': {
          lines: 85,
          statements: 85,
          functions: 85,
        },
      },
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
