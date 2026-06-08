/// <reference types="node" />

import {
  createRuntimeTransportTelemetryExporter,
  createRuntimeTransportTelemetryJsonlFileSink,
  createStaticRuntimePeerDiscoveryProvider,
  type RuntimeTransportTelemetryExporter,
  type ServedActorWebNode,
  serveActorWebNode,
} from '@actor-web/runtime/node';
import { logistics } from './logistics-topology';

interface LogisticsWorkerReadyPayload {
  readonly nodeAddress: string;
  readonly serverTransportUrl: string;
  readonly connectedNodes: readonly string[];
}

const serverNode = logistics.nodes.server.address;
const workerNode = logistics.nodes.worker.address;
const DEFAULT_SERVER_TRANSPORT_PORT = 4102;

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

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

async function stopTelemetry(
  telemetry: RuntimeTransportTelemetryExporter | undefined
): Promise<void> {
  await telemetry?.close();
}

async function main(): Promise<void> {
  const serverTransportUrl = resolveServerTransportUrl();
  const runtimeAuthToken = process.env.ACTOR_WEB_RUNTIME_AUTH_TOKEN;
  const outboundQueueLimit = parseOptionalNumber(
    process.env.ACTOR_WEB_TRANSPORT_OUTBOUND_QUEUE_LIMIT
  );
  const telemetry = process.env.ACTOR_WEB_TELEMETRY_JSONL
    ? createRuntimeTransportTelemetryExporter({
        sink: createRuntimeTransportTelemetryJsonlFileSink(process.env.ACTOR_WEB_TELEMETRY_JSONL),
      })
    : undefined;
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
      ...(runtimeAuthToken
        ? {
            auth: {
              token: runtimeAuthToken,
              verifyToken: ({ token }: { readonly token?: string }) =>
                token === runtimeAuthToken || {
                  ok: false as const,
                  reason: 'Shared runtime secret rejected.',
                },
            },
          }
        : {}),
      ...(outboundQueueLimit !== undefined ? { outboundQueueLimit } : {}),
      ...(telemetry ? { telemetry: telemetry.observe } : {}),
    },
    discovery,
  });

  const ready: LogisticsWorkerReadyPayload = {
    nodeAddress: workerNode,
    serverTransportUrl,
    connectedNodes: worker.transport.getConnectedNodes(),
  };
  console.log(`LOGISTICS_WORKER_READY ${JSON.stringify(ready)}`);

  const keepAlive = setInterval(() => {}, 60_000);
  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      clearInterval(keepAlive);
      void stopWorker(worker)
        .then(() => stopTelemetry(telemetry))
        .catch((error) => {
          console.error(error);
          process.exitCode = 1;
        })
        .finally(resolve);
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
