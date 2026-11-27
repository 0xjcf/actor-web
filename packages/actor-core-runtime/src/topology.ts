import type {
  ActorAddress,
  ActorBehavior,
  ActorMessage,
  ActorSupervisionPolicy,
  ActorSupervisionStrategy,
} from './actor-system.js';
import type { ActorToolRegistry } from './actor-tools.js';
import {
  type ClosableReadModelSource,
  type ClosableSource,
  createGatewayCommandSource,
  createGatewayReadModelSource,
  createGatewaySource,
  type GatewaySourceOptions,
} from './actor-web-source.js';
import type { RuntimeGatewayScopeDescriptor } from './runtime-gateway-shared.js';
import {
  defineBehavior as defineTopologyActorBehavior,
  type UnifiedActorBuilder,
} from './unified-actor-builder.js';
import { Address } from './utils/factories.js';

export type {
  ActorAddress,
  ActorSupervisionPolicy,
  ActorSupervisionStrategy,
} from './actor-system.js';

type ClosableSourceLike = {
  close(): void;
};

export interface SourceSession<
  TReadModel extends ClosableSourceLike,
  TCommands extends ClosableSourceLike,
> {
  readonly readModel: TReadModel;
  readonly commands: TCommands;
  close(): void;
}

export function createActorWebSourceSession<
  TReadModel extends ClosableSourceLike,
  TCommands extends ClosableSourceLike,
>(readModel: TReadModel, commands: TCommands): SourceSession<TReadModel, TCommands> {
  let closed = false;

  return {
    readModel,
    commands,
    close() {
      if (closed) {
        return;
      }

      closed = true;
      let closeError: unknown;

      try {
        readModel.close();
      } catch (error) {
        closeError = error;
      }

      if (commands !== (readModel as unknown)) {
        try {
          commands.close();
        } catch (error) {
          closeError ??= error;
        }
      }

      if (closeError) {
        throw closeError;
      }
    },
  };
}

export interface ToolDefinition<TName extends string = string> {
  readonly name: TName;
  readonly description?: string;
}

export type ToolReference<TName extends string = string> = TName | ToolDefinition<TName>;

export interface NodeDefinition<TAddress extends string = string> {
  readonly address: TAddress;
}

export type ActorIdResolver<TParams = unknown> = {
  bivarianceHack(params: TParams): string;
}['bivarianceHack'];

export type ActorId<TParams = unknown> = string | ActorIdResolver<TParams>;

export type ActorInstanceParams<TActor> = TActor extends {
  readonly id: ActorIdResolver<infer TParams>;
}
  ? TParams
  : never;

export interface ActorDefinition<
  TId extends ActorId = string,
  TNode extends string = string,
  TBehavior = unknown,
> {
  readonly id: TId;
  readonly node: TNode;
  readonly behavior?: TBehavior;
  readonly supervision?: ActorSupervisionPolicy;
  readonly tools?: readonly ToolReference[];
  readonly gateway?:
    | boolean
    | {
        readonly scope?: RuntimeGatewayScopeDescriptor;
      };
}

export interface ParameterizedActorDefinition<
  TParams,
  TNode extends string = string,
  TBehavior = unknown,
> extends Omit<
    ActorDefinition<ActorIdResolver<TParams>, TNode, (params: TParams) => TBehavior>,
    'behavior'
  > {
  readonly behavior?: (params: TParams) => TBehavior;
}

export type ActorContextOf<TActor> = TActor extends {
  readonly behavior?: infer TBehavior;
}
  ? BehaviorContext<NonNullable<TBehavior>>
  : unknown;

export type ActorMessageOf<TActor> = TActor extends {
  readonly behavior?: infer TBehavior;
}
  ? BehaviorMessage<NonNullable<TBehavior>>
  : ActorMessage;

export type ActorEventOf<TActor> = TActor extends {
  readonly behavior?: infer TBehavior;
}
  ? BehaviorEvent<NonNullable<TBehavior>>
  : ActorMessage;

type BehaviorContext<TBehavior> = TBehavior extends (...args: infer _TArgs) => infer TReturn
  ? BehaviorContext<TReturn>
  : TBehavior extends { readonly __contextType: infer TContext }
    ? TContext
    : unknown;

type BehaviorMessage<TBehavior> = TBehavior extends (...args: infer _TArgs) => infer TReturn
  ? BehaviorMessage<TReturn>
  : TBehavior extends { readonly __messageType: infer TMessage }
    ? TMessage extends ActorMessage
      ? TMessage
      : ActorMessage
    : TBehavior extends ActorBehavior<infer TMessage, unknown>
      ? TMessage extends ActorMessage
        ? TMessage
        : ActorMessage
      : ActorMessage;

type BehaviorEvent<TBehavior> = TBehavior extends (...args: infer _TArgs) => infer TReturn
  ? BehaviorEvent<TReturn>
  : TBehavior extends { readonly __emittedType: infer TEmitted }
    ? TEmitted extends ActorMessage
      ? TEmitted
      : ActorMessage
    : TBehavior extends ActorBehavior<infer _TMessage, infer TEvent>
      ? TEvent extends ActorMessage
        ? TEvent
        : ActorMessage
      : ActorMessage;

export interface ActorDescriptor<
  TId extends ActorId = ActorId,
  TNode extends string = string,
  TBehavior = unknown,
> extends ActorDefinition<TId, TNode, TBehavior> {
  readonly key: string;
  readonly nodeAddress: string;
  readonly address: ActorAddress;
  readonly gateway?: {
    readonly scope: RuntimeGatewayScopeDescriptor;
  };
  resolveId(params?: ActorInstanceParams<ActorDescriptor<TId, TNode, TBehavior>>): string;
  resolveAddress(
    params?: ActorInstanceParams<ActorDescriptor<TId, TNode, TBehavior>>
  ): ActorAddress;
  source(
    options: GatewaySourceOptions
  ): ClosableSource<
    BehaviorContext<NonNullable<TBehavior>>,
    BehaviorMessage<NonNullable<TBehavior>>,
    BehaviorEvent<NonNullable<TBehavior>>
  >;
  session(
    options: GatewaySourceOptions
  ): SourceSession<
    ClosableReadModelSource<
      BehaviorContext<NonNullable<TBehavior>>,
      BehaviorEvent<NonNullable<TBehavior>>
    >,
    ClosableSource<
      BehaviorContext<NonNullable<TBehavior>>,
      BehaviorMessage<NonNullable<TBehavior>>,
      BehaviorEvent<NonNullable<TBehavior>>
    >
  >;
  /**
   * Preferred projection source. This source exposes live
   * snapshots/events/transport status without requiring command capability.
   */
  readModel(
    options: GatewaySourceOptions
  ): ClosableReadModelSource<
    BehaviorContext<NonNullable<TBehavior>>,
    BehaviorEvent<NonNullable<TBehavior>>
  >;
  /**
   * Explicit command/control source for hosts that intentionally send or ask.
   * Pair with readModel(...) instead of making every projection command-capable.
   */
  commands(
    options: GatewaySourceOptions
  ): ClosableSource<
    BehaviorContext<NonNullable<TBehavior>>,
    BehaviorMessage<NonNullable<TBehavior>>,
    BehaviorEvent<NonNullable<TBehavior>>
  >;
}

export interface SupervisorDefinition<TNode extends string = string> {
  readonly node: TNode;
  readonly strategy?: 'one-for-one' | 'one-for-all' | 'rest-for-one' | 'escalate';
  readonly children: readonly string[];
}

export interface SupervisorDescriptor<TNode extends string = string>
  extends SupervisorDefinition<TNode> {
  readonly key: string;
  readonly nodeAddress: string;
  /** Defaulted to 'one-for-one' by defineTopology when omitted. */
  readonly strategy: 'one-for-one' | 'one-for-all' | 'rest-for-one' | 'escalate';
}

export type TopologySourceFactoryInput = GatewaySourceOptions;

export type TopologyActorSource<TActor extends ActorDescriptor> = ClosableSource<
  ActorContextOf<TActor>,
  ActorMessageOf<TActor>,
  ActorEventOf<TActor>
>;

export type TopologyActorReadModel<TActor extends ActorDescriptor> = ClosableReadModelSource<
  ActorContextOf<TActor>,
  ActorEventOf<TActor>
>;

export type TopologyActorSession<TActor extends ActorDescriptor> = SourceSession<
  TopologyActorReadModel<TActor>,
  TopologyActorSource<TActor>
>;

export type ToolCatalogInput = readonly ToolDefinition[] | Record<string, ToolDefinition>;

/**
 * Declares that a publisher actor's emitted events should be delivered to one or
 * more subscriber actors. Wired by the runtime on start and torn down on stop,
 * so the wiring is durable across restarts (unlike imperative system.subscribe).
 * `from`/`to` reference actor keys in the topology; `events` filters by event
 * type (omit/empty = all events from `from`).
 */
export interface SubscriptionDefinition {
  readonly from: string;
  readonly to: string | readonly string[];
  readonly events?: readonly string[];
}

export type TopologyInput = {
  readonly contractVersion?: string;
  readonly tools?: ToolCatalogInput;
  readonly nodes: Record<string, NodeDefinition>;
  readonly actors: Record<string, ActorDefinition<ActorId> | ParameterizedActorDefinition<unknown>>;
  readonly supervisors?: Record<string, SupervisorDefinition>;
  readonly subscriptions?: readonly SubscriptionDefinition[];
};

type ToolCatalogFromArray<TTools extends readonly ToolDefinition[]> = {
  readonly [TTool in TTools[number] as TTool['name']]: TTool;
};

type ToolNameFromReference<TTool extends ToolReference> = TTool extends string
  ? TTool
  : TTool extends ToolDefinition<infer TName>
    ? TName
    : never;

type ToolNamesFromReferences<TTools extends readonly ToolReference[] | undefined> =
  TTools extends readonly ToolReference[] ? ToolNameFromReference<TTools[number]> : never;

export type AllowedToolRegistry<
  TRegistry extends ActorToolRegistry,
  TTools extends readonly ToolReference[] | undefined,
> = Pick<TRegistry, Extract<ToolNamesFromReferences<TTools>, keyof TRegistry>>;

export type TypedDefineActor<TTools extends ActorToolRegistry> = <
  TMsg extends ActorMessage = ActorMessage,
  TEmitted = unknown,
>() => UnifiedActorBuilder<TMsg, TEmitted, unknown, TTools>;

type ToolScopedActorDefinition<
  TRegistry extends ActorToolRegistry,
  TTools extends readonly ToolReference[],
  TId extends string = string,
  TNode extends string = string,
  TBehavior = unknown,
> = Omit<ActorDefinition<TId, TNode, TBehavior>, 'behavior' | 'tools'> & {
  readonly tools: TTools;
  readonly behavior: (
    defineBehavior: TypedDefineActor<AllowedToolRegistry<TRegistry, TTools>>
  ) => TBehavior;
};

type ToolScopedParameterizedActorDefinition<
  TRegistry extends ActorToolRegistry,
  TTools extends readonly ToolReference[],
  TParams,
  TNode extends string = string,
  TBehavior = unknown,
> = Omit<ParameterizedActorDefinition<TParams, TNode, TBehavior>, 'behavior' | 'tools'> & {
  readonly tools: TTools;
  readonly behavior: (
    params: TParams,
    defineBehavior: TypedDefineActor<AllowedToolRegistry<TRegistry, TTools>>
  ) => TBehavior;
};

type ToolScopedActor<
  TTools extends readonly ToolReference[],
  TId extends string,
  TNode extends string,
  TBehavior,
> = Omit<ActorDefinition<TId, TNode, TBehavior>, 'behavior' | 'tools'> & {
  readonly tools: TTools;
  readonly behavior: TBehavior;
};

type ToolScopedParameterizedActor<
  TTools extends readonly ToolReference[],
  TParams,
  TNode extends string,
  TBehavior,
> = Omit<ParameterizedActorDefinition<TParams, TNode, TBehavior>, 'behavior' | 'tools'> & {
  readonly tools: TTools;
  readonly behavior: (params: TParams) => TBehavior;
};

type ToolScopedActorHelper<TRegistry extends ActorToolRegistry> = {
  <
    const TTools extends readonly ToolReference[],
    const TId extends string,
    const TNode extends string,
    TBehavior,
  >(
    definition: ToolScopedActorDefinition<TRegistry, TTools, TId, TNode, TBehavior>
  ): ToolScopedActor<TTools, TId, TNode, TBehavior>;
  <const TTools extends readonly ToolReference[], TParams, const TNode extends string, TBehavior>(
    definition: ToolScopedParameterizedActorDefinition<TRegistry, TTools, TParams, TNode, TBehavior>
  ): ToolScopedParameterizedActor<TTools, TParams, TNode, TBehavior>;
};

type TopologyTools<TInput extends TopologyInput> = TInput extends {
  readonly tools: infer TTools;
}
  ? TTools extends readonly ToolDefinition[]
    ? ToolCatalogFromArray<TTools>
    : TTools extends Record<string, ToolDefinition>
      ? TTools
      : Record<string, never>
  : Record<string, never>;

type TopologyActor<
  TInput extends TopologyInput,
  TKey extends keyof TInput['actors'] & string,
> = ActorDescriptor<
  TInput['actors'][TKey]['id'],
  TInput['actors'][TKey]['node'],
  TInput['actors'][TKey] extends { readonly behavior?: infer TBehavior } ? TBehavior : unknown
>;

export type Topology<TInput extends TopologyInput> = {
  readonly contractVersion?: string;
  readonly tools: TopologyTools<TInput>;
  readonly nodes: TInput['nodes'];
  readonly actors: {
    readonly [K in keyof TInput['actors']]: ActorDescriptor<
      TInput['actors'][K]['id'],
      TInput['actors'][K]['node'],
      TInput['actors'][K] extends { readonly behavior?: infer TBehavior } ? TBehavior : unknown
    >;
  };
  readonly supervisors: {
    readonly [K in keyof NonNullable<TInput['supervisors']>]: SupervisorDescriptor;
  };
  readonly subscriptions: readonly SubscriptionDefinition[];
  source<TKey extends keyof TInput['actors'] & string>(
    key: TKey,
    options: TopologySourceFactoryInput
  ): TopologyActorSource<TopologyActor<TInput, TKey>>;
  readModel<TKey extends keyof TInput['actors'] & string>(
    key: TKey,
    options: TopologySourceFactoryInput
  ): TopologyActorReadModel<TopologyActor<TInput, TKey>>;
  commands<TKey extends keyof TInput['actors'] & string>(
    key: TKey,
    options: TopologySourceFactoryInput
  ): TopologyActorSource<TopologyActor<TInput, TKey>>;
  session<TKey extends keyof TInput['actors'] & string>(
    key: TKey,
    options: TopologySourceFactoryInput
  ): TopologyActorSession<TopologyActor<TInput, TKey>>;
};

export function node<TAddress extends string>(address: TAddress): NodeDefinition<TAddress> {
  return { address };
}

function actorDefinition<TDefinition extends ActorDefinition<string>>(
  definition: TDefinition
): TDefinition;
function actorDefinition<TParams, TNode extends string, TBehavior>(
  definition: ParameterizedActorDefinition<TParams, TNode, TBehavior>
): ParameterizedActorDefinition<TParams, TNode, TBehavior>;
function actorDefinition(
  definition: ActorDefinition<ActorId> | ParameterizedActorDefinition<unknown>
): ActorDefinition<ActorId> | ParameterizedActorDefinition<unknown> {
  return definition;
}

function createToolScopedActor<TRegistry extends ActorToolRegistry>() {
  type RuntimeDefineActor = TypedDefineActor<ActorToolRegistry>;
  type RuntimeDefinition = Readonly<
    Record<string, unknown> & {
      id: string | ((params: unknown) => string);
      behavior:
        | ((defineBehavior: RuntimeDefineActor) => unknown)
        | ((params: unknown, defineBehavior: RuntimeDefineActor) => unknown);
    }
  >;
  const scopedActor = (definition: RuntimeDefinition) => {
    const defineBehavior = defineTopologyActorBehavior as RuntimeDefineActor;

    if (typeof definition.id === 'function') {
      const parameterizedBehavior = definition.behavior as (
        params: unknown,
        defineBehavior: RuntimeDefineActor
      ) => unknown;

      return actorDefinition({
        ...definition,
        behavior: (params: unknown) => parameterizedBehavior(params, defineBehavior),
      } as ParameterizedActorDefinition<unknown, string, unknown>);
    }

    const behavior = definition.behavior as (defineBehavior: RuntimeDefineActor) => unknown;

    return actorDefinition({
      ...definition,
      behavior: behavior(defineBehavior),
    } as ActorDefinition<string, string, unknown>);
  };

  return scopedActor as ToolScopedActorHelper<TRegistry>;
}

type ActorHelper = {
  <TDefinition extends ActorDefinition<string>>(definition: TDefinition): TDefinition;
  <TParams, TNode extends string, TBehavior>(
    definition: ParameterizedActorDefinition<TParams, TNode, TBehavior>
  ): ParameterizedActorDefinition<TParams, TNode, TBehavior>;
  withTools<TRegistry extends ActorToolRegistry>(): ToolScopedActorHelper<TRegistry>;
};

export const actor: ActorHelper = Object.assign(actorDefinition, {
  withTools: createToolScopedActor,
});

export function supervisor<TDefinition extends SupervisorDefinition>(
  definition: TDefinition
): TDefinition {
  return definition;
}

export function tool<TName extends string>(
  name: TName,
  options: Omit<ToolDefinition<TName>, 'name'> = {}
): ToolDefinition<TName> {
  return {
    name,
    ...options,
  };
}

function normalizeActorWebToolCatalog(
  tools: ToolCatalogInput | undefined
): Record<string, ToolDefinition> {
  if (!tools) {
    return {};
  }

  if (Array.isArray(tools)) {
    return Object.fromEntries(
      tools.map((toolDefinition: ToolDefinition) => [toolDefinition.name, toolDefinition])
    );
  }

  return tools as Record<string, ToolDefinition>;
}

/** The `type` literal union a publisher actor can emit (falls back to string). */
type EmittedEventType<TActorDefinition> = ActorEventOf<TActorDefinition> extends {
  readonly type: infer TType extends string;
}
  ? TType
  : string;

/**
 * A subscription entry whose `from`/`to` are actor keys and whose `events` are
 * constrained to the `from` actor's emitted-event types. Expressed as a union of
 * per-publisher shapes so `events` is checked against the chosen `from`.
 */
type TypedSubscription<TActors> = {
  [K in keyof TActors & string]: {
    readonly from: K;
    readonly to: (keyof TActors & string) | readonly (keyof TActors & string)[];
    readonly events?: readonly EmittedEventType<TActors[K]>[];
  };
}[keyof TActors & string];

export function defineTopology<TInput extends TopologyInput>(
  input: TInput & {
    readonly subscriptions?: readonly TypedSubscription<TInput['actors']>[];
  }
): Topology<TInput> {
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
      const resolveAddress = (params?: unknown): ActorAddress => {
        const id = resolveId(params);
        return Address.from({ id, node: nodeDefinition.address });
      };
      const address: ActorAddress = Address.from({
        id: descriptorId,
        node: nodeDefinition.address,
      });
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
          source(options: GatewaySourceOptions): ClosableSource {
            return createGatewaySource({
              actor: this,
              ...options,
            });
          },
          session(options: GatewaySourceOptions) {
            const readModel = createGatewayReadModelSource({
              actor: this,
              ...options,
            });
            let commands: ClosableSource;
            try {
              commands = createGatewayCommandSource({
                actor: this,
                ...options,
              });
            } catch (error) {
              readModel.close();
              throw error;
            }

            return createActorWebSourceSession(readModel, commands);
          },
          readModel(options: GatewaySourceOptions): ClosableReadModelSource {
            return createGatewayReadModelSource({
              actor: this,
              ...options,
            });
          },
          commands(options: GatewaySourceOptions): ClosableSource {
            return createGatewayCommandSource({
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
        const childDefinition = input.actors[child];
        if (!childDefinition) {
          throw new Error(`Supervisor "${key}" references unknown child actor "${child}".`);
        }
        // Group restarts are node-local: a cross-node child would silently
        // never be supervised, so reject it at definition time.
        if (childDefinition.node !== definition.node) {
          throw new Error(
            `Supervisor "${key}" on node "${definition.node}" references child actor "${child}" on node "${String(childDefinition.node)}". Supervisor children must run on the supervisor's node.`
          );
        }
      }

      return [
        key,
        {
          ...definition,
          key,
          nodeAddress: nodeDefinition.address,
          strategy: definition.strategy ?? 'one-for-one',
        },
      ];
    })
  );
  const requireActorDescriptor = <TKey extends keyof TInput['actors'] & string>(
    key: TKey
  ): TopologyActor<TInput, TKey> => {
    const actorDescriptor = actors[key] as TopologyActor<TInput, TKey> | undefined;
    if (!actorDescriptor) {
      throw new Error(`Actor-Web topology does not define actor "${String(key)}".`);
    }

    return actorDescriptor;
  };

  return {
    contractVersion: input.contractVersion,
    tools: toolCatalog as TopologyTools<TInput>,
    nodes: input.nodes,
    actors: actors as Topology<TInput>['actors'],
    supervisors: supervisors as Topology<TInput>['supervisors'],
    subscriptions: input.subscriptions ?? [],
    source(key, options) {
      return requireActorDescriptor(key).source(options);
    },
    readModel(key, options) {
      return requireActorDescriptor(key).readModel(options);
    },
    commands(key, options) {
      return requireActorDescriptor(key).commands(options);
    },
    session(key, options) {
      return requireActorDescriptor(key).session(options);
    },
  };
}

export type {
  /** @deprecated Use ActorAddress instead. */
  ActorAddress as ActorWebActorAddress,
  /** @deprecated Use ActorContextOf instead. */
  ActorContextOf as ActorWebActorContext,
  /** @deprecated Use ActorDefinition instead. */
  ActorDefinition as ActorWebActorDefinition,
  /** @deprecated Use ActorDescriptor instead. */
  ActorDescriptor as ActorWebActorDescriptor,
  /** @deprecated Use ActorEventOf instead. */
  ActorEventOf as ActorWebActorEvent,
  /** @deprecated Use ActorMessageOf instead. */
  ActorMessageOf as ActorWebActorMessage,
  /** @deprecated Use NodeDefinition instead. */
  NodeDefinition as ActorWebNodeDefinition,
  /** @deprecated Use ActorSupervisionPolicy instead. */
  ActorSupervisionPolicy as ActorWebSupervisionPolicy,
  /** @deprecated Use ActorSupervisionStrategy instead. */
  ActorSupervisionStrategy as ActorWebSupervisionStrategy,
  /** @deprecated Use SupervisorDefinition instead. */
  SupervisorDefinition as ActorWebSupervisorDefinition,
  /** @deprecated Use SupervisorDescriptor instead. */
  SupervisorDescriptor as ActorWebSupervisorDescriptor,
  /** @deprecated Use Topology instead. */
  Topology as ActorWebTopology,
  /** @deprecated Use TopologyInput instead. */
  TopologyInput as ActorWebTopologyInput,
  /** @deprecated Use AllowedToolRegistry instead. */
  AllowedToolRegistry as ActorWebAllowedToolRegistry,
  /** @deprecated Use ToolCatalogInput instead. */
  ToolCatalogInput as ActorWebToolCatalogInput,
  /** @deprecated Use ToolDefinition instead. */
  ToolDefinition as ActorWebToolDefinition,
  /** @deprecated Use ToolReference instead. */
  ToolReference as ActorWebToolReference,
  /** @deprecated Use TypedDefineActor instead. */
  TypedDefineActor as ActorWebTypedDefineActor,
};
export {
  /** @deprecated Use defineTopology instead. */
  defineTopology as defineActorWebTopology,
};
