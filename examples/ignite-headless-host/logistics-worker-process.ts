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

function requireServerTransportUrl(): string {
  const url =
    process.env.ACTOR_WEB_SERVER_TRANSPORT_URL ?? process.env.VITE_ACTOR_WEB_TRANSPORT_URL;
  if (!url) {
    throw new Error(
      'Logistics worker process requires ACTOR_WEB_SERVER_TRANSPORT_URL to connect to the server runtime.'
    );
  }

  return url;
}

async function stopWorker(worker: ServedActorWebNode<typeof logistics>): Promise<void> {
  await worker.stop();
}

async function main(): Promise<void> {
  const serverTransportUrl = requireServerTransportUrl();
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
