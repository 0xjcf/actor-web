import type { ActorBehavior, ActorMessage } from './actor-system.js';
import type { RuntimeGatewayScopeDescriptor } from './runtime-gateway.js';

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

export interface ActorWebToolDefinition<TName extends string = string> {
  readonly name: TName;
  readonly description?: string;
}

export type ActorWebToolReference<TName extends string = string> =
  | TName
  | ActorWebToolDefinition<TName>;

export interface ActorWebNodeDefinition<TAddress extends string = string> {
  readonly address: TAddress;
}

export interface ActorWebActorDefinition<
  TId extends string = string,
  TNode extends string = string,
  TBehavior = unknown,
> {
  readonly id: TId;
  readonly node: TNode;
  readonly behavior?: TBehavior;
  readonly supervision?: ActorWebSupervisionPolicy;
  readonly tools?: readonly ActorWebToolReference[];
  readonly gateway?: {
    readonly scope: RuntimeGatewayScopeDescriptor;
  };
}

export type ActorWebActorContext<TActor> = TActor extends {
  readonly behavior?: infer TBehavior;
}
  ? ActorWebBehaviorContext<NonNullable<TBehavior>>
  : unknown;

export type ActorWebActorMessage<TActor> = TActor extends {
  readonly behavior?: infer TBehavior;
}
  ? ActorWebBehaviorMessage<NonNullable<TBehavior>>
  : ActorMessage;

export type ActorWebActorEvent<TActor> = TActor extends {
  readonly behavior?: infer TBehavior;
}
  ? ActorWebBehaviorEvent<NonNullable<TBehavior>>
  : ActorMessage;

type ActorWebBehaviorContext<TBehavior> = TBehavior extends (
  ...args: readonly never[]
) => infer TReturn
  ? ActorWebBehaviorContext<TReturn>
  : TBehavior extends { readonly __contextType: infer TContext }
    ? TContext
    : unknown;

type ActorWebBehaviorMessage<TBehavior> = TBehavior extends (
  ...args: readonly never[]
) => infer TReturn
  ? ActorWebBehaviorMessage<TReturn>
  : TBehavior extends { readonly __messageType: infer TMessage }
    ? TMessage extends ActorMessage
      ? TMessage
      : ActorMessage
    : TBehavior extends ActorBehavior<infer TMessage, unknown>
      ? TMessage extends ActorMessage
        ? TMessage
        : ActorMessage
      : ActorMessage;

type ActorWebBehaviorEvent<TBehavior> = TBehavior extends (
  ...args: readonly never[]
) => infer TReturn
  ? ActorWebBehaviorEvent<TReturn>
  : TBehavior extends ActorBehavior<unknown, infer TEvent>
    ? TEvent extends ActorMessage
      ? TEvent
      : ActorMessage
    : ActorMessage;

export interface ActorWebActorDescriptor<
  TId extends string = string,
  TNode extends string = string,
  TBehavior = unknown,
> extends ActorWebActorDefinition<TId, TNode, TBehavior> {
  readonly key: string;
  readonly nodeAddress: string;
  readonly address: ActorWebActorAddress;
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

export type ActorWebToolCatalogInput =
  | readonly ActorWebToolDefinition[]
  | Record<string, ActorWebToolDefinition>;

export type ActorWebTopologyInput = {
  readonly contractVersion?: string;
  readonly tools?: ActorWebToolCatalogInput;
  readonly nodes: Record<string, ActorWebNodeDefinition>;
  readonly actors: Record<string, ActorWebActorDefinition>;
  readonly supervisors?: Record<string, ActorWebSupervisorDefinition>;
};

type ActorWebToolCatalogFromArray<TTools extends readonly ActorWebToolDefinition[]> = {
  readonly [TTool in TTools[number] as TTool['name']]: TTool;
};

type ActorWebTopologyTools<TInput extends ActorWebTopologyInput> = TInput extends {
  readonly tools: infer TTools;
}
  ? TTools extends readonly ActorWebToolDefinition[]
    ? ActorWebToolCatalogFromArray<TTools>
    : TTools extends Record<string, ActorWebToolDefinition>
      ? TTools
      : Record<string, never>
  : Record<string, never>;

export type ActorWebTopology<TInput extends ActorWebTopologyInput> = {
  readonly contractVersion?: string;
  readonly tools: ActorWebTopologyTools<TInput>;
  readonly nodes: TInput['nodes'];
  readonly actors: {
    readonly [K in keyof TInput['actors']]: ActorWebActorDescriptor<
      TInput['actors'][K]['id'],
      TInput['actors'][K]['node'],
      TInput['actors'][K] extends { readonly behavior?: infer TBehavior } ? TBehavior : unknown
    >;
  };
  readonly supervisors: {
    readonly [K in keyof NonNullable<TInput['supervisors']>]: ActorWebSupervisorDescriptor;
  };
};

export function node<TAddress extends string>(address: TAddress): ActorWebNodeDefinition<TAddress> {
  return { address };
}

export function actor<TDefinition extends ActorWebActorDefinition>(
  definition: TDefinition
): TDefinition {
  return definition;
}

export function supervisor<TDefinition extends ActorWebSupervisorDefinition>(
  definition: TDefinition
): TDefinition {
  return definition;
}

export function tool<TName extends string>(
  name: TName,
  options: Omit<ActorWebToolDefinition<TName>, 'name'> = {}
): ActorWebToolDefinition<TName> {
  return {
    name,
    ...options,
  };
}

function normalizeActorWebToolCatalog(
  tools: ActorWebToolCatalogInput | undefined
): Record<string, ActorWebToolDefinition> {
  if (!tools) {
    return {};
  }

  if (Array.isArray(tools)) {
    return Object.fromEntries(
      tools.map((toolDefinition: ActorWebToolDefinition) => [toolDefinition.name, toolDefinition])
    );
  }

  return tools as Record<string, ActorWebToolDefinition>;
}

export function defineActorWebTopology<TInput extends ActorWebTopologyInput>(
  input: TInput
): ActorWebTopology<TInput> {
  const toolCatalog = normalizeActorWebToolCatalog(input.tools);
  const actors = Object.fromEntries(
    Object.entries(input.actors).map(([key, definition]) => {
      const nodeDefinition = input.nodes[definition.node];
      if (!nodeDefinition) {
        throw new Error(`Actor "${key}" references unknown node "${definition.node}".`);
      }
      if (input.tools) {
        for (const toolReference of definition.tools ?? []) {
          const toolName = typeof toolReference === 'string' ? toolReference : toolReference.name;
          if (!toolCatalog[toolName]) {
            throw new Error(`Actor "${key}" references unknown tool "${toolName}".`);
          }
        }
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
    tools: toolCatalog as ActorWebTopologyTools<TInput>,
    nodes: input.nodes,
    actors: actors as ActorWebTopology<TInput>['actors'],
    supervisors: supervisors as ActorWebTopology<TInput>['supervisors'],
  };
}
