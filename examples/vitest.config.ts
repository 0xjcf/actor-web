import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const actorWebRoot = path.resolve(currentDir, '..');

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@actor-web/runtime/browser',
        replacement: path.resolve(actorWebRoot, 'packages/actor-core-runtime/src/browser.ts'),
      },
      {
        find: '@actor-web/runtime/node',
        replacement: path.resolve(actorWebRoot, 'packages/actor-core-runtime/src/node.ts'),
      },
      {
        find: '@actor-web/runtime/topology',
        replacement: path.resolve(
          actorWebRoot,
          'packages/actor-core-runtime/src/topology-entry.ts'
        ),
      },
      {
        find: '@actor-web/runtime/event-sourcing',
        replacement: path.resolve(
          actorWebRoot,
          'packages/actor-core-runtime/src/event-sourcing-entry.ts'
        ),
      },
      {
        find: '@actor-web/runtime',
        replacement: path.resolve(actorWebRoot, 'packages/actor-core-runtime/src/index.ts'),
      },
      {
        find: '@actor-web/lattice',
        replacement: path.resolve(actorWebRoot, 'packages/actor-lattice/src/index.ts'),
      },
    ],
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['examples/**/*.test.ts'],
  },
});
