import type { StartedNode } from '@actor-web/runtime/browser';
import { startNode } from '@actor-web/runtime/browser';
import { createPongClientNodeAddress } from '../pong-contract';
import { createPongTopology } from '../pong-topology';

type StartedPongNode = StartedNode<ReturnType<typeof createPongTopology>>;

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
  readonly startClientNode?: typeof startNode;
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
  let client: StartedPongNode | null = null;
  try {
    const startClientNode = options.startClientNode ?? startNode;
    client = await startClientNode(topology, {
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
    const playerSession = await client.actors.playerSession.instance({
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
    if (client) {
      await stopBrowserClient({ client });
    }
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
