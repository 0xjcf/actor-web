/// <reference types="node" />

import {
  createRuntimeTransportTelemetryExporter,
  createRuntimeTransportTelemetryJsonlFileSink,
  type RuntimeTransportTelemetryExporter,
} from '@actor-core/runtime/node';
import type { ProviderRuntimeSource } from './logistics-contract';
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
  readonly providerRuntimeEnabled: boolean;
  readonly providerRuntimeSource: ProviderRuntimeSource;
}

const DEFAULT_REST_PORT = 4100;
const DEFAULT_GATEWAY_PORT = 4101;
const DEFAULT_TRANSPORT_PORT = 4102;

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseLifecycleMode(value: string | undefined): LifecycleMode {
  return value === 'manual' ? 'manual' : 'simulation';
}

function parseProviderRuntimeEnabled(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

function parseProviderRuntimeSource(value: string | undefined): ProviderRuntimeSource {
  return value === 'container' ? 'container' : value === 'process' ? 'process' : 'embedded';
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

async function stopTelemetry(
  telemetry: RuntimeTransportTelemetryExporter | undefined
): Promise<void> {
  await telemetry?.close();
}

async function main(): Promise<void> {
  const lifecycleMode = parseLifecycleMode(process.env.LOGISTICS_LIFECYCLE_MODE);
  const providerRuntimeEnabled = parseProviderRuntimeEnabled(
    process.env.ACTOR_WEB_PROVIDER_RUNTIME_ENABLED
  );
  const providerRuntimeSource = parseProviderRuntimeSource(
    process.env.ACTOR_WEB_PROVIDER_RUNTIME_SOURCE
  );
  const telemetry = process.env.ACTOR_WEB_TELEMETRY_JSONL
    ? createRuntimeTransportTelemetryExporter({
        sink: createRuntimeTransportTelemetryJsonlFileSink(process.env.ACTOR_WEB_TELEMETRY_JSONL),
      })
    : undefined;
  const server = createLogisticsRuntimeGatewayServer({
    host: process.env.ACTOR_WEB_HOST ?? '127.0.0.1',
    port: parsePort(process.env.ACTOR_WEB_GATEWAY_PORT, DEFAULT_GATEWAY_PORT),
    transportPort: parsePort(process.env.ACTOR_WEB_TRANSPORT_PORT, DEFAULT_TRANSPORT_PORT),
    restPort: parsePort(process.env.ACTOR_WEB_REST_PORT, DEFAULT_REST_PORT),
    lifecycleMode,
    providerRuntimeEnabled,
    providerRuntimeSource,
    ...(telemetry ? { transportTelemetry: telemetry.observe } : {}),
  });

  await server.start();

  const ready: LogisticsServerReadyPayload = {
    restUrl: requireServerUrl('REST URL', server.getRestUrl()),
    gatewayUrl: requireServerUrl('gateway URL', server.getGatewayUrl()),
    transportUrl: requireServerUrl('transport URL', server.getTransportUrl()),
    lifecycleMode,
    providerRuntimeEnabled,
    providerRuntimeSource,
  };
  console.log(`LOGISTICS_SERVER_READY ${JSON.stringify(ready)}`);

  const shutdown = (): void => {
    void stopServer(server)
      .then(() => stopTelemetry(telemetry))
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
