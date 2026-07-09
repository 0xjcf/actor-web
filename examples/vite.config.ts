import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServedActorWebNode } from '@actor-web/runtime/node';
import { serveNode } from '@actor-web/runtime/node';
import { defineConfig, type Plugin } from 'vite';
import { createPongControllerTools } from './mesh-pong/pong-controller';
import { pong } from './mesh-pong/pong-topology';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const actorWebRoot = path.resolve(currentDir, '..');
const MESH_PONG_WEBSOCKET_HELPER_PATH = '/__mesh-pong/websocket';

function jsonResponse(body: unknown) {
  return JSON.stringify(body, null, 2);
}

async function readJsonBody(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  if (chunks.length === 0) {
    return null;
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(
  response: {
    statusCode: number;
    setHeader(name: string, value: string): void;
    end(body?: string): void;
  },
  statusCode: number,
  body: unknown
): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(jsonResponse(body));
}

function createMeshPongWebSocketHelperPlugin(): Plugin {
  let meshPongWebSocketServer: ServedActorWebNode<typeof pong> | null = null;
  let meshPongWebSocketServerPromise: Promise<ServedActorWebNode<typeof pong>> | null = null;
  let meshPongWebSocketServerFailure: string | null = null;

  async function ensureMeshPongWebSocketServer(): Promise<ServedActorWebNode<typeof pong>> {
    if (meshPongWebSocketServer) {
      return meshPongWebSocketServer;
    }
    if (meshPongWebSocketServerPromise) {
      return meshPongWebSocketServerPromise;
    }

    meshPongWebSocketServerPromise = serveNode(pong, {
      node: 'server',
      transport: { listen: true, heartbeatIntervalMs: 0 },
      tools: createPongControllerTools(),
    })
      .then((server) => {
        meshPongWebSocketServerFailure = null;
        meshPongWebSocketServer = server;
        return server;
      })
      .catch((error: unknown) => {
        meshPongWebSocketServerFailure =
          error instanceof Error ? error.message : 'Mesh Pong WebSocket helper failed to start.';
        throw error;
      })
      .finally(() => {
        meshPongWebSocketServerPromise = null;
      });

    return meshPongWebSocketServerPromise;
  }

  async function meshPongWebSocketStatus() {
    if (meshPongWebSocketServerFailure && !meshPongWebSocketServer) {
      return {
        statusCode: 503,
        body: {
          state: 'transport-failed',
          message: meshPongWebSocketServerFailure,
          transportUrl: null,
        },
      };
    }

    try {
      const server = await ensureMeshPongWebSocketServer();
      const transportUrl = server.getTransportUrl();
      if (!transportUrl) {
        return {
          statusCode: 503,
          body: {
            state: 'transport-failed',
            message: 'Mesh Pong WebSocket helper did not expose a transport URL.',
            transportUrl: null,
          },
        };
      }
      return {
        statusCode: 200,
        body: {
          state: 'ready',
          transportUrl,
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Mesh Pong WebSocket helper failed to start.';
      meshPongWebSocketServerFailure = message;
      return {
        statusCode: 503,
        body: {
          state: 'transport-failed',
          message,
          transportUrl: null,
        },
      };
    }
  }

  return {
    name: 'mesh-pong-websocket-helper',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = request.url ? new URL(request.url, 'http://127.0.0.1') : null;
        const pathname = url?.pathname;
        if (!pathname?.startsWith(MESH_PONG_WEBSOCKET_HELPER_PATH)) {
          next();
          return;
        }

        if (pathname === MESH_PONG_WEBSOCKET_HELPER_PATH && request.method === 'GET') {
          const result = await meshPongWebSocketStatus();
          sendJson(response, result.statusCode, result.body);
          return;
        }

        if (
          pathname === `${MESH_PONG_WEBSOCKET_HELPER_PATH}/session` &&
          request.method === 'POST'
        ) {
          const status = await meshPongWebSocketStatus();
          if (status.statusCode !== 200) {
            sendJson(response, status.statusCode, status.body);
            return;
          }

          const payload = (await readJsonBody(request)) as { sessionId?: unknown } | null;
          const sessionId =
            payload && typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
          if (!sessionId) {
            sendJson(response, 400, {
              state: 'transport-failed',
              message: 'Mesh Pong WebSocket helper requires a sessionId.',
              transportUrl: null,
            });
            return;
          }

          try {
            const served = await ensureMeshPongWebSocketServer();
            const actorRef = await served.actors.playerSession.instance({ sessionId });
            await served.system.flush();
            sendJson(response, 200, {
              state: 'ready',
              transportUrl: served.getTransportUrl(),
              actorAddress: actorRef.address,
            });
          } catch (error) {
            sendJson(response, 503, {
              state: 'transport-failed',
              message:
                error instanceof Error
                  ? error.message
                  : 'Mesh Pong WebSocket helper could not create the player session.',
              transportUrl: meshPongWebSocketServer?.getTransportUrl() ?? null,
            });
          }
          return;
        }

        if (pathname === `${MESH_PONG_WEBSOCKET_HELPER_PATH}/flush` && request.method === 'POST') {
          try {
            const served = await ensureMeshPongWebSocketServer();
            await served.system.flush();
            sendJson(response, 200, { ok: true });
          } catch (error) {
            sendJson(response, 503, {
              state: 'transport-failed',
              message:
                error instanceof Error ? error.message : 'Mesh Pong WebSocket helper flush failed.',
              transportUrl: meshPongWebSocketServer?.getTransportUrl() ?? null,
            });
          }
          return;
        }

        sendJson(response, 404, {
          state: 'listener-missing',
          message: 'Mesh Pong WebSocket listener helper is unavailable.',
          transportUrl: null,
        });
      });
    },
  };
}

export default defineConfig({
  root: currentDir,
  plugins: [createMeshPongWebSocketHelperPlugin()],
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
        find: '@actor-web/agent',
        replacement: path.resolve(actorWebRoot, 'packages/actor-agent/src/index.ts'),
      },
      {
        find: '@actor-web/lattice',
        replacement: path.resolve(actorWebRoot, 'packages/actor-lattice/src/index.ts'),
      },
      {
        find: '@actor-web/labs-mesh',
        replacement: path.resolve(actorWebRoot, 'packages/actor-labs-mesh/src/index.ts'),
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
        meshPong: path.resolve(currentDir, 'mesh-pong/ui/index.html'),
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
