import {
  type ActorWebGatewaySocket,
  createActorWebSource as createRuntimeActorWebSource,
  type IgniteActorSource,
  type RuntimeGatewayScopeDescriptor,
} from '@actor-core/runtime/browser';
import type { ActorWebActorAddress, ActorWebActorDescriptor } from '@actor-core/runtime/topology';
import type {
  ShipmentCommand as LogisticsCommand,
  ShipmentContext as LogisticsContext,
  ShipmentEvent as LogisticsEvent,
} from './logistics-contract';
import { createLogisticsRuntimeHarness, type LogisticsRuntimeHarness } from './runtime-harness';
import { configuredGatewayUrl } from './server-gateway-client';

export interface ActorWebActorSourceOptions {
  gatewayUrl?: string;
  createSocket?: (url: string) => ActorWebGatewaySocket;
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

  const sourceOptions = {
    gateway: {
      url,
      ...(actorDescriptor.gateway?.scope ? { scope: actorDescriptor.gateway.scope } : {}),
    },
    clientVersion: 'ignite-headless-host',
    ...(options.createSocket ? { createSocket: options.createSocket } : {}),
  };
  const source =
    'nodeAddress' in actorDescriptor
      ? createRuntimeActorWebSource(actorDescriptor, sourceOptions)
      : createRuntimeActorWebSource(
          {
            address: actorDescriptor.address,
            gateway: sourceOptions.gateway,
          },
          sourceOptions
        );

  return {
    source: source as unknown as LogisticsActorSource,
    async destroy(): Promise<void> {
      source.close();
    },
  };
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
