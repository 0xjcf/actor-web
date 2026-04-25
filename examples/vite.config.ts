import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const actorWebRoot = path.resolve(currentDir, '..');
const igniteWorkspaceRoot = path.resolve(currentDir, '../../ignite-element/packages');
const igniteAdaptersDist = path.resolve(igniteWorkspaceRoot, 'ignite-adapters/dist');
const igniteElementDist = path.resolve(igniteWorkspaceRoot, 'ignite-element/dist');
const igniteCoreDist = path.resolve(igniteWorkspaceRoot, 'ignite-core/dist');
const igniteRendererDist = path.resolve(igniteWorkspaceRoot, 'ignite-renderer/dist');

export default defineConfig({
  root: currentDir,
  resolve: {
    alias: [
      {
        find: '@actor-core/runtime/browser',
        replacement: path.resolve(actorWebRoot, 'packages/actor-core-runtime/src/browser.ts'),
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
  server: {
    fs: {
      allow: [actorWebRoot, path.resolve(currentDir, '../../ignite-element')],
    },
  },
  build: {
    outDir: path.resolve(currentDir, '../dist/examples'),
    emptyOutDir: false,
    rollupOptions: {
      input: {
        index: path.resolve(currentDir, 'index.html'),
        igniteHeadlessHost: path.resolve(currentDir, 'ignite-headless-host/index.html'),
        igniteHeadlessProvider: path.resolve(currentDir, 'ignite-headless-host/provider.html'),
        'ignite-headless-host/ignite-headless-host.sw': path.resolve(
          currentDir,
          'ignite-headless-host/ignite-headless-host.sw.ts'
        ),
        'ignite-headless-host/worker-websocket-runtime': path.resolve(
          currentDir,
          'ignite-headless-host/worker-websocket-runtime.ts'
        ),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (
            chunkInfo.name === 'ignite-headless-host/ignite-headless-host.sw' ||
            chunkInfo.name === 'ignite-headless-host/worker-websocket-runtime'
          ) {
            return '[name].js';
          }

          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
});
