import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom', // DOM environment for browser-like tests
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: [
      'src/**/*.{test,spec}.{js,ts}',
      'packages/actor-core-testing/src/**/*.{test,spec}.{js,ts}',
      // Note: agent-workflow-cli has its own vitest config with node environment
      // Note: actor-core-runtime has its own vitest config with node environment
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData.ts',
        '**/*.demo.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': '/src',
      '@framework': '/src/framework',
      '@components': '/src/components',
    },
  },
});
