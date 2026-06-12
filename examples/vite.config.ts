import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const actorWebRoot = path.resolve(currentDir, '..');

export default defineConfig({
  root: currentDir,
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
        find: '@actor-web/runtime',
        replacement: path.resolve(actorWebRoot, 'packages/actor-core-runtime/src/index.ts'),
      },
    ],
  },
  server: {
    fs: {
      allow: [actorWebRoot],
    },
  },
  build: {
    outDir: path.resolve(currentDir, '../dist/examples'),
    emptyOutDir: false,
    rollupOptions: {
      input: {
        index: path.resolve(currentDir, 'index.html'),
        fasAgentLoop: path.resolve(currentDir, 'fas-agent-loop/index.html'),
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
