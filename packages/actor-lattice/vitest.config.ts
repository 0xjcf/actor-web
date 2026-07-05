import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@actor-web\/runtime\/event-sourcing$/,
        replacement: fileURLToPath(
          new URL('../actor-core-runtime/src/event-sourcing-entry.ts', import.meta.url)
        ),
      },
      {
        find: /^@actor-web\/runtime\/topology$/,
        replacement: fileURLToPath(
          new URL('../actor-core-runtime/src/topology-entry.ts', import.meta.url)
        ),
      },
      {
        find: /^@actor-web\/runtime$/,
        replacement: fileURLToPath(new URL('../actor-core-runtime/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.{js,ts}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', '**/*.d.ts', '**/*.config.*'],
    },
  },
});
