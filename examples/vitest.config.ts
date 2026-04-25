import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const actorWebRoot = path.resolve(currentDir, '..');
const igniteWorkspaceRoot = path.resolve(currentDir, '../../ignite-element/packages');
const igniteAdaptersDist = path.resolve(igniteWorkspaceRoot, 'ignite-adapters/dist');
const igniteElementDist = path.resolve(igniteWorkspaceRoot, 'ignite-element/dist');
const igniteCoreDist = path.resolve(igniteWorkspaceRoot, 'ignite-core/dist');
const igniteRendererDist = path.resolve(igniteWorkspaceRoot, 'ignite-renderer/dist');

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@actor-core/runtime/browser',
        replacement: path.resolve(actorWebRoot, 'packages/actor-core-runtime/src/browser.ts'),
      },
      {
        find: '@actor-core/runtime/node',
        replacement: path.resolve(actorWebRoot, 'packages/actor-core-runtime/src/node.ts'),
      },
      {
        find: '@actor-core/runtime/topology',
        replacement: path.resolve(
          actorWebRoot,
          'packages/actor-core-runtime/src/topology-entry.ts'
        ),
      },
      {
        find: '@actor-core/runtime',
        replacement: path.resolve(actorWebRoot, 'packages/actor-core-runtime/src/index.ts'),
      },
      {
        find: 'ignite-adapters/actor-web',
        replacement: path.resolve(igniteAdaptersDist, 'actor-web.es.js'),
      },
      {
        find: 'ignite-adapters',
        replacement: path.resolve(igniteAdaptersDist, 'ignite-adapters.es.js'),
      },
      {
        find: 'ignite-element/jsx/jsx-runtime',
        replacement: path.resolve(igniteElementDist, 'jsx/jsx-runtime.es.js'),
      },
      {
        find: 'ignite-element/jsx/jsx-dev-runtime',
        replacement: path.resolve(igniteElementDist, 'jsx/jsx-dev-runtime.es.js'),
      },
      {
        find: 'ignite-element/jsx',
        replacement: path.resolve(igniteElementDist, 'jsx/index.es.js'),
      },
      {
        find: 'ignite-element/renderers/ignite-jsx',
        replacement: path.resolve(igniteElementDist, 'renderers/ignite-jsx.es.js'),
      },
      {
        find: 'ignite-element',
        replacement: path.resolve(igniteElementDist, 'ignite-element.es.js'),
      },
      {
        find: 'ignite-renderer/jsx-runtime',
        replacement: path.resolve(igniteRendererDist, 'jsx-runtime.es.js'),
      },
      {
        find: 'ignite-renderer/jsx-dev-runtime',
        replacement: path.resolve(igniteRendererDist, 'jsx-dev-runtime.es.js'),
      },
      {
        find: 'ignite-renderer/jsx/index',
        replacement: path.resolve(igniteRendererDist, 'jsx/index.es.js'),
      },
      {
        find: 'ignite-renderer/jsx',
        replacement: path.resolve(igniteRendererDist, 'jsx/index.es.js'),
      },
      {
        find: 'ignite-renderer',
        replacement: path.resolve(igniteRendererDist, 'ignite-renderer.es.js'),
      },
      {
        find: 'ignite-core',
        replacement: path.resolve(igniteCoreDist, 'ignite-core.es.js'),
      },
    ],
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['examples/**/*.test.ts'],
  },
});
