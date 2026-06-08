/// <reference lib="webworker" />

import { type StartedActorWebNode, startActorWebNode } from '@actor-web/runtime/browser';
import { logistics } from './logistics-topology';

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

let runtimeNode: StartedActorWebNode<typeof logistics> | null = null;
const routingActor = logistics.actors.routing;
const serverNode = logistics.nodes.server.address;
const workerNode = logistics.nodes.worker.address;

function postStatus(status: WorkerRuntimeStatus): void {
  self.postMessage(status);
}

async function stopRuntime(): Promise<void> {
  await runtimeNode?.stop();
  runtimeNode = null;
  postStatus({
    type: 'status',
    state: 'disconnected',
    workerNode,
    peerNode: serverNode,
    actorId: routingActor.id,
  });
}

async function startRuntime(transportUrl: string): Promise<void> {
  await stopRuntime();
  postStatus({
    type: 'status',
    state: 'connecting',
    workerNode,
    peerNode: serverNode,
    actorId: routingActor.id,
  });

  runtimeNode = await startActorWebNode(logistics, {
    node: 'worker',
    peers: {
      server: transportUrl,
    },
    transport: {
      incarnation: `${workerNode}-${Date.now()}`,
      heartbeatIntervalMs: 5000,
      heartbeatTimeoutMs: 15000,
    },
  });

  postStatus({
    type: 'ready',
    workerNode,
    peerNode: serverNode,
    actorId: routingActor.id,
  });
  postStatus({
    type: 'status',
    state: 'connected',
    workerNode,
    peerNode: serverNode,
    actorId: routingActor.id,
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
      workerNode,
      peerNode: serverNode,
      actorId: routingActor.id,
      reason: error instanceof Error ? error.message : String(error),
    });
  });
});
