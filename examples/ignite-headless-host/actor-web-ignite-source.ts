import type { IgniteActorSource, RuntimeGatewayScopeDescriptor } from '@actor-core/runtime/browser';
import type { ActorWebActorAddress, ActorWebActorDescriptor } from './actor-web-topology';
import type {
  ShipmentCommand as LogisticsCommand,
  ShipmentContext as LogisticsContext,
  ShipmentEvent as LogisticsEvent,
} from './logistics-contract';
import { createLogisticsRuntimeHarness, type LogisticsRuntimeHarness } from './runtime-harness';
import {
  configuredGatewayUrl,
  createLogisticsServerGatewayRuntimeHarness,
  type GatewaySocket,
} from './server-gateway-client';

export interface ActorWebActorSourceOptions {
  gatewayUrl?: string;
  createSocket?: (url: string) => GatewaySocket;
}

export function createActorWebSource(
  actorDescriptor:
    | ActorWebActorDescriptor
    | { address: ActorWebActorAddress; gateway?: { scope: RuntimeGatewayScopeDescriptor } },
  options: ActorWebActorSourceOptions = {}
): LogisticsRuntimeHarness {
  if (actorDescriptor.gateway?.scope.kind === 'logistics-shipment' && !options.gatewayUrl) {
    return createLogisticsRuntimeHarness();
  }

  const url = options.gatewayUrl ?? configuredGatewayUrl();
  if (!url) {
    throw new Error(
      `Actor-Web source for ${actorDescriptor.address.path} requires a configured gateway URL.`
    );
  }

  return createLogisticsServerGatewayRuntimeHarness({
    url,
    ...(actorDescriptor.gateway?.scope ? { scope: actorDescriptor.gateway.scope } : {}),
    ...(options.createSocket ? { createSocket: options.createSocket } : {}),
  });
}

export type LogisticsActorSource = IgniteActorSource<
  LogisticsContext,
  LogisticsCommand,
  LogisticsEvent
>;
export type LogisticsSourceHandle = {
  readonly source: LogisticsActorSource;
  destroy(): Promise<void>;
};

export function createLogisticsActorSource(
  actorDescriptor: ActorWebActorDescriptor,
  options?: ActorWebActorSourceOptions
): LogisticsRuntimeHarness {
  return createActorWebSource(actorDescriptor, options);
}
