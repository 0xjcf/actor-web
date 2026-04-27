/// <reference types="vite/client" />

import type {
  ActorWebGatewaySocket,
  IgniteActorSource,
  RuntimeGatewayScopeDescriptor,
} from '@actor-core/runtime/browser';
import { createActorWebSource } from '@actor-core/runtime/browser';
import type { ActorWebActorDescriptor } from '@actor-core/runtime/topology';
import type { ShipmentCommand, ShipmentContext, ShipmentEvent } from './logistics-contract';
import { logistics } from './logistics-topology';
import type { LogisticsRuntimeHarness } from './runtime-harness';

export type GatewaySocket = ActorWebGatewaySocket;

export interface CreateLogisticsServerGatewaySourceOptions {
  url: string;
  streamId?: string;
  scope?: RuntimeGatewayScopeDescriptor;
  createSocket?: (url: string) => GatewaySocket;
}

function defaultGatewayUrl(): string | undefined {
  const configuredUrl = import.meta.env.VITE_ACTOR_WEB_GATEWAY_URL;
  return typeof configuredUrl === 'string' && configuredUrl.trim().length > 0
    ? configuredUrl
    : undefined;
}

export function configuredGatewayUrl(): string | undefined {
  return defaultGatewayUrl();
}

export function serverGatewayRuntimeAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof WebSocket !== 'undefined' &&
    defaultGatewayUrl() !== undefined
  );
}

function gatewayActorForScope(
  scope: RuntimeGatewayScopeDescriptor | undefined
): ActorWebActorDescriptor {
  if (scope?.kind === logistics.actors.routing.gateway?.scope.kind) {
    return logistics.actors.routing;
  }

  return logistics.actors.shipment;
}

export function createLogisticsServerGatewayRuntimeHarness(
  options: CreateLogisticsServerGatewaySourceOptions
): LogisticsRuntimeHarness {
  const actorDescriptor = gatewayActorForScope(options.scope);
  const source = createActorWebSource(actorDescriptor, {
    gateway: {
      url: options.url,
      scope: options.scope ?? actorDescriptor.gateway?.scope,
    },
    streamId: options.streamId ?? `logistics-${actorDescriptor.key}`,
    clientVersion: 'ignite-headless-host',
    ...(options.createSocket ? { createSocket: options.createSocket } : {}),
  }) as IgniteActorSource<ShipmentContext, ShipmentCommand, ShipmentEvent> & { close(): void };

  return {
    source,
    async destroy(): Promise<void> {
      source.close();
    },
  };
}

export function createConfiguredLogisticsServerGatewayRuntimeHarness(): LogisticsRuntimeHarness {
  const url = defaultGatewayUrl();
  if (!url) {
    throw new Error('VITE_ACTOR_WEB_GATEWAY_URL is not configured.');
  }

  const shipmentHarness = createLogisticsServerGatewayRuntimeHarness({ url });
  const routingHarness = createLogisticsServerGatewayRuntimeHarness({
    url,
    streamId: 'logistics-routing',
    scope: logistics.actors.routing.gateway?.scope,
  });

  return {
    source: shipmentHarness.source,
    routingSource: routingHarness.source,
    async destroy(): Promise<void> {
      await Promise.allSettled([shipmentHarness.destroy(), routingHarness.destroy()]);
    },
  };
}
