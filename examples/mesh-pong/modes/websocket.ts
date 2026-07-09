import type { StartedActorWebNode } from '@actor-web/runtime/browser';
import { startActorWebNode } from '@actor-web/runtime/browser';
import type { ActorToolRegistry, ServedActorWebNode } from '@actor-web/runtime/node';
import { createPongClientNodeAddress, PONG_NODE_ADDRESSES } from '../pong-contract';
import { createPongControllerTools } from '../pong-controller';
import { createPongTopology, pong } from '../pong-topology';

type StartedPongNode = StartedActorWebNode<never>;
type ServedPongNode = ServedActorWebNode<never>;
type FlushableNode = {
  stop(): Promise<void>;
  system: {
    flush(): Promise<void>;
  };
};

export interface MeshPongWebSocketLoopbackOptions {
  readonly tools?: ActorToolRegistry;
}

export type MeshPongWebSocketStatus =
  | 'connecting'
  | 'connected'
  | 'listener-missing'
  | 'transport-failed';

export type MeshPongWebSocketHelperStatus =
  | {
      readonly state: 'ready';
      readonly transportUrl: string;
      readonly matchAddress: string;
    }
  | {
      readonly state: 'listener-missing';
      readonly message: string;
      readonly transportUrl: null;
      readonly matchAddress: null;
    }
  | {
      readonly state: 'transport-failed';
      readonly message: string;
      readonly transportUrl: string | null;
      readonly matchAddress: string | null;
    };

export interface MeshPongWebSocketDevHelperClient {
  getStatus(): Promise<MeshPongWebSocketHelperStatus>;
  flush(): Promise<void>;
}

export interface CreateMeshPongWebSocketDevHelperClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export interface StartedMeshPongWebSocketHost {
  readonly mode: 'websocket';
  readonly clientNodeAddress: string;
  readonly client: StartedPongNode;
  readonly lookupNode: StartedPongNode;
  readonly server: ServedPongNode;
  readonly a: ServedPongNode;
  readonly b: ServedPongNode;
  readonly transportUrl: string;
  readonly matchAddress: string;
  flush(): Promise<void>;
  stop(): Promise<void>;
}

export interface StartedMeshPongBrowserWebSocketRuntime {
  readonly mode: 'websocket';
  readonly transportUrl: string;
  readonly matchCoordinatorAddress: string;
  readonly playerSessionAddress: string;
  readonly clientNodeAddress: string;
  readonly client: StartedPongNode;
  readonly lookupNode: StartedPongNode;
  flush(): Promise<void>;
  stop(): Promise<void>;
}

export type MeshPongBrowserWebSocketStartResult =
  | {
      readonly ok: true;
      readonly runtime: StartedMeshPongBrowserWebSocketRuntime;
    }
  | {
      readonly ok: false;
      readonly state: 'listener-missing' | 'transport-failed';
      readonly message: string;
      readonly transportUrl: string | null;
    };

export interface StartMeshPongBrowserWebSocketOptions {
  readonly sessionId: string;
  readonly helper?: MeshPongWebSocketDevHelperClient;
}

const MESH_PONG_WEBSOCKET_HELPER_PATH = '/__mesh-pong/websocket';

function defaultFetch(): typeof globalThis.fetch {
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('Mesh Pong WebSocket helper requires fetch.');
  }
  return globalThis.fetch.bind(globalThis);
}

function defaultBaseUrl(): string {
  if (typeof window === 'undefined') {
    return 'http://127.0.0.1:4173';
  }
  return window.location.origin;
}

function joinHelperUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl.replace(/\/+$/, '')}/`).toString();
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return null;
  }
  return response.json();
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function listenerMissingStatus(
  message = 'Mesh Pong WebSocket listener helper is unavailable.'
): Extract<MeshPongWebSocketHelperStatus, { readonly state: 'listener-missing' }> {
  return {
    state: 'listener-missing',
    message,
    transportUrl: null,
    matchAddress: null,
  };
}

function transportFailedStatus(
  message: string,
  transportUrl: string | null = null,
  matchAddress: string | null = null
): Extract<MeshPongWebSocketHelperStatus, { readonly state: 'transport-failed' }> {
  return {
    state: 'transport-failed',
    message,
    transportUrl,
    matchAddress,
  };
}

async function parseHelperStatus(response: Response): Promise<MeshPongWebSocketHelperStatus> {
  if (response.status === 404) {
    return listenerMissingStatus();
  }

  const payload = await readJson(response);
  const candidate = payload && typeof payload === 'object' ? payload : {};
  const transportUrl = asString((candidate as { transportUrl?: unknown }).transportUrl);
  const matchAddress = asString((candidate as { matchAddress?: unknown }).matchAddress);
  const message =
    asString((candidate as { message?: unknown }).message) ??
    (response.ok
      ? 'Mesh Pong WebSocket helper returned an invalid response.'
      : response.statusText);

  if (!response.ok) {
    return transportFailedStatus(message, transportUrl, matchAddress);
  }

  if ((candidate as { state?: unknown }).state === 'ready' && transportUrl && matchAddress) {
    return {
      state: 'ready',
      transportUrl,
      matchAddress,
    };
  }

  return transportFailedStatus(message, transportUrl, matchAddress);
}

export function createMeshPongWebSocketDevHelperClient(
  options: CreateMeshPongWebSocketDevHelperClientOptions = {}
): MeshPongWebSocketDevHelperClient {
  const fetchImpl = options.fetch ?? defaultFetch();
  const baseUrl = options.baseUrl ?? defaultBaseUrl();

  return {
    async getStatus(): Promise<MeshPongWebSocketHelperStatus> {
      const response = await fetchImpl(joinHelperUrl(baseUrl, MESH_PONG_WEBSOCKET_HELPER_PATH));
      return parseHelperStatus(response);
    },
    async flush(): Promise<void> {
      const response = await fetchImpl(
        joinHelperUrl(baseUrl, `${MESH_PONG_WEBSOCKET_HELPER_PATH}/flush`),
        { method: 'POST' }
      );
      if (response.status === 404) {
        return;
      }
      if (!response.ok) {
        const payload = await readJson(response);
        const candidate = payload && typeof payload === 'object' ? payload : {};
        const message =
          asString((candidate as { message?: unknown }).message) ??
          'Mesh Pong WebSocket helper flush failed.';
        throw new Error(message);
      }
    },
  };
}

export function describeMeshPongWebSocketStatus(status: MeshPongWebSocketStatus): string {
  switch (status) {
    case 'connecting':
      return 'connecting';
    case 'connected':
      return 'connected/lobby';
    case 'listener-missing':
      return 'listener-missing';
    case 'transport-failed':
      return 'transport-failed';
  }
}

function requireTransportUrl(node: ServedPongNode, label: string): string {
  const url = node.getTransportUrl();
  if (!url) {
    throw new Error(`Mesh Pong ${label} WebSocket node did not expose a transport URL.`);
  }
  return url;
}

async function ensureGlobalWebSocket(): Promise<void> {
  if (typeof globalThis.WebSocket === 'function') {
    return;
  }
  const ws = await import('ws');
  globalThis.WebSocket = ws.WebSocket as typeof globalThis.WebSocket;
}

async function flushHostNodes(nodes: readonly FlushableNode[]): Promise<void> {
  await Promise.all(nodes.map((nodeRuntime) => nodeRuntime.system.flush()));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.all(nodes.map((nodeRuntime) => nodeRuntime.system.flush()));
}

async function stopHostNodes(nodes: readonly FlushableNode[]): Promise<void> {
  await Promise.allSettled([...nodes].reverse().map((nodeRuntime) => nodeRuntime.stop()));
}

export async function startMeshPongWebSocketHost(
  options: MeshPongWebSocketLoopbackOptions = {}
): Promise<StartedMeshPongWebSocketHost> {
  const { serveNode } = await import('@actor-web/runtime/node');
  const startedNodes: FlushableNode[] = [];
  const tools = createPongControllerTools(options.tools);
  const clientNodeAddress = PONG_NODE_ADDRESSES.localClient;
  const topology = createPongTopology({ clientNodeAddress });
  await ensureGlobalWebSocket();

  try {
    const b = await serveNode(pong as never, {
      node: 'b',
      transport: { listen: true, heartbeatIntervalMs: 0 },
      tools,
    });
    startedNodes.push(b);

    const a = await serveNode(pong as never, {
      node: 'a',
      transport: { listen: true, heartbeatIntervalMs: 0 },
      tools,
      peers: {
        b: requireTransportUrl(b, 'b'),
      },
      connect: ['b'],
    });
    startedNodes.push(a);

    const server = await serveNode(pong as never, {
      node: 'server',
      transport: { listen: true, heartbeatIntervalMs: 0 },
      tools,
      peers: {
        a: requireTransportUrl(a, 'a'),
        b: requireTransportUrl(b, 'b'),
      },
      connect: ['a', 'b'],
    });
    startedNodes.push(server);

    const client = await startActorWebNode(topology as never, {
      node: 'client',
      peers: {
        server: requireTransportUrl(server, 'server'),
      },
      connect: ['server'],
      transport: {
        incarnation: `${clientNodeAddress}-host`,
        heartbeatIntervalMs: 0,
      },
    });
    startedNodes.push(client);

    const transportUrl = requireTransportUrl(server, 'server');
    const matchAddress = server.requireActor('matchCoordinator').address;
    const runtime: StartedMeshPongWebSocketHost = {
      mode: 'websocket',
      clientNodeAddress,
      client,
      lookupNode: client,
      server,
      a,
      b,
      transportUrl,
      matchAddress,
      flush: () => flushHostNodes(startedNodes),
      stop: () => stopHostNodes(startedNodes),
    };
    await runtime.flush();
    return runtime;
  } catch (error) {
    await stopHostNodes(startedNodes);
    throw error;
  }
}

async function flushBrowserClient(
  runtime: Pick<StartedMeshPongBrowserWebSocketRuntime, 'client'>,
  helper: MeshPongWebSocketDevHelperClient
): Promise<void> {
  await helper.flush();
  await runtime.client.system.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await helper.flush();
  await runtime.client.system.flush();
}

async function stopBrowserClient(
  runtime: Pick<StartedMeshPongBrowserWebSocketRuntime, 'client'>
): Promise<void> {
  await Promise.allSettled([runtime.client.stop()]);
}

export async function startMeshPongBrowserWebSocketClient(
  options: StartMeshPongBrowserWebSocketOptions
): Promise<MeshPongBrowserWebSocketStartResult> {
  const helper = options.helper ?? createMeshPongWebSocketDevHelperClient();
  const helperStatus = await helper.getStatus();
  if (helperStatus.state !== 'ready') {
    return {
      ok: false,
      state: helperStatus.state,
      message: helperStatus.message,
      transportUrl: helperStatus.transportUrl,
    };
  }

  const clientNodeAddress = createPongClientNodeAddress(options.sessionId);
  const topology = createPongTopology({ clientNodeAddress });
  try {
    await ensureGlobalWebSocket();
    const client = await startActorWebNode(topology as never, {
      node: 'client',
      peers: {
        server: helperStatus.transportUrl,
      },
      connect: ['server'],
      transport: {
        incarnation: `${clientNodeAddress}-browser-${Date.now()}`,
        heartbeatIntervalMs: 0,
      },
    });
    const playerSession = await (
      client as unknown as {
        actors: {
          playerSession: {
            instance(options: { sessionId: string }): Promise<{ address: string }>;
          };
        };
      }
    ).actors.playerSession.instance({
      sessionId: options.sessionId,
    });

    const runtime: StartedMeshPongBrowserWebSocketRuntime = {
      mode: 'websocket',
      transportUrl: helperStatus.transportUrl,
      matchCoordinatorAddress: helperStatus.matchAddress,
      playerSessionAddress: playerSession.address,
      clientNodeAddress,
      client,
      lookupNode: client,
      flush: () => flushBrowserClient(runtime, helper),
      stop: () => stopBrowserClient(runtime),
    };

    await runtime.flush();
    return { ok: true, runtime };
  } catch (error) {
    return {
      ok: false,
      state: 'transport-failed',
      message: error instanceof Error ? error.message : String(error),
      transportUrl: helperStatus.transportUrl,
    };
  }
}

export async function startMeshPongBrowserWebSocket(
  options: StartMeshPongBrowserWebSocketOptions
): Promise<MeshPongBrowserWebSocketStartResult> {
  return startMeshPongBrowserWebSocketClient(options);
}

export async function startMeshPongWebSocketLoopback(
  options: MeshPongWebSocketLoopbackOptions = {}
): Promise<StartedMeshPongWebSocketHost> {
  return startMeshPongWebSocketHost(options);
}
