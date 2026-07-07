import type {
  ActorAddress,
  ActorBehavior,
  ActorMessage,
  ActorSupervisionPolicy,
  ActorSupervisionStrategy,
} from './actor-system.js';
import type { ActorToolRegistry } from './actor-tools.js';
import {
  type ActorWebSourceOptions,
  type ClosableActorWebReadModelSource,
  type ClosableActorWebSource,
  createActorWebCommandSource,
  createActorWebReadModelSource,
  createActorWebSource,
} from './actor-web-source.js';
import type { RuntimeGatewayScopeDescriptor } from './runtime-gateway-shared.js';
import {
  defineBehavior as defineTopologyActorBehavior,
  type UnifiedActorBuilder,
} from './unified-actor-builder.js';
import { Address } from './utils/factories.js';

/**
 * Topology aliases of the runtime supervision types (one definition, shared
 * by the topology DSL and SpawnOptions). The node runtime threads the policy
 * from the actor descriptor into `system.spawn(behavior, { supervision })`.
 */
export type ActorWebSupervisionStrategy = ActorSupervisionStrategy;
export type ActorWebSupervisionPolicy = ActorSupervisionPolicy;

// The topology DSL's public address type collapses onto the single branded model
// so the topology/examples surface can't build object literals that drift.
export type ActorWebActorAddress = ActorAddress;

type ClosableActorWebSourceLike = {
  close(): void;
};

export interface ActorWebSourceSession<
  TReadModel extends ClosableActorWebSourceLike,
  TCommands extends ClosableActorWebSourceLike,
> {
  readonly readModel: TReadModel;
  readonly commands: TCommands;
  close(): void;
}

export function createActorWebSourceSession<
  TReadModel extends ClosableActorWebSourceLike,
  TCommands extends ClosableActorWebSourceLike,
>(readModel: TReadModel, commands: TCommands): ActorWebSourceSession<TReadModel, TCommands> {
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
  : TBehavior extends { readonly __emittedType: infer TEmitted }
    ? TEmitted extends ActorMessage
      ? TEmitted
      : ActorMessage
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
  session(
    options: ActorWebSourceOptions
  ): ActorWebSourceSession<
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
   * Preferred projection source. This source exposes live
   * snapshots/events/transport status without requiring command capability.
   */
  readModel(
    options: ActorWebSourceOptions
  ): ClosableActorWebReadModelSource<
    ActorWebBehaviorContext<NonNullable<TBehavior>>,
    ActorWebBehaviorEvent<NonNullable<TBehavior>>
  >;
  /**
   * Explicit command/control source for hosts that intentionally send or ask.
   * Pair with readModel(...) instead of making every projection command-capable.
   */
  commands(
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
  /** Defaulted to 'one-for-one' by defineActorWebTopology when omitted. */
  readonly strategy: 'one-for-one' | 'one-for-all' | 'rest-for-one' | 'escalate';
}

export type ActorWebTopologySourceFactoryInput = ActorWebSourceOptions;

export type ActorWebTopologyActorSource<TActor extends ActorWebActorDescriptor> =
  ClosableActorWebSource<
    ActorWebActorContext<TActor>,
    ActorWebActorMessage<TActor>,
    ActorWebActorEvent<TActor>
  >;

export type ActorWebTopologyActorReadModel<TActor extends ActorWebActorDescriptor> =
  ClosableActorWebReadModelSource<ActorWebActorContext<TActor>, ActorWebActorEvent<TActor>>;

export type ActorWebTopologyActorSession<TActor extends ActorWebActorDescriptor> =
  ActorWebSourceSession<
    ActorWebTopologyActorReadModel<TActor>,
    ActorWebTopologyActorSource<TActor>
  >;

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
    defineBehavior: ActorWebTypedDefineActor<ActorWebAllowedToolRegistry<TRegistry, TTools>>
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
    defineBehavior: ActorWebTypedDefineActor<ActorWebAllowedToolRegistry<TRegistry, TTools>>
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

type ActorWebTopologyActor<
  TInput extends ActorWebTopologyInput,
  TKey extends keyof TInput['actors'] & string,
> = ActorWebActorDescriptor<
  TInput['actors'][TKey]['id'],
  TInput['actors'][TKey]['node'],
  TInput['actors'][TKey] extends { readonly behavior?: infer TBehavior } ? TBehavior : unknown
>;

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
    key: TKey,
    options: ActorWebTopologySourceFactoryInput
  ): ActorWebTopologyActorSource<ActorWebTopologyActor<TInput, TKey>>;
  readModel<TKey extends keyof TInput['actors'] & string>(
    key: TKey,
    options: ActorWebTopologySourceFactoryInput
  ): ActorWebTopologyActorReadModel<ActorWebTopologyActor<TInput, TKey>>;
  commands<TKey extends keyof TInput['actors'] & string>(
    key: TKey,
    options: ActorWebTopologySourceFactoryInput
  ): ActorWebTopologyActorSource<ActorWebTopologyActor<TInput, TKey>>;
  session<TKey extends keyof TInput['actors'] & string>(
    key: TKey,
    options: ActorWebTopologySourceFactoryInput
  ): ActorWebTopologyActorSession<ActorWebTopologyActor<TInput, TKey>>;
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
      } as ActorWebParameterizedActorDefinition<unknown, string, unknown>);
    }

    const behavior = definition.behavior as (defineBehavior: RuntimeDefineActor) => unknown;

    return actorDefinition({
      ...definition,
      behavior: behavior(defineBehavior),
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

/** The `type` literal union a publisher actor can emit (falls back to string). */
type ActorWebEmittedEventType<TActorDefinition> = ActorWebActorEvent<TActorDefinition> extends {
  readonly type: infer TType extends string;
}
  ? TType
  : string;

/**
 * A subscription entry whose `from`/`to` are actor keys and whose `events` are
 * constrained to the `from` actor's emitted-event types. Expressed as a union of
 * per-publisher shapes so `events` is checked against the chosen `from`.
 */
type ActorWebTypedSubscription<TActors> = {
  [K in keyof TActors & string]: {
    readonly from: K;
    readonly to: (keyof TActors & string) | readonly (keyof TActors & string)[];
    readonly events?: readonly ActorWebEmittedEventType<TActors[K]>[];
  };
}[keyof TActors & string];

export function defineActorWebTopology<TInput extends ActorWebTopologyInput>(
  input: TInput & {
    readonly subscriptions?: readonly ActorWebTypedSubscription<TInput['actors']>[];
  }
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
        return Address.from({ id, node: nodeDefinition.address });
      };
      const address: ActorWebActorAddress = Address.from({
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
          source(options: ActorWebSourceOptions): ClosableActorWebSource {
            return createActorWebSource({
              actor: this,
              ...options,
            });
          },
          session(options: ActorWebSourceOptions) {
            const readModel = createActorWebReadModelSource({
              actor: this,
              ...options,
            });
            let commands: ClosableActorWebSource;
            try {
              commands = createActorWebCommandSource({
                actor: this,
                ...options,
              });
            } catch (error) {
              readModel.close();
              throw error;
            }

            return createActorWebSourceSession(readModel, commands);
          },
          readModel(options: ActorWebSourceOptions): ClosableActorWebReadModelSource {
            return createActorWebReadModelSource({
              actor: this,
              ...options,
            });
          },
          commands(options: ActorWebSourceOptions): ClosableActorWebSource {
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
  ): ActorWebTopologyActor<TInput, TKey> => {
    const actorDescriptor = actors[key] as ActorWebTopologyActor<TInput, TKey> | undefined;
    if (!actorDescriptor) {
      throw new Error(`Actor-Web topology does not define actor "${String(key)}".`);
    }

    return actorDescriptor;
  };

  return {
    contractVersion: input.contractVersion,
    tools: toolCatalog as ActorWebTopologyTools<TInput>,
    nodes: input.nodes,
    actors: actors as ActorWebTopology<TInput>['actors'],
    supervisors: supervisors as ActorWebTopology<TInput>['supervisors'],
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
