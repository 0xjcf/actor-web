/// <reference types="node" />

import type { LifecycleMode } from './logistics-provider-hq';
import {
  createLogisticsRuntimeGatewayServer,
  type LogisticsRuntimeGatewayServer,
} from './server-runtime-gateway';

interface LogisticsServerReadyPayload {
  readonly restUrl: string;
  readonly gatewayUrl: string;
  readonly transportUrl: string;
  readonly lifecycleMode: LifecycleMode;
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseLifecycleMode(value: string | undefined): LifecycleMode {
  return value === 'manual' ? 'manual' : 'simulation';
}

function requireServerUrl(name: string, value: string | null): string {
  if (!value) {
    throw new Error(`Logistics server process did not expose ${name}.`);
  }

  return value;
}

async function stopServer(server: LogisticsRuntimeGatewayServer): Promise<void> {
  await server.stop();
}

async function main(): Promise<void> {
  const lifecycleMode = parseLifecycleMode(process.env.LOGISTICS_LIFECYCLE_MODE);
  const server = createLogisticsRuntimeGatewayServer({
    host: process.env.ACTOR_WEB_HOST ?? '127.0.0.1',
    port: parsePort(process.env.ACTOR_WEB_GATEWAY_PORT),
    transportPort: parsePort(process.env.ACTOR_WEB_TRANSPORT_PORT),
    restPort: parsePort(process.env.ACTOR_WEB_REST_PORT),
    lifecycleMode,
  });

  await server.start();

  const ready: LogisticsServerReadyPayload = {
    restUrl: requireServerUrl('REST URL', server.getRestUrl()),
    gatewayUrl: requireServerUrl('gateway URL', server.getGatewayUrl()),
    transportUrl: requireServerUrl('transport URL', server.getTransportUrl()),
    lifecycleMode,
  };
  console.log(`LOGISTICS_SERVER_READY ${JSON.stringify(ready)}`);

  const shutdown = (): void => {
    void stopServer(server)
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
