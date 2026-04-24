/// <reference lib="webworker" />

import {
  type BrowserWebSocketMessageTransport,
  createActorSystem,
  createBrowserWebSocketMessageTransport,
} from '@actor-core/runtime/browser';
import {
  createRoutingBehavior,
  REMOTE_NODE,
  WORKER_ACTOR_ID,
  WORKER_NODE,
} from './checkout-contract';

declare const self: DedicatedWorkerGlobalScope;

type WorkerRuntimeCommand =
  | {
      type: 'start';
      transportUrl: string;
    }
  | {
      type: 'stop';
    };

type WorkerRuntimeStatus =
  | {
      type: 'status';
      state: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
      workerNode: string;
      peerNode: string;
      actorId: string;
      reason?: string;
    }
  | {
      type: 'ready';
      workerNode: string;
      peerNode: string;
      actorId: string;
    };

let transport: BrowserWebSocketMessageTransport | null = null;
let system: Awaited<ReturnType<typeof createActorSystem>> | null = null;

function postStatus(status: WorkerRuntimeStatus): void {
  self.postMessage(status);
}

async function stopRuntime(): Promise<void> {
  await Promise.allSettled([system?.stop(), transport?.stop()]);
  system = null;
  transport = null;
  postStatus({
    type: 'status',
    state: 'disconnected',
    workerNode: WORKER_NODE,
    peerNode: REMOTE_NODE,
    actorId: WORKER_ACTOR_ID,
  });
}

async function startRuntime(transportUrl: string): Promise<void> {
  await stopRuntime();
  postStatus({
    type: 'status',
    state: 'connecting',
    workerNode: WORKER_NODE,
    peerNode: REMOTE_NODE,
    actorId: WORKER_ACTOR_ID,
  });

  transport = createBrowserWebSocketMessageTransport({
    nodeAddress: WORKER_NODE,
    incarnation: `${WORKER_NODE}-${Date.now()}`,
    heartbeatIntervalMs: 5000,
    heartbeatTimeoutMs: 15000,
    peers: {
      [REMOTE_NODE]: transportUrl,
    },
  });
  system = createActorSystem({
    nodeAddress: WORKER_NODE,
    transport,
  });

  await system.start();
  await system.spawn(createRoutingBehavior(), {
    id: WORKER_ACTOR_ID,
  });
  await system.join([REMOTE_NODE]);

  postStatus({
    type: 'ready',
    workerNode: WORKER_NODE,
    peerNode: REMOTE_NODE,
    actorId: WORKER_ACTOR_ID,
  });
  postStatus({
    type: 'status',
    state: 'connected',
    workerNode: WORKER_NODE,
    peerNode: REMOTE_NODE,
    actorId: WORKER_ACTOR_ID,
  });
}

self.addEventListener('message', (event: MessageEvent<WorkerRuntimeCommand>) => {
  const command = event.data;
  if (command.type === 'stop') {
    void stopRuntime();
    return;
  }

  void startRuntime(command.transportUrl).catch((error: unknown) => {
    postStatus({
      type: 'status',
      state: 'error',
      workerNode: WORKER_NODE,
      peerNode: REMOTE_NODE,
      actorId: WORKER_ACTOR_ID,
      reason: error instanceof Error ? error.message : String(error),
    });
  });
});
