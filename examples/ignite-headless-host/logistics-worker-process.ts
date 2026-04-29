/// <reference types="node" />

import {
  createStaticRuntimePeerDiscoveryProvider,
  type ServedActorWebNode,
  serveActorWebNode,
} from '@actor-core/runtime/node';
import { logistics } from './logistics-topology';

interface LogisticsWorkerReadyPayload {
  readonly nodeAddress: string;
  readonly serverTransportUrl: string;
  readonly connectedNodes: readonly string[];
}

const serverNode = logistics.nodes.server.address;
const workerNode = logistics.nodes.worker.address;
const DEFAULT_SERVER_TRANSPORT_PORT = 4102;

function resolveServerTransportUrl(): string {
  const url =
    process.env.ACTOR_WEB_SERVER_TRANSPORT_URL ?? process.env.VITE_ACTOR_WEB_TRANSPORT_URL;
  if (url) {
    return url;
  }

  const host = process.env.ACTOR_WEB_SERVER_HOST ?? process.env.ACTOR_WEB_HOST ?? '127.0.0.1';
  const port = process.env.ACTOR_WEB_SERVER_TRANSPORT_PORT ?? String(DEFAULT_SERVER_TRANSPORT_PORT);
  return `ws://${host}:${port}`;
}

async function stopWorker(worker: ServedActorWebNode<typeof logistics>): Promise<void> {
  await worker.stop();
}

async function main(): Promise<void> {
  const serverTransportUrl = resolveServerTransportUrl();
  const discovery = createStaticRuntimePeerDiscoveryProvider([
    {
      nodeAddress: serverNode,
      url: serverTransportUrl,
    },
  ]);
  const worker = await serveActorWebNode(logistics, {
    node: 'worker',
    host: process.env.ACTOR_WEB_HOST ?? '127.0.0.1',
    transport: {
      heartbeatIntervalMs: 5_000,
      heartbeatTimeoutMs: 15_000,
    },
    discovery,
  });

  const ready: LogisticsWorkerReadyPayload = {
    nodeAddress: workerNode,
    serverTransportUrl,
    connectedNodes: worker.transport.getConnectedNodes(),
  };
  console.log(`LOGISTICS_WORKER_READY ${JSON.stringify(ready)}`);

  const shutdown = (): void => {
    void stopWorker(worker)
      .catch((error) => {
        console.error(error);
        process.exitCode = 1;
      })
      .finally(() => {
        process.exit();
      });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
