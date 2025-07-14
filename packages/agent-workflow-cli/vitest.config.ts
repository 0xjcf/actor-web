import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node', // CLI package runs in Node environment
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,ts}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'tests/', '**/*.d.ts', '**/*.config.*'],
    },
  },
});
