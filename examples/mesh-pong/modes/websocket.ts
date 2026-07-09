import type { StartedActorWebNode } from '@actor-web/runtime/browser';
import { startActorWebNode } from '@actor-web/runtime/browser';
import type { ActorToolRegistry, ServedActorWebNode } from '@actor-web/runtime/node';
import { PONG_NODE_ADDRESSES } from '../pong-contract';
import { createPongControllerTools } from '../pong-controller';
import { pong } from '../pong-topology';
import {
  flushMeshPongCluster,
  type StartedMeshPongCluster,
  stopMeshPongCluster,
} from './broadcast';

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
    }
  | {
      readonly state: 'listener-missing';
      readonly message: string;
      readonly transportUrl: null;
    }
  | {
      readonly state: 'transport-failed';
      readonly message: string;
      readonly transportUrl: string | null;
    };

export type MeshPongWebSocketHelperSessionStatus =
  | {
      readonly state: 'ready';
      readonly transportUrl: string;
      readonly actorAddress: string;
    }
  | Extract<MeshPongWebSocketHelperStatus, { readonly state: 'listener-missing' }>
  | Extract<MeshPongWebSocketHelperStatus, { readonly state: 'transport-failed' }>;

export interface MeshPongWebSocketDevHelperClient {
  getStatus(): Promise<MeshPongWebSocketHelperStatus>;
  ensurePlayerSession(sessionId: string): Promise<MeshPongWebSocketHelperSessionStatus>;
  flush(): Promise<void>;
}

export interface CreateMeshPongWebSocketDevHelperClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export interface StartedMeshPongBrowserWebSocketRuntime {
  readonly mode: 'websocket';
  readonly transportUrl: string;
  readonly playerSessionAddress: string;
  readonly lookupNode: StartedActorWebNode<typeof pong>;
  readonly a: StartedActorWebNode<typeof pong>;
  readonly b: StartedActorWebNode<typeof pong>;
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
  };
}

function transportFailedStatus(
  message: string,
  transportUrl: string | null = null
): Extract<MeshPongWebSocketHelperStatus, { readonly state: 'transport-failed' }> {
  return {
    state: 'transport-failed',
    message,
    transportUrl,
  };
}

async function parseHelperStatus(response: Response): Promise<MeshPongWebSocketHelperStatus> {
  if (response.status === 404) {
    return listenerMissingStatus();
  }

  const payload = await readJson(response);
  const candidate = payload && typeof payload === 'object' ? payload : {};
  const transportUrl = asString((candidate as { transportUrl?: unknown }).transportUrl);
  const message =
    asString((candidate as { message?: unknown }).message) ??
    (response.ok
      ? 'Mesh Pong WebSocket helper returned an invalid response.'
      : response.statusText);

  if (!response.ok) {
    return transportFailedStatus(message, transportUrl);
  }

  if ((candidate as { state?: unknown }).state === 'ready' && transportUrl) {
    return {
      state: 'ready',
      transportUrl,
    };
  }

  return transportFailedStatus(message, transportUrl);
}

async function parseSessionStatus(
  response: Response
): Promise<MeshPongWebSocketHelperSessionStatus> {
  const payload = await readJson(response);
  const candidate = payload && typeof payload === 'object' ? payload : {};
  if (response.status === 404) {
    return listenerMissingStatus();
  }

  const transportUrl = asString((candidate as { transportUrl?: unknown }).transportUrl);
  const message =
    asString((candidate as { message?: unknown }).message) ??
    (response.ok
      ? 'Mesh Pong WebSocket helper returned an invalid response.'
      : response.statusText);

  if (!response.ok) {
    return transportFailedStatus(message, transportUrl);
  }

  if ((candidate as { state?: unknown }).state !== 'ready' || !transportUrl) {
    return transportFailedStatus(message, transportUrl);
  }

  const actorAddress = asString((candidate as { actorAddress?: unknown }).actorAddress);
  if (!actorAddress) {
    return transportFailedStatus(
      'Mesh Pong WebSocket helper did not return a player-session address.',
      transportUrl
    );
  }

  return {
    state: 'ready',
    transportUrl,
    actorAddress,
  };
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
    async ensurePlayerSession(sessionId: string): Promise<MeshPongWebSocketHelperSessionStatus> {
      const response = await fetchImpl(
        joinHelperUrl(baseUrl, `${MESH_PONG_WEBSOCKET_HELPER_PATH}/session`),
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ sessionId }),
        }
      );
      return parseSessionStatus(response);
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

function requireTransportUrl(node: ServedActorWebNode<typeof pong>, label: string): string {
  const url = node.getTransportUrl();
  if (!url) {
    throw new Error(`Mesh Pong ${label} WebSocket node did not expose a transport URL.`);
  }
  return url;
}

export async function startMeshPongWebSocketLoopback(
  options: MeshPongWebSocketLoopbackOptions = {}
): Promise<StartedMeshPongCluster> {
  const { serveNode } = await import('@actor-web/runtime/node');
  const startedNodes: Array<{ stop(): Promise<void> }> = [];
  const tools = createPongControllerTools(options.tools);

  try {
    const b = await serveNode(pong, {
      node: 'b',
      transport: { listen: true, heartbeatIntervalMs: 0 },
      tools,
    });
    startedNodes.push(b);

    const a = await serveNode(pong, {
      node: 'a',
      transport: { listen: true, heartbeatIntervalMs: 0 },
      tools,
      peers: {
        b: requireTransportUrl(b, 'b'),
      },
      connect: ['b'],
    });
    startedNodes.push(a);

    const server = await serveNode(pong, {
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

    const cluster: StartedMeshPongCluster = {
      mode: 'websocket',
      server,
      a,
      b,
      flush: () => flushMeshPongCluster(cluster),
      stop: () => stopMeshPongCluster(cluster),
    };

    await cluster.flush();
    return cluster;
  } catch (error) {
    await Promise.allSettled(startedNodes.map((nodeRuntime) => nodeRuntime.stop()));
    throw error;
  }
}

async function flushMeshPongBrowserWebSocketRuntime(
  runtime: Pick<StartedMeshPongBrowserWebSocketRuntime, 'a' | 'b'>,
  helper: MeshPongWebSocketDevHelperClient
): Promise<void> {
  await helper.flush();
  await runtime.a.system.flush();
  await runtime.b.system.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await helper.flush();
  await runtime.a.system.flush();
  await runtime.b.system.flush();
}

async function stopMeshPongBrowserWebSocketRuntime(
  runtime: Pick<StartedMeshPongBrowserWebSocketRuntime, 'a' | 'b'>
): Promise<void> {
  await Promise.allSettled([runtime.b.stop(), runtime.a.stop()]);
}

export async function startMeshPongBrowserWebSocket(
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

  const startedNodes: StartedActorWebNode<typeof pong>[] = [];
  try {
    const a = await startActorWebNode(pong, {
      node: 'a',
      peers: {
        server: helperStatus.transportUrl,
      },
      connect: ['server'],
      transport: {
        incarnation: `${PONG_NODE_ADDRESSES.a}-browser-${Date.now()}`,
        heartbeatIntervalMs: 0,
      },
    });
    startedNodes.push(a);

    const b = await startActorWebNode(pong, {
      node: 'b',
      peers: {
        server: helperStatus.transportUrl,
      },
      connect: ['server'],
      transport: {
        incarnation: `${PONG_NODE_ADDRESSES.b}-browser-${Date.now()}`,
        heartbeatIntervalMs: 0,
      },
    });
    startedNodes.push(b);

    const sessionStatus = await helper.ensurePlayerSession(options.sessionId);
    if (sessionStatus.state !== 'ready') {
      await Promise.allSettled(startedNodes.reverse().map((nodeRuntime) => nodeRuntime.stop()));
      return {
        ok: false,
        state: sessionStatus.state,
        message: sessionStatus.message,
        transportUrl: sessionStatus.transportUrl,
      };
    }

    const runtime: StartedMeshPongBrowserWebSocketRuntime = {
      mode: 'websocket',
      transportUrl: sessionStatus.transportUrl,
      playerSessionAddress: sessionStatus.actorAddress,
      lookupNode: a,
      a,
      b,
      flush: () => flushMeshPongBrowserWebSocketRuntime(runtime, helper),
      stop: () => stopMeshPongBrowserWebSocketRuntime(runtime),
    };

    await runtime.flush();
    return { ok: true, runtime };
  } catch (error) {
    await Promise.allSettled(startedNodes.reverse().map((nodeRuntime) => nodeRuntime.stop()));
    return {
      ok: false,
      state: 'transport-failed',
      message: error instanceof Error ? error.message : String(error),
      transportUrl: helperStatus.transportUrl,
    };
  }
}
