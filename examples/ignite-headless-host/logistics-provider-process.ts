/// <reference types="node" />

import {
  createRuntimeTransportTelemetryExporter,
  createRuntimeTransportTelemetryJsonlFileSink,
  createStaticRuntimePeerDiscoveryProvider,
  type RuntimeTransportTelemetryExporter,
  type ServedActorWebNode,
  serveActorWebNode,
} from '@actor-core/runtime/node';
import { logistics } from './logistics-topology';

interface LogisticsProviderReadyPayload {
  readonly nodeAddress: string;
  readonly serverTransportUrl: string;
  readonly connectedNodes: readonly string[];
}

const serverNode = logistics.nodes.server.address;
const providerNode = logistics.nodes.provider.address;

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveServerTransportUrl(): string {
  const url = process.env.ACTOR_WEB_SERVER_TRANSPORT_URL;
  if (url) {
    return url;
  }

  throw new Error('ACTOR_WEB_SERVER_TRANSPORT_URL is required for logistics provider runtime.');
}

async function stopProvider(provider: ServedActorWebNode<typeof logistics>): Promise<void> {
  await provider.stop();
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
  const provider = await serveActorWebNode(logistics, {
    node: 'provider',
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

  const ready: LogisticsProviderReadyPayload = {
    nodeAddress: providerNode,
    serverTransportUrl,
    connectedNodes: provider.transport.getConnectedNodes(),
  };
  console.log(`LOGISTICS_PROVIDER_READY ${JSON.stringify(ready)}`);

  const keepAlive = setInterval(() => {}, 60_000);
  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      clearInterval(keepAlive);
      void stopProvider(provider)
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
