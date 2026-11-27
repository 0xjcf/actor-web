import type { ActorEventSubscriptionOptions, ActorRef } from './actor-ref.js';
import type { ActorMessage, MessageTransport } from './actor-system.js';
import type { ActorToolRegistry } from './actor-tools.js';
import type {
  GatewaySocket,
  GatewaySourceOptions,
  SourceGatewayOptions,
} from './actor-web-source.js';
import {
  type ClosableCommandSource,
  type ClosableReadModelSource,
  type ClosableSource,
  createGatewayCommandSource,
  createGatewayReadModelSource,
  createGatewaySource,
  hasActorWebSourceGatewayOptions,
  type SourceFactoryContext,
} from './actor-web-source.js';
import {
  createActorCommandSource,
  createActorReadModelSource,
} from './integration/actor-source.js';
import { type StartedNode, startNode } from './start-actor-web-node.js';
import {
  createInMemoryMessageTransportNetwork,
  type InMemoryMessageTransportNetwork,
} from './testing/in-memory-message-transport.js';
import type {
  ActorContextOf,
  ActorDescriptor,
  ActorEventOf,
  ActorMessageOf,
  SourceSession,
  Topology,
  TopologyInput,
} from './topology.js';
import { createActorWebSourceSession } from './topology.js';

export interface ClientOptions {
  readonly gateway: SourceGatewayOptions;
  readonly createSocket?: (url: string) => GatewaySocket;
  readonly clientVersion?: string;
}

export type ClientActorSource<TActor extends ActorDescriptor> = ClosableSource<
  ActorContextOf<TActor>,
  ActorMessageOf<TActor>,
  ActorEventOf<TActor>
> & {
  readModel(): ClosableReadModelSource<ActorContextOf<TActor>, ActorEventOf<TActor>>;
  commands(): ClosableSource<ActorContextOf<TActor>, ActorMessageOf<TActor>, ActorEventOf<TActor>>;
  session(): SourceSession<
    ClosableReadModelSource<ActorContextOf<TActor>, ActorEventOf<TActor>>,
    ClosableSource<ActorContextOf<TActor>, ActorMessageOf<TActor>, ActorEventOf<TActor>>
  >;
};

export type Client<TTopology extends Topology<TopologyInput>> = {
  readonly actors: {
    readonly [K in keyof TTopology['actors']]: ClientActorSource<TTopology['actors'][K]>;
  };
  close(): void;
};

/**
 * Projection-only client for UI and projection hosts. This is the default
 * browser/client surface when a shared topology is available.
 */
export type ReadModelClient<TTopology extends Topology<TopologyInput>> = {
  readonly actors: {
    readonly [K in keyof TTopology['actors']]: ClosableReadModelSource<
      ActorContextOf<TTopology['actors'][K]>,
      ActorEventOf<TTopology['actors'][K]>
    >;
  };
  close(): void;
};

export interface LocalRuntimeSourceOptions extends SourceFactoryContext {
  /**
   * Projection hosts pass the host into source factories. Actor-Web accepts it
   * so product code can use `readModel({ host })` without adapter glue; source
   * cleanup is still governed by close(), AbortSignal, or runtime.stop().
   */
}

export type LocalRuntimeActorSource<TActor extends ActorDescriptor> = {
  source(
    options?: LocalRuntimeSourceOptions
  ): ClosableSource<ActorContextOf<TActor>, ActorMessageOf<TActor>, ActorEventOf<TActor>>;
  session(
    options?: LocalRuntimeSourceOptions
  ): SourceSession<
    ClosableReadModelSource<ActorContextOf<TActor>, ActorEventOf<TActor>>,
    ClosableCommandSource<ActorContextOf<TActor>, ActorMessageOf<TActor>, ActorEventOf<TActor>>
  >;
  readModel(
    options?: LocalRuntimeSourceOptions
  ): ClosableReadModelSource<ActorContextOf<TActor>, ActorEventOf<TActor>>;
  commands(
    options?: LocalRuntimeSourceOptions
  ): ClosableCommandSource<ActorContextOf<TActor>, ActorMessageOf<TActor>, ActorEventOf<TActor>>;
  actor(): ActorRef<ActorContextOf<TActor>, ActorMessageOf<TActor>>;
};

export type LocalRuntimeSources<TTopology extends Topology<TopologyInput>> = {
  readonly [K in keyof TTopology['actors']]: LocalRuntimeActorSource<TTopology['actors'][K]>;
};

export type LocalRuntimeTopology<TTopology extends Topology<TopologyInput>> = Omit<
  TTopology,
  'source' | 'readModel' | 'commands' | 'session'
> & {
  source<TKey extends keyof TTopology['actors'] & string>(
    key: TKey,
    options?: GatewaySourceOptions | LocalRuntimeSourceOptions
  ): ClosableSource<
    ActorContextOf<TTopology['actors'][TKey]>,
    ActorMessageOf<TTopology['actors'][TKey]>,
    ActorEventOf<TTopology['actors'][TKey]>
  >;
  readModel<TKey extends keyof TTopology['actors'] & string>(
    key: TKey,
    options?: GatewaySourceOptions | LocalRuntimeSourceOptions
  ): ClosableReadModelSource<
    ActorContextOf<TTopology['actors'][TKey]>,
    ActorEventOf<TTopology['actors'][TKey]>
  >;
  commands<TKey extends keyof TTopology['actors'] & string>(
    key: TKey,
    options?: GatewaySourceOptions | LocalRuntimeSourceOptions
  ): ClosableSource<
    ActorContextOf<TTopology['actors'][TKey]>,
    ActorMessageOf<TTopology['actors'][TKey]>,
    ActorEventOf<TTopology['actors'][TKey]>
  >;
  session<TKey extends keyof TTopology['actors'] & string>(
    key: TKey,
    options?: GatewaySourceOptions | LocalRuntimeSourceOptions
  ): SourceSession<
    ClosableReadModelSource<
      ActorContextOf<TTopology['actors'][TKey]>,
      ActorEventOf<TTopology['actors'][TKey]>
    >,
    ClosableSource<
      ActorContextOf<TTopology['actors'][TKey]>,
      ActorMessageOf<TTopology['actors'][TKey]>,
      ActorEventOf<TTopology['actors'][TKey]>
    >
  >;
};

export interface StartLocalRuntimeOptions<TTopology extends Topology<TopologyInput>> {
  readonly nodes?: readonly (keyof TTopology['nodes'] & string)[];
  readonly tools?: ActorToolRegistry;
  readonly network?: InMemoryMessageTransportNetwork;
}

export type StartedLocalRuntime<TTopology extends Topology<TopologyInput>> =
  LocalRuntimeSources<TTopology> & {
    readonly topology: LocalRuntimeTopology<TTopology>;
    readonly nodes: Partial<
      Record<keyof TTopology['nodes'] & string, StartedNode<TTopology, MessageTransport>>
    >;
    readonly actors: LocalRuntimeSources<TTopology>;
    stop(): Promise<void>;
    getActor<TKey extends keyof TTopology['actors'] & string>(
      key: TKey
    ):
      | ActorRef<
          ActorContextOf<TTopology['actors'][TKey]>,
          ActorMessageOf<TTopology['actors'][TKey]>
        >
      | undefined;
    requireActor<TKey extends keyof TTopology['actors'] & string>(
      key: TKey
    ): ActorRef<
      ActorContextOf<TTopology['actors'][TKey]>,
      ActorMessageOf<TTopology['actors'][TKey]>
    >;
  };

type ClosableLocalSource = { close(): void };
type TrackedActorWebClientSource = { close(): void };

function trackActorWebClientSource<TSource extends TrackedActorWebClientSource>(
  openedSources: Set<TrackedActorWebClientSource>,
  source: TSource
): TSource {
  const close = source.close.bind(source);
  const trackedSource = Object.assign(source, {
    close() {
      openedSources.delete(trackedSource);
      close();
    },
  });
  openedSources.add(trackedSource);
  return trackedSource;
}

function registerAbortCleanup(
  options: LocalRuntimeSourceOptions | undefined,
  close: () => void
): () => void {
  const signal = options?.signal;
  if (!signal) {
    return () => {};
  }

  if (signal.aborted) {
    close();
    return () => {};
  }

  signal.addEventListener('abort', close, { once: true });
  return () => {
    signal.removeEventListener('abort', close);
  };
}

function createClosableLocalReadModelSource<
  TContext,
  TMessage extends ActorMessage,
  TEvent extends ActorMessage,
>(
  actorRef: ActorRef<TContext, TMessage>,
  options: LocalRuntimeSourceOptions | undefined,
  onClose: () => void
): ClosableReadModelSource<TContext, TEvent> {
  const source = createActorReadModelSource<TContext, TMessage, TEvent>(actorRef);
  const subscriptions = new Set<() => void>();
  let cleanupAbort = () => {};
  let closed = false;

  const close = (): void => {
    if (closed) {
      return;
    }

    closed = true;
    cleanupAbort();
    cleanupAbort = () => {};
    for (const unsubscribe of Array.from(subscriptions)) {
      unsubscribe();
    }
    subscriptions.clear();
    onClose();
  };

  cleanupAbort = registerAbortCleanup(options, close);

  const track = (unsubscribe: () => void): (() => void) => {
    if (closed) {
      unsubscribe();
      return () => {};
    }

    subscriptions.add(unsubscribe);
    return () => {
      subscriptions.delete(unsubscribe);
      unsubscribe();
    };
  };

  return {
    address: source.address,
    snapshot: source.snapshot,
    subscribe(listener) {
      if (closed) {
        return () => {};
      }

      return track(source.subscribe(listener));
    },
    subscribeEvent(listener, eventOptions: ActorEventSubscriptionOptions = {}) {
      if (closed) {
        return () => {};
      }

      return track(source.subscribeEvent(listener, eventOptions));
    },
    transportStatus: source.transportStatus,
    subscribeTransportStatus(listener) {
      if (closed) {
        return () => {};
      }

      return track(source.subscribeTransportStatus(listener));
    },
    close,
  };
}

function createClosableLocalCommandSource<
  TContext,
  TMessage extends ActorMessage,
  TEvent extends ActorMessage,
>(
  actorRef: ActorRef<TContext, TMessage>,
  options: LocalRuntimeSourceOptions | undefined,
  onClose: () => void
): ClosableCommandSource<TContext, TMessage, TEvent> {
  const commandSource = createActorCommandSource<TContext, TMessage, TEvent>(actorRef);
  const readModel = createClosableLocalReadModelSource<TContext, TMessage, TEvent>(
    actorRef,
    options,
    onClose
  );

  return {
    ...readModel,
    send: commandSource.send,
    ask: commandSource.ask,
  };
}

export function createClient<TTopology extends Topology<TopologyInput>>(
  topology: TTopology,
  options: ClientOptions
): Client<TTopology> {
  const openedSources = new Set<TrackedActorWebClientSource>();
  const actors = {} as Client<TTopology>['actors'];

  for (const [key, actor] of Object.entries(topology.actors)) {
    let source: ClosableSource | null = null;
    Object.defineProperty(actors, key, {
      enumerable: true,
      get() {
        const createReadModel = (): ClosableReadModelSource => {
          const readModel = createGatewayReadModelSource({
            actor,
            gateway: options.gateway,
            streamId: `actor-web-${key}-read-model`,
            clientVersion: options.clientVersion,
            ...(options.createSocket ? { createSocket: options.createSocket } : {}),
          });
          return trackActorWebClientSource(openedSources, readModel);
        };
        const createCommands = (): ClosableSource => {
          const commands = createGatewayCommandSource({
            actor,
            gateway: options.gateway,
            streamId: `actor-web-${key}-commands`,
            clientVersion: options.clientVersion,
            ...(options.createSocket ? { createSocket: options.createSocket } : {}),
          });
          return trackActorWebClientSource(openedSources, commands);
        };

        source ??= trackActorWebClientSource(
          openedSources,
          Object.assign(
            createGatewaySource({
              actor,
              gateway: options.gateway,
              streamId: `actor-web-${key}`,
              clientVersion: options.clientVersion,
              ...(options.createSocket ? { createSocket: options.createSocket } : {}),
            }),
            {
              readModel() {
                return createReadModel();
              },
              commands() {
                return createCommands();
              },
              session() {
                const readModel = createReadModel();
                try {
                  return createActorWebSourceSession(readModel, createCommands());
                } catch (error) {
                  readModel.close();
                  throw error;
                }
              },
            }
          )
        );
        return source as Client<TTopology>['actors'][typeof key];
      },
    });
  }

  return {
    actors,
    close(): void {
      for (const source of Array.from(openedSources)) {
        source.close();
      }
      openedSources.clear();
    },
  };
}

export function createReadModelClient<TTopology extends Topology<TopologyInput>>(
  topology: TTopology,
  options: ClientOptions
): ReadModelClient<TTopology> {
  const openedSources = new Set<{ close(): void }>();
  const actors = {} as ReadModelClient<TTopology>['actors'];

  for (const [key, actor] of Object.entries(topology.actors)) {
    let source: ClosableReadModelSource | null = null;
    Object.defineProperty(actors, key, {
      enumerable: true,
      get() {
        source ??= createGatewayReadModelSource({
          actor,
          gateway: options.gateway,
          streamId: `actor-web-${key}`,
          clientVersion: options.clientVersion,
          ...(options.createSocket ? { createSocket: options.createSocket } : {}),
        });
        openedSources.add(source);
        return source;
      },
    });
  }

  return {
    actors,
    close(): void {
      for (const source of Array.from(openedSources)) {
        source.close();
      }
      openedSources.clear();
    },
  };
}

export async function startRuntime<TTopology extends Topology<TopologyInput>>(
  topology: TTopology,
  options: StartLocalRuntimeOptions<TTopology> = {}
): Promise<StartedLocalRuntime<TTopology>> {
  const nodeKeys = (options.nodes ??
    Object.keys(topology.nodes)) as readonly (keyof TTopology['nodes'] & string)[];
  const network = options.network ?? createInMemoryMessageTransportNetwork();
  const transports = new Map<string, MessageTransport>();
  const startedNodes = new Map<
    keyof TTopology['nodes'] & string,
    StartedNode<TTopology, MessageTransport>
  >();
  const openedSources = new Set<ClosableLocalSource>();

  try {
    for (const nodeKey of nodeKeys) {
      const nodeDefinition = topology.nodes[nodeKey];
      if (!nodeDefinition) {
        throw new Error(`Unknown Actor-Web node "${nodeKey}".`);
      }

      transports.set(nodeKey, network.createTransport(nodeDefinition.address));
    }

    for (const nodeKey of nodeKeys) {
      const startedNode = await startNode(topology, {
        node: nodeKey,
        transport: transports.get(nodeKey) as MessageTransport,
        connect: [],
        ...(options.tools ? { tools: options.tools } : {}),
      });
      startedNodes.set(nodeKey, startedNode);
    }

    for (const nodeKey of nodeKeys) {
      const peerAddresses = nodeKeys
        .filter((peerKey) => peerKey !== nodeKey)
        .map((peerKey) => topology.nodes[peerKey]?.address)
        .filter((address): address is string => Boolean(address));
      if (peerAddresses.length > 0) {
        const startedNode = startedNodes.get(nodeKey);
        if (!startedNode) {
          throw new Error(`Actor-Web local runtime did not start node "${nodeKey}".`);
        }
        await startedNode.system.join(peerAddresses);
      }
    }
  } catch (error) {
    for (const startedNode of Array.from(startedNodes.values()).reverse()) {
      await startedNode.stop().catch(() => {});
    }
    openedSources.clear();
    throw error;
  }

  const getActor = <TKey extends keyof TTopology['actors'] & string>(
    key: TKey
  ):
    | ActorRef<ActorContextOf<TTopology['actors'][TKey]>, ActorMessageOf<TTopology['actors'][TKey]>>
    | undefined => {
    for (const startedNode of startedNodes.values()) {
      const actorRef = startedNode.getActor(key);
      if (actorRef) {
        return actorRef;
      }
    }

    return undefined;
  };

  const requireActor = <TKey extends keyof TTopology['actors'] & string>(
    key: TKey
  ): ActorRef<
    ActorContextOf<TTopology['actors'][TKey]>,
    ActorMessageOf<TTopology['actors'][TKey]>
  > => {
    const actorRef = getActor(key);
    if (!actorRef) {
      throw new Error(`Actor-Web local runtime did not start actor "${key}".`);
    }

    return actorRef;
  };

  // Wire topology-declared subscriptions: deliver each publisher's emitted events
  // to its declared subscriber(s). Re-established from the topology on every start
  // (durable across restart) and torn down in stop().
  const subscriptionTeardowns: Array<() => Promise<void> | void> = [];
  const hostNodeFor = (key: keyof TTopology['actors'] & string) => {
    for (const startedNode of startedNodes.values()) {
      if (startedNode.getActor(key)) {
        return startedNode;
      }
    }
    throw new Error(`Actor-Web local runtime did not start actor "${key}".`);
  };
  for (const subscription of topology.subscriptions) {
    const fromKey = subscription.from as keyof TTopology['actors'] & string;
    const publisher = requireActor(fromKey) as unknown as ActorRef;
    const publisherSystem = hostNodeFor(fromKey).system;
    const subscriberKeys =
      typeof subscription.to === 'string' ? [subscription.to] : subscription.to;
    for (const toKey of subscriberKeys) {
      const subscriber = requireActor(
        toKey as keyof TTopology['actors'] & string
      ) as unknown as ActorRef;
      const teardown = await publisherSystem.subscribe(publisher, {
        subscriber,
        ...(subscription.events && subscription.events.length > 0
          ? { events: [...subscription.events] }
          : {}),
      });
      subscriptionTeardowns.push(teardown);
    }
  }

  const createActorSource = <TActor extends ActorDescriptor>(
    actorKey: keyof TTopology['actors'] & string
  ): LocalRuntimeActorSource<TActor> => {
    const sourceApi: LocalRuntimeActorSource<TActor> = {
      source(sourceOptions) {
        return sourceApi.commands(sourceOptions);
      },
      session(sourceOptions) {
        return createActorWebSourceSession(
          sourceApi.readModel(sourceOptions),
          sourceApi.commands(sourceOptions)
        );
      },
      readModel(sourceOptions) {
        const source: ClosableReadModelSource<
          ActorContextOf<TActor>,
          ActorEventOf<TActor>
        > = createClosableLocalReadModelSource(
          requireActor(actorKey) as unknown as ActorRef<
            ActorContextOf<TActor>,
            ActorMessageOf<TActor>
          >,
          sourceOptions,
          () => {
            openedSources.delete(source);
          }
        );
        openedSources.add(source);
        return source;
      },
      commands(sourceOptions) {
        const source: ClosableCommandSource<
          ActorContextOf<TActor>,
          ActorMessageOf<TActor>,
          ActorEventOf<TActor>
        > = createClosableLocalCommandSource(
          requireActor(actorKey) as unknown as ActorRef<
            ActorContextOf<TActor>,
            ActorMessageOf<TActor>
          >,
          sourceOptions,
          () => {
            openedSources.delete(source);
          }
        );
        openedSources.add(source);
        return source;
      },
      actor() {
        return requireActor(actorKey) as unknown as ActorRef<
          ActorContextOf<TActor>,
          ActorMessageOf<TActor>
        >;
      },
    };
    return sourceApi;
  };

  const actorSources = Object.fromEntries(
    Object.keys(topology.actors).map((actorKey) => [
      actorKey,
      createActorSource(actorKey as keyof TTopology['actors'] & string),
    ])
  ) as LocalRuntimeSources<TTopology>;
  const runtimeTopology = Object.assign({}, topology, {
    source<TKey extends keyof TTopology['actors'] & string>(
      key: TKey,
      options?: GatewaySourceOptions | LocalRuntimeSourceOptions
    ) {
      const localSource = actorSources[key];

      if (hasActorWebSourceGatewayOptions(options)) {
        return topology.source(key, options);
      }

      return localSource.source(options);
    },
    readModel<TKey extends keyof TTopology['actors'] & string>(
      key: TKey,
      options?: GatewaySourceOptions | LocalRuntimeSourceOptions
    ) {
      const localSource = actorSources[key];

      if (hasActorWebSourceGatewayOptions(options)) {
        return topology.readModel(key, options);
      }

      return localSource.readModel(options);
    },
    commands<TKey extends keyof TTopology['actors'] & string>(
      key: TKey,
      options?: GatewaySourceOptions | LocalRuntimeSourceOptions
    ) {
      const localSource = actorSources[key];

      if (hasActorWebSourceGatewayOptions(options)) {
        return topology.commands(key, options);
      }

      return localSource.commands(options);
    },
    session<TKey extends keyof TTopology['actors'] & string>(
      key: TKey,
      options?: GatewaySourceOptions | LocalRuntimeSourceOptions
    ) {
      const localSource = actorSources[key];

      if (hasActorWebSourceGatewayOptions(options)) {
        return topology.session(key, options);
      }

      return localSource.session(options);
    },
  }) as unknown as LocalRuntimeTopology<TTopology>;
  const runtimeBase = {
    topology: runtimeTopology,
    nodes: Object.fromEntries(startedNodes) as Partial<
      Record<keyof TTopology['nodes'] & string, StartedNode<TTopology, MessageTransport>>
    >,
    actors: actorSources,
    async stop(): Promise<void> {
      for (const teardown of subscriptionTeardowns.reverse()) {
        await teardown();
      }
      subscriptionTeardowns.length = 0;

      for (const source of Array.from(openedSources)) {
        source.close();
      }
      openedSources.clear();

      for (const startedNode of Array.from(startedNodes.values()).reverse()) {
        await startedNode.stop();
      }
      startedNodes.clear();
    },
    getActor,
    requireActor,
  };

  return Object.assign(runtimeBase, actorSources) as StartedLocalRuntime<TTopology>;
}

export type {
  /** @deprecated Use Client instead. */
  Client as ActorWebClient,
  /** @deprecated Use ClientOptions instead. */
  ClientOptions as ActorWebClientOptions,
  /** @deprecated Use LocalRuntimeActorSource instead. */
  LocalRuntimeActorSource as ActorWebLocalRuntimeActorSource,
  /** @deprecated Use LocalRuntimeSourceOptions instead. */
  LocalRuntimeSourceOptions as ActorWebLocalRuntimeSourceOptions,
  /** @deprecated Use LocalRuntimeSources instead. */
  LocalRuntimeSources as ActorWebLocalRuntimeSources,
  /** @deprecated Use ReadModelClient instead. */
  ReadModelClient as ActorWebReadModelClient,
  /** @deprecated Use StartLocalRuntimeOptions instead. */
  StartLocalRuntimeOptions as StartActorWebLocalRuntimeOptions,
  /** @deprecated Use StartedLocalRuntime instead. */
  StartedLocalRuntime as StartedActorWebLocalRuntime,
};
export {
  /** @deprecated Use createClient instead. */
  createClient as createActorWebClient,
  /** @deprecated Use createReadModelClient instead. */
  createReadModelClient as createActorWebReadModelClient,
};
