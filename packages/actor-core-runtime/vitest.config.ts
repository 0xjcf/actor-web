import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node', // Runtime package runs in Node environment
    globals: true,
    setupFiles: ['./tests/setup.ts'], // Disable debug mode by default
    include: ['src/**/*.{test,spec}.{js,ts}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', '**/*.d.ts', '**/*.config.*'],
    },
  },
});
