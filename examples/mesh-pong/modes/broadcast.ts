import type { MessageTransport } from '@actor-web/runtime/browser';
import {
  type ActorToolRegistry,
  type BroadcastChannelLike,
  createBroadcastChannelMessageTransport,
  type StartedActorWebNode,
  startActorWebNode,
} from '@actor-web/runtime/browser';
import { createPongClientNodeAddress, PONG_NODE_ADDRESSES } from '../pong-contract';
import { createPongControllerTools } from '../pong-controller';
import { createPongTopology } from '../pong-topology';

type PongTopology = ReturnType<typeof createPongTopology>;
type StartedPongNode = StartedActorWebNode<PongTopology, MessageTransport>;

export interface MeshPongWebLock {
  readonly name: string;
}

export interface MeshPongWebLocks {
  request<T>(
    name: string,
    options: { readonly ifAvailable: true },
    callback: (lock: MeshPongWebLock | null) => Promise<T> | T
  ): Promise<T>;
}

export interface MeshPongBroadcastOptions {
  readonly sessionId?: string;
  readonly channelName?: string;
  readonly broadcastChannelFactory?: (channelName: string) => BroadcastChannelLike;
  readonly tools?: ActorToolRegistry;
  readonly webLocks?: MeshPongWebLocks;
}

export interface StartedMeshPongBroadcast {
  readonly mode: 'broadcast';
  readonly hostAcquired: boolean;
  readonly channelName: string;
  readonly clientNodeAddress: string;
  readonly client: StartedPongNode;
  readonly lookupNode: StartedPongNode;
  readonly server?: StartedPongNode;
  readonly a?: StartedPongNode;
  readonly b?: StartedPongNode;
  flush(): Promise<void>;
  stop(): Promise<void>;
}

interface BroadcastLeaseHandle {
  readonly release: () => void;
}

function resolveWebLocks(options: MeshPongBroadcastOptions): MeshPongWebLocks {
  if (options.webLocks) {
    return options.webLocks;
  }
  if (!globalThis.navigator?.locks) {
    throw new Error('Mesh Pong broadcast mode requires Web Locks support.');
  }
  return {
    // Browser host election delegates to navigator.locks.request with ifAvailable: true.
    request: (name, lockOptions, callback) =>
      globalThis.navigator?.locks?.request(name, lockOptions, callback) ??
      Promise.reject(new Error('Mesh Pong broadcast mode requires Web Locks support.')),
  };
}

function createBroadcastTransport(
  nodeAddress: string,
  channelName: string,
  options: MeshPongBroadcastOptions
): MessageTransport {
  return createBroadcastChannelMessageTransport({
    nodeAddress,
    incarnation: `${nodeAddress}-mesh-pong`,
    channelName,
    heartbeatIntervalMs: 0,
    ...(options.broadcastChannelFactory
      ? { broadcastChannelFactory: options.broadcastChannelFactory }
      : {}),
  });
}

async function connectHostNodes(
  host: {
    readonly server: StartedPongNode;
    readonly a: StartedPongNode;
    readonly b: StartedPongNode;
    readonly client: StartedPongNode;
  },
  clientNodeAddress: string
): Promise<void> {
  await host.server.system.join([PONG_NODE_ADDRESSES.a, PONG_NODE_ADDRESSES.b, clientNodeAddress]);
  await host.a.system.join([PONG_NODE_ADDRESSES.server]);
  await host.b.system.join([PONG_NODE_ADDRESSES.server]);
  await host.client.system.join([PONG_NODE_ADDRESSES.server]);
}

async function flushNodes(nodes: readonly StartedPongNode[]): Promise<void> {
  await Promise.all(nodes.map((nodeRuntime) => nodeRuntime.system.flush()));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.all(nodes.map((nodeRuntime) => nodeRuntime.system.flush()));
}

async function stopNodes(nodes: readonly StartedPongNode[]): Promise<void> {
  await Promise.allSettled([...nodes].reverse().map((nodeRuntime) => nodeRuntime.stop()));
}

export async function startMeshPongBroadcastHost(
  options: MeshPongBroadcastOptions = {}
): Promise<StartedMeshPongBroadcast> {
  const sessionId = options.sessionId ?? 'host';
  const channelName = options.channelName ?? 'mesh-pong';
  const clientNodeAddress = createPongClientNodeAddress(sessionId);
  const topology = createPongTopology({ clientNodeAddress });
  const startedNodes: StartedPongNode[] = [];

  try {
    const server = await startActorWebNode(topology, {
      node: 'server',
      transport: createBroadcastTransport(PONG_NODE_ADDRESSES.server, channelName, options),
      tools: createPongControllerTools(options.tools),
    });
    startedNodes.push(server);

    const a = await startActorWebNode(topology, {
      node: 'a',
      transport: createBroadcastTransport(PONG_NODE_ADDRESSES.a, channelName, options),
      tools: createPongControllerTools(options.tools),
    });
    startedNodes.push(a);

    const b = await startActorWebNode(topology, {
      node: 'b',
      transport: createBroadcastTransport(PONG_NODE_ADDRESSES.b, channelName, options),
      tools: createPongControllerTools(options.tools),
    });
    startedNodes.push(b);

    const client = await startActorWebNode(topology, {
      node: 'client',
      transport: createBroadcastTransport(clientNodeAddress, channelName, options),
    });
    startedNodes.push(client);

    await connectHostNodes({ server, a, b, client }, clientNodeAddress);

    const runtime: StartedMeshPongBroadcast = {
      mode: 'broadcast',
      hostAcquired: true,
      channelName,
      clientNodeAddress,
      client,
      lookupNode: client,
      server,
      a,
      b,
      flush: () => flushNodes(startedNodes),
      stop: () => stopNodes(startedNodes),
    };

    await runtime.flush();
    return runtime;
  } catch (error) {
    await stopNodes(startedNodes);
    throw error;
  }
}

export async function startMeshPongBroadcastClient(
  options: MeshPongBroadcastOptions = {}
): Promise<StartedMeshPongBroadcast> {
  const sessionId = options.sessionId ?? 'client';
  const channelName = options.channelName ?? 'mesh-pong';
  const clientNodeAddress = createPongClientNodeAddress(sessionId);
  const topology = createPongTopology({ clientNodeAddress });
  const client = await startActorWebNode(topology, {
    node: 'client',
    transport: createBroadcastTransport(clientNodeAddress, channelName, options),
  });

  await client.system.join([PONG_NODE_ADDRESSES.server]);
  const runtime: StartedMeshPongBroadcast = {
    mode: 'broadcast',
    hostAcquired: false,
    channelName,
    clientNodeAddress,
    client,
    lookupNode: client,
    flush: () => flushNodes([client]),
    stop: () => stopNodes([client]),
  };
  await runtime.flush();
  return runtime;
}

export async function startMeshPongBroadcast(
  options: MeshPongBroadcastOptions = {}
): Promise<StartedMeshPongBroadcast> {
  const channelName = options.channelName ?? 'mesh-pong';
  const webLocks = resolveWebLocks(options);
  return new Promise<StartedMeshPongBroadcast>((resolve, reject) => {
    let settled = false;

    const resolveStart = (runtime: StartedMeshPongBroadcast): void => {
      if (!settled) {
        settled = true;
        resolve(runtime);
      }
    };

    const rejectStart = (error: unknown): void => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    const withHostLease = (
      runtime: StartedMeshPongBroadcast,
      leaseHandle: BroadcastLeaseHandle
    ): StartedMeshPongBroadcast => {
      let released = false;

      return {
        ...runtime,
        stop: async () => {
          try {
            await runtime.stop();
          } finally {
            if (!released) {
              released = true;
              leaseHandle.release();
            }
          }
        },
      };
    };

    void webLocks
      .request(`mesh-pong:${channelName}:host`, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolveStart(await startMeshPongBroadcastClient(options));
          return;
        }

        let releaseLease!: () => void;
        const leaseReleased = new Promise<void>((resolveLease) => {
          releaseLease = resolveLease;
        });

        try {
          const hostRuntime = await startMeshPongBroadcastHost(options);
          resolveStart(withHostLease(hostRuntime, { release: releaseLease }));
          await leaseReleased;
        } catch (error) {
          rejectStart(error);
          throw error;
        }
      })
      .catch((error) => {
        rejectStart(error);
      });
  });
}
