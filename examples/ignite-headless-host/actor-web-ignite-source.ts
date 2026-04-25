import type { IgniteActorSource, RuntimeGatewayScopeDescriptor } from '@actor-core/runtime/browser';
import {
  type ShipmentCommand as LogisticsCommand,
  type ShipmentContext as LogisticsContext,
  type ShipmentEvent as LogisticsEvent,
  REMOTE_ADDRESS,
} from './logistics-contract';
import { createLogisticsRuntimeHarness, type LogisticsRuntimeHarness } from './runtime-harness';
import {
  configuredGatewayUrl,
  createLogisticsServerGatewayRuntimeHarness,
  type GatewaySocket,
} from './server-gateway-client';

export type ActorWebSupervisionStrategy = 'restart' | 'resume' | 'stop' | 'escalate';

export interface ActorWebActorAddress {
  readonly id: string;
  readonly type: 'actor';
  readonly node: string;
  readonly path: string;
}

export interface ActorWebSupervisionPolicy {
  strategy: ActorWebSupervisionStrategy;
  maxRestarts?: number;
  withinMs?: number;
}

export interface ActorWebNodeDefinition<TAddress extends string = string> {
  readonly address: TAddress;
}

export interface ActorWebActorDefinition<
  TId extends string = string,
  TNode extends string = string,
> {
  readonly id: TId;
  readonly node: TNode;
  readonly behavior?: unknown;
  readonly supervision?: ActorWebSupervisionPolicy;
  readonly gateway?: {
    readonly scope: RuntimeGatewayScopeDescriptor;
  };
}

export interface ActorWebActorSourceOptions {
  gatewayUrl?: string;
  createSocket?: (url: string) => GatewaySocket;
}

export interface ActorWebActorDescriptor<TId extends string = string, TNode extends string = string>
  extends ActorWebActorDefinition<TId, TNode> {
  readonly key: string;
  readonly nodeAddress: string;
  readonly address: ActorWebActorAddress;
  source(options?: ActorWebActorSourceOptions): LogisticsRuntimeHarness;
}

export interface ActorWebSupervisorDefinition<TNode extends string = string> {
  readonly node: TNode;
  readonly strategy?: 'one-for-one' | 'one-for-all' | 'rest-for-one' | 'escalate';
  readonly children: readonly string[];
}

export interface ActorWebSupervisorDescriptor<TNode extends string = string>
  extends ActorWebSupervisorDefinition<TNode> {
  readonly key: string;
  readonly nodeAddress: string;
}

type ActorWebTopologyInput = {
  readonly contractVersion?: string;
  readonly nodes: Record<string, ActorWebNodeDefinition>;
  readonly actors: Record<string, ActorWebActorDefinition>;
  readonly supervisors?: Record<string, ActorWebSupervisorDefinition>;
};

export type ActorWebTopology<TInput extends ActorWebTopologyInput> = {
  readonly contractVersion?: string;
  readonly nodes: TInput['nodes'];
  readonly actors: {
    readonly [K in keyof TInput['actors']]: ActorWebActorDescriptor;
  };
  readonly supervisors: {
    readonly [K in keyof NonNullable<TInput['supervisors']>]: ActorWebSupervisorDescriptor;
  };
};

export function node<TAddress extends string>(address: TAddress): ActorWebNodeDefinition<TAddress> {
  return { address };
}

export function actor<TId extends string, TNode extends string>(
  definition: ActorWebActorDefinition<TId, TNode>
): ActorWebActorDefinition<TId, TNode> {
  return definition;
}

export function supervisor<TNode extends string>(
  definition: ActorWebSupervisorDefinition<TNode>
): ActorWebSupervisorDefinition<TNode> {
  return definition;
}

export function defineActorWebTopology<TInput extends ActorWebTopologyInput>(
  input: TInput
): ActorWebTopology<TInput> {
  const actors = Object.fromEntries(
    Object.entries(input.actors).map(([key, definition]) => {
      const nodeDefinition = input.nodes[definition.node];
      if (!nodeDefinition) {
        throw new Error(`Actor "${key}" references unknown node "${definition.node}".`);
      }

      const address: ActorWebActorAddress = {
        id: definition.id,
        type: 'actor',
        node: nodeDefinition.address,
        path: `actor://${nodeDefinition.address}/actor/${definition.id}`,
      };

      return [
        key,
        {
          ...definition,
          key,
          nodeAddress: nodeDefinition.address,
          address,
          source(options?: ActorWebActorSourceOptions): LogisticsRuntimeHarness {
            return createActorWebSource(
              {
                ...definition,
                key,
                nodeAddress: nodeDefinition.address,
                address,
              },
              options
            );
          },
        },
      ];
    })
  );

  const supervisors = Object.fromEntries(
    Object.entries(input.supervisors ?? {}).map(([key, definition]) => {
      const nodeDefinition = input.nodes[definition.node];
      if (!nodeDefinition) {
        throw new Error(`Supervisor "${key}" references unknown node "${definition.node}".`);
      }

      return [
        key,
        {
          ...definition,
          key,
          nodeAddress: nodeDefinition.address,
        },
      ];
    })
  );

  return {
    contractVersion: input.contractVersion,
    nodes: input.nodes,
    actors: actors as ActorWebTopology<TInput>['actors'],
    supervisors: supervisors as ActorWebTopology<TInput>['supervisors'],
  };
}

export function createActorWebSource(
  actorDescriptor:
    | ActorWebActorDescriptor
    | { address: ActorWebActorAddress; gateway?: { scope: RuntimeGatewayScopeDescriptor } },
  options: ActorWebActorSourceOptions = {}
): LogisticsRuntimeHarness {
  if (actorDescriptor.address.path === REMOTE_ADDRESS.path && !options.gatewayUrl) {
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
