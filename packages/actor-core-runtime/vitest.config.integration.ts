import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // Only include integration tests
    include: [
      'src/**/*.integration.{test,spec}.{js,ts}',
      'src/distributed-actor-directory.test.ts', // This is an integration test
    ],
    testTimeout: 60000, // Longer timeout for integration tests
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', '**/*.d.ts', '**/*.config.*'],
    },
  },
});
