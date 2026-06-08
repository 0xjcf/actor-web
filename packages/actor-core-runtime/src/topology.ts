import type { ActorBehavior, ActorMessage } from './actor-system.js';
import type { ActorToolRegistry } from './actor-tools.js';
import {
  type ActorWebSourceOptions,
  type ClosableActorWebReadModelSource,
  type ClosableActorWebSource,
  createActorWebCommandSource,
  createActorWebReadModelSource,
  createActorWebSource,
  createActorWebSourceHandle,
} from './actor-web-source.js';
import {
  createRuntimeGatewaySourceHandle,
  type RuntimeGatewayScopeDescriptor,
  type RuntimeGatewaySourceHandle,
} from './runtime-gateway-shared.js';
import {
  defineActor as defineTopologyActorBehavior,
  type UnifiedActorBuilder,
} from './unified-actor-builder.js';

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

export type ActorWebActorIdResolver<TParams = unknown> = {
  bivarianceHack(params: TParams): string;
}['bivarianceHack'];

export type ActorWebActorId<TParams = unknown> = string | ActorWebActorIdResolver<TParams>;

export type ActorWebActorInstanceParams<TActor> = TActor extends {
  readonly id: ActorWebActorIdResolver<infer TParams>;
}
  ? TParams
  : never;

export interface ActorWebActorDefinition<
  TId extends ActorWebActorId = string,
  TNode extends string = string,
  TBehavior = unknown,
> {
  readonly id: TId;
  readonly node: TNode;
  readonly behavior?: TBehavior;
  readonly supervision?: ActorWebSupervisionPolicy;
  readonly tools?: readonly ActorWebToolReference[];
  readonly gateway?:
    | boolean
    | {
        readonly scope?: RuntimeGatewayScopeDescriptor;
      };
}

export interface ActorWebParameterizedActorDefinition<
  TParams,
  TNode extends string = string,
  TBehavior = unknown,
> extends Omit<
    ActorWebActorDefinition<
      ActorWebActorIdResolver<TParams>,
      TNode,
      (params: TParams) => TBehavior
    >,
    'behavior'
  > {
  readonly behavior?: (params: TParams) => TBehavior;
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

type ActorWebBehaviorContext<TBehavior> = TBehavior extends (...args: infer _TArgs) => infer TReturn
  ? ActorWebBehaviorContext<TReturn>
  : TBehavior extends { readonly __contextType: infer TContext }
    ? TContext
    : unknown;

type ActorWebBehaviorMessage<TBehavior> = TBehavior extends (...args: infer _TArgs) => infer TReturn
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

type ActorWebBehaviorEvent<TBehavior> = TBehavior extends (...args: infer _TArgs) => infer TReturn
  ? ActorWebBehaviorEvent<TReturn>
  : TBehavior extends ActorBehavior<infer _TMessage, infer TEvent>
    ? TEvent extends ActorMessage
      ? TEvent
      : ActorMessage
    : ActorMessage;

export interface ActorWebActorDescriptor<
  TId extends ActorWebActorId = ActorWebActorId,
  TNode extends string = string,
  TBehavior = unknown,
> extends ActorWebActorDefinition<TId, TNode, TBehavior> {
  readonly key: string;
  readonly nodeAddress: string;
  readonly address: ActorWebActorAddress;
  readonly gateway?: {
    readonly scope: RuntimeGatewayScopeDescriptor;
  };
  resolveId(
    params?: ActorWebActorInstanceParams<ActorWebActorDescriptor<TId, TNode, TBehavior>>
  ): string;
  resolveAddress(
    params?: ActorWebActorInstanceParams<ActorWebActorDescriptor<TId, TNode, TBehavior>>
  ): ActorWebActorAddress;
  source(
    options: ActorWebSourceOptions
  ): ClosableActorWebSource<
    ActorWebBehaviorContext<NonNullable<TBehavior>>,
    ActorWebBehaviorMessage<NonNullable<TBehavior>>,
    ActorWebBehaviorEvent<NonNullable<TBehavior>>
  >;
  sourceHandle(
    options: ActorWebSourceOptions
  ): RuntimeGatewaySourceHandle<
    ClosableActorWebReadModelSource<
      ActorWebBehaviorContext<NonNullable<TBehavior>>,
      ActorWebBehaviorEvent<NonNullable<TBehavior>>
    >,
    ClosableActorWebSource<
      ActorWebBehaviorContext<NonNullable<TBehavior>>,
      ActorWebBehaviorMessage<NonNullable<TBehavior>>,
      ActorWebBehaviorEvent<NonNullable<TBehavior>>
    >
  >;
  /**
   * Preferred Ignite Element projection source. This source exposes live
   * snapshots/events/transport status without requiring command capability.
   */
  readModel(
    options: ActorWebSourceOptions
  ): ClosableActorWebReadModelSource<
    ActorWebBehaviorContext<NonNullable<TBehavior>>,
    ActorWebBehaviorEvent<NonNullable<TBehavior>>
  >;
  readModelHandle(
    options: ActorWebSourceOptions
  ): RuntimeGatewaySourceHandle<
    ClosableActorWebReadModelSource<
      ActorWebBehaviorContext<NonNullable<TBehavior>>,
      ActorWebBehaviorEvent<NonNullable<TBehavior>>
    >,
    never
  >;
  /**
   * Explicit command/control source for hosts that intentionally send or ask.
   * Pair with readModel(...) instead of making every projection command-capable.
   */
  commandSource(
    options: ActorWebSourceOptions
  ): ClosableActorWebSource<
    ActorWebBehaviorContext<NonNullable<TBehavior>>,
    ActorWebBehaviorMessage<NonNullable<TBehavior>>,
    ActorWebBehaviorEvent<NonNullable<TBehavior>>
  >;
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

export type ActorWebTopologySourceFactoryInput = ActorWebSourceOptions;

export type ActorWebTopologySourceFactory<TActor extends ActorWebActorDescriptor> = {
  bivarianceHack(
    options: ActorWebTopologySourceFactoryInput
  ): RuntimeGatewaySourceHandle<
    ClosableActorWebReadModelSource<ActorWebActorContext<TActor>, ActorWebActorEvent<TActor>>,
    ClosableActorWebSource<
      ActorWebActorContext<TActor>,
      ActorWebActorMessage<TActor>,
      ActorWebActorEvent<TActor>
    >
  >;
}['bivarianceHack'];

export type ActorWebToolCatalogInput =
  | readonly ActorWebToolDefinition[]
  | Record<string, ActorWebToolDefinition>;

/**
 * Declares that a publisher actor's emitted events should be delivered to one or
 * more subscriber actors. Wired by the runtime on start and torn down on stop,
 * so the wiring is durable across restarts (unlike imperative system.subscribe).
 * `from`/`to` reference actor keys in the topology; `events` filters by event
 * type (omit/empty = all events from `from`).
 */
export interface ActorWebSubscriptionDefinition {
  readonly from: string;
  readonly to: string | readonly string[];
  readonly events?: readonly string[];
}

export type ActorWebTopologyInput = {
  readonly contractVersion?: string;
  readonly tools?: ActorWebToolCatalogInput;
  readonly nodes: Record<string, ActorWebNodeDefinition>;
  readonly actors: Record<
    string,
    ActorWebActorDefinition<ActorWebActorId> | ActorWebParameterizedActorDefinition<unknown>
  >;
  readonly supervisors?: Record<string, ActorWebSupervisorDefinition>;
  readonly subscriptions?: readonly ActorWebSubscriptionDefinition[];
};

type ActorWebToolCatalogFromArray<TTools extends readonly ActorWebToolDefinition[]> = {
  readonly [TTool in TTools[number] as TTool['name']]: TTool;
};

type ActorWebToolNameFromReference<TTool extends ActorWebToolReference> = TTool extends string
  ? TTool
  : TTool extends ActorWebToolDefinition<infer TName>
    ? TName
    : never;

type ActorWebToolNamesFromReferences<TTools extends readonly ActorWebToolReference[] | undefined> =
  TTools extends readonly ActorWebToolReference[]
    ? ActorWebToolNameFromReference<TTools[number]>
    : never;

export type ActorWebAllowedToolRegistry<
  TRegistry extends ActorToolRegistry,
  TTools extends readonly ActorWebToolReference[] | undefined,
> = Pick<TRegistry, Extract<ActorWebToolNamesFromReferences<TTools>, keyof TRegistry>>;

export type ActorWebTypedDefineActor<TTools extends ActorToolRegistry> = <
  TMsg extends ActorMessage = ActorMessage,
  TEmitted = unknown,
>() => UnifiedActorBuilder<TMsg, TEmitted, unknown, TTools>;

type ActorWebToolScopedActorDefinition<
  TRegistry extends ActorToolRegistry,
  TTools extends readonly ActorWebToolReference[],
  TId extends string = string,
  TNode extends string = string,
  TBehavior = unknown,
> = Omit<ActorWebActorDefinition<TId, TNode, TBehavior>, 'behavior' | 'tools'> & {
  readonly tools: TTools;
  readonly behavior: (
    defineActor: ActorWebTypedDefineActor<ActorWebAllowedToolRegistry<TRegistry, TTools>>
  ) => TBehavior;
};

type ActorWebToolScopedParameterizedActorDefinition<
  TRegistry extends ActorToolRegistry,
  TTools extends readonly ActorWebToolReference[],
  TParams,
  TNode extends string = string,
  TBehavior = unknown,
> = Omit<ActorWebParameterizedActorDefinition<TParams, TNode, TBehavior>, 'behavior' | 'tools'> & {
  readonly tools: TTools;
  readonly behavior: (
    params: TParams,
    defineActor: ActorWebTypedDefineActor<ActorWebAllowedToolRegistry<TRegistry, TTools>>
  ) => TBehavior;
};

type ActorWebToolScopedActor<
  TTools extends readonly ActorWebToolReference[],
  TId extends string,
  TNode extends string,
  TBehavior,
> = Omit<ActorWebActorDefinition<TId, TNode, TBehavior>, 'behavior' | 'tools'> & {
  readonly tools: TTools;
  readonly behavior: TBehavior;
};

type ActorWebToolScopedParameterizedActor<
  TTools extends readonly ActorWebToolReference[],
  TParams,
  TNode extends string,
  TBehavior,
> = Omit<ActorWebParameterizedActorDefinition<TParams, TNode, TBehavior>, 'behavior' | 'tools'> & {
  readonly tools: TTools;
  readonly behavior: (params: TParams) => TBehavior;
};

type ActorWebToolScopedActorHelper<TRegistry extends ActorToolRegistry> = {
  <
    const TTools extends readonly ActorWebToolReference[],
    const TId extends string,
    const TNode extends string,
    TBehavior,
  >(
    definition: ActorWebToolScopedActorDefinition<TRegistry, TTools, TId, TNode, TBehavior>
  ): ActorWebToolScopedActor<TTools, TId, TNode, TBehavior>;
  <
    const TTools extends readonly ActorWebToolReference[],
    TParams,
    const TNode extends string,
    TBehavior,
  >(
    definition: ActorWebToolScopedParameterizedActorDefinition<
      TRegistry,
      TTools,
      TParams,
      TNode,
      TBehavior
    >
  ): ActorWebToolScopedParameterizedActor<TTools, TParams, TNode, TBehavior>;
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
  readonly subscriptions: readonly ActorWebSubscriptionDefinition[];
  source<TKey extends keyof TInput['actors'] & string>(
    key: TKey
  ): ActorWebTopologySourceFactory<
    ActorWebActorDescriptor<
      TInput['actors'][TKey]['id'],
      TInput['actors'][TKey]['node'],
      TInput['actors'][TKey] extends { readonly behavior?: infer TBehavior } ? TBehavior : unknown
    >
  >;
};

export function node<TAddress extends string>(address: TAddress): ActorWebNodeDefinition<TAddress> {
  return { address };
}

function actorDefinition<TDefinition extends ActorWebActorDefinition<string>>(
  definition: TDefinition
): TDefinition;
function actorDefinition<TParams, TNode extends string, TBehavior>(
  definition: ActorWebParameterizedActorDefinition<TParams, TNode, TBehavior>
): ActorWebParameterizedActorDefinition<TParams, TNode, TBehavior>;
function actorDefinition(
  definition:
    | ActorWebActorDefinition<ActorWebActorId>
    | ActorWebParameterizedActorDefinition<unknown>
): ActorWebActorDefinition<ActorWebActorId> | ActorWebParameterizedActorDefinition<unknown> {
  return definition;
}

function createToolScopedActor<TRegistry extends ActorToolRegistry>() {
  type RuntimeDefineActor = ActorWebTypedDefineActor<ActorToolRegistry>;
  type RuntimeDefinition = Readonly<
    Record<string, unknown> & {
      id: string | ((params: unknown) => string);
      behavior:
        | ((defineActor: RuntimeDefineActor) => unknown)
        | ((params: unknown, defineActor: RuntimeDefineActor) => unknown);
    }
  >;
  const scopedActor = (definition: RuntimeDefinition) => {
    const defineActor = defineTopologyActorBehavior as RuntimeDefineActor;

    if (typeof definition.id === 'function') {
      const parameterizedBehavior = definition.behavior as (
        params: unknown,
        defineActor: RuntimeDefineActor
      ) => unknown;

      return actorDefinition({
        ...definition,
        behavior: (params: unknown) => parameterizedBehavior(params, defineActor),
      } as ActorWebParameterizedActorDefinition<unknown, string, unknown>);
    }

    const behavior = definition.behavior as (defineActor: RuntimeDefineActor) => unknown;

    return actorDefinition({
      ...definition,
      behavior: behavior(defineActor),
    } as ActorWebActorDefinition<string, string, unknown>);
  };

  return scopedActor as ActorWebToolScopedActorHelper<TRegistry>;
}

type ActorHelper = {
  <TDefinition extends ActorWebActorDefinition<string>>(definition: TDefinition): TDefinition;
  <TParams, TNode extends string, TBehavior>(
    definition: ActorWebParameterizedActorDefinition<TParams, TNode, TBehavior>
  ): ActorWebParameterizedActorDefinition<TParams, TNode, TBehavior>;
  withTools<TRegistry extends ActorToolRegistry>(): ActorWebToolScopedActorHelper<TRegistry>;
};

export const actor: ActorHelper = Object.assign(actorDefinition, {
  withTools: createToolScopedActor,
});

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

      const actorId = definition.id;
      const resolveId = (params?: unknown): string => {
        if (typeof actorId === 'function') {
          if (params === undefined) {
            throw new Error(`Actor "${key}" requires instance params to resolve its id.`);
          }

          return actorId(params);
        }

        return actorId;
      };
      const descriptorId = typeof actorId === 'function' ? key : actorId;
      const resolveAddress = (params?: unknown): ActorWebActorAddress => {
        const id = resolveId(params);
        return {
          id,
          type: 'actor',
          node: nodeDefinition.address,
          path: `actor://${nodeDefinition.address}/actor/${id}`,
        };
      };
      const address: ActorWebActorAddress = {
        id: descriptorId,
        type: 'actor',
        node: nodeDefinition.address,
        path: `actor://${nodeDefinition.address}/actor/${descriptorId}`,
      };
      const { gateway: gatewayDefinition, ...actorDefinition } = definition;
      const gateway =
        gatewayDefinition === true
          ? { scope: { kind: key } }
          : gatewayDefinition
            ? { scope: gatewayDefinition.scope ?? { kind: key } }
            : undefined;

      return [
        key,
        {
          ...actorDefinition,
          key,
          nodeAddress: nodeDefinition.address,
          address,
          resolveId,
          resolveAddress,
          ...(gateway ? { gateway } : {}),
          source(options: ActorWebSourceOptions): ClosableActorWebSource {
            return createActorWebSource({
              actor: this,
              ...options,
            });
          },
          sourceHandle(options: ActorWebSourceOptions) {
            const readModel = createActorWebReadModelSource({
              actor: this,
              ...options,
            });
            const commandSource = createActorWebCommandSource({
              actor: this,
              ...options,
            });

            return createActorWebSourceHandle(readModel, commandSource);
          },
          readModel(options: ActorWebSourceOptions): ClosableActorWebReadModelSource {
            return createActorWebReadModelSource({
              actor: this,
              ...options,
            });
          },
          readModelHandle(options: ActorWebSourceOptions) {
            return createRuntimeGatewaySourceHandle(
              createActorWebReadModelSource({
                actor: this,
                ...options,
              })
            );
          },
          commandSource(options: ActorWebSourceOptions): ClosableActorWebSource {
            return createActorWebCommandSource({
              actor: this,
              ...options,
            });
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
      for (const child of definition.children) {
        if (!input.actors[child]) {
          throw new Error(`Supervisor "${key}" references unknown child actor "${child}".`);
        }
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
    subscriptions: input.subscriptions ?? [],
    source(key) {
      const actorDescriptor = actors[key];
      if (!actorDescriptor) {
        throw new Error(`Actor-Web topology does not define actor "${String(key)}".`);
      }

      return ((options: ActorWebTopologySourceFactoryInput) => {
        return actorDescriptor.sourceHandle(options);
      }) as ActorWebTopology<TInput>['source'] extends (actorKey: typeof key) => infer TFactory
        ? TFactory
        : never;
    },
  };
}
