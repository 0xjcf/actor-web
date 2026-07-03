import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@actor-web/runtime': new URL('../actor-core-runtime/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,ts}', 'tests/**/*.{test,spec}.{js,ts}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', '**/*.d.ts', '**/*.config.*'],
    },
  },
});
