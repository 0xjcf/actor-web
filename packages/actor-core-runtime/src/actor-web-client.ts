import type { ActorEventSubscriptionOptions, ActorRef } from './actor-ref.js';
import type { ActorMessage, MessageTransport } from './actor-system.js';
import type { ActorToolRegistry } from './actor-tools.js';
import type {
  ActorWebGatewaySocket,
  ActorWebSourceGatewayOptions,
  ActorWebSourceOptions,
} from './actor-web-source.js';
import {
  type ActorWebSourceFactoryContext,
  type ClosableActorWebCommandSource,
  type ClosableActorWebReadModelSource,
  type ClosableActorWebSource,
  createActorWebCommandSource,
  createActorWebReadModelSource,
  createActorWebSource,
  hasActorWebSourceGatewayOptions,
} from './actor-web-source.js';
import {
  createActorCommandSource,
  createActorReadModelSource,
} from './integration/actor-source.js';
import { type StartedActorWebNode, startActorWebNode } from './start-actor-web-node.js';
import {
  createInMemoryMessageTransportNetwork,
  type InMemoryMessageTransportNetwork,
} from './testing/in-memory-message-transport.js';
import type {
  ActorWebActorContext,
  ActorWebActorDescriptor,
  ActorWebActorEvent,
  ActorWebActorMessage,
  ActorWebSourceSession,
  ActorWebTopology,
  ActorWebTopologyInput,
} from './topology.js';
import { createActorWebSourceSession } from './topology.js';

export interface ActorWebClientOptions {
  readonly gateway: ActorWebSourceGatewayOptions;
  readonly createSocket?: (url: string) => ActorWebGatewaySocket;
  readonly clientVersion?: string;
}

export type ActorWebClientActorSource<TActor extends ActorWebActorDescriptor> =
  ClosableActorWebSource<
    ActorWebActorContext<TActor>,
    ActorWebActorMessage<TActor>,
    ActorWebActorEvent<TActor>
  > & {
    readModel(): ClosableActorWebReadModelSource<
      ActorWebActorContext<TActor>,
      ActorWebActorEvent<TActor>
    >;
    commands(): ClosableActorWebSource<
      ActorWebActorContext<TActor>,
      ActorWebActorMessage<TActor>,
      ActorWebActorEvent<TActor>
    >;
    session(): ActorWebSourceSession<
      ClosableActorWebReadModelSource<ActorWebActorContext<TActor>, ActorWebActorEvent<TActor>>,
      ClosableActorWebSource<
        ActorWebActorContext<TActor>,
        ActorWebActorMessage<TActor>,
        ActorWebActorEvent<TActor>
      >
    >;
  };

export type ActorWebClient<TTopology extends ActorWebTopology<ActorWebTopologyInput>> = {
  readonly actors: {
    readonly [K in keyof TTopology['actors']]: ActorWebClientActorSource<TTopology['actors'][K]>;
  };
  close(): void;
};

/**
 * Projection-only client for UI and projection hosts. This is the default
 * browser/client surface when a shared topology is available.
 */
export type ActorWebReadModelClient<TTopology extends ActorWebTopology<ActorWebTopologyInput>> = {
  readonly actors: {
    readonly [K in keyof TTopology['actors']]: ClosableActorWebReadModelSource<
      ActorWebActorContext<TTopology['actors'][K]>,
      ActorWebActorEvent<TTopology['actors'][K]>
    >;
  };
  close(): void;
};

export interface ActorWebLocalRuntimeSourceOptions extends ActorWebSourceFactoryContext {
  /**
   * Projection hosts pass the host into source factories. Actor-Web accepts it
   * so product code can use `readModel({ host })` without adapter glue; source
   * cleanup is still governed by close(), AbortSignal, or runtime.stop().
   */
}

export type ActorWebLocalRuntimeActorSource<TActor extends ActorWebActorDescriptor> = {
  source(
    options?: ActorWebLocalRuntimeSourceOptions
  ): ClosableActorWebSource<
    ActorWebActorContext<TActor>,
    ActorWebActorMessage<TActor>,
    ActorWebActorEvent<TActor>
  >;
  session(
    options?: ActorWebLocalRuntimeSourceOptions
  ): ActorWebSourceSession<
    ClosableActorWebReadModelSource<ActorWebActorContext<TActor>, ActorWebActorEvent<TActor>>,
    ClosableActorWebCommandSource<
      ActorWebActorContext<TActor>,
      ActorWebActorMessage<TActor>,
      ActorWebActorEvent<TActor>
    >
  >;
  readModel(
    options?: ActorWebLocalRuntimeSourceOptions
  ): ClosableActorWebReadModelSource<ActorWebActorContext<TActor>, ActorWebActorEvent<TActor>>;
  commands(
    options?: ActorWebLocalRuntimeSourceOptions
  ): ClosableActorWebCommandSource<
    ActorWebActorContext<TActor>,
    ActorWebActorMessage<TActor>,
    ActorWebActorEvent<TActor>
  >;
  actor(): ActorRef<ActorWebActorContext<TActor>, ActorWebActorMessage<TActor>>;
};

export type ActorWebLocalRuntimeSources<TTopology extends ActorWebTopology<ActorWebTopologyInput>> =
  {
    readonly [K in keyof TTopology['actors']]: ActorWebLocalRuntimeActorSource<
      TTopology['actors'][K]
    >;
  };

export type ActorWebLocalRuntimeTopology<
  TTopology extends ActorWebTopology<ActorWebTopologyInput>,
> = Omit<TTopology, 'source' | 'readModel' | 'commands' | 'session'> & {
  source<TKey extends keyof TTopology['actors'] & string>(
    key: TKey,
    options?: ActorWebSourceOptions | ActorWebLocalRuntimeSourceOptions
  ): ClosableActorWebSource<
    ActorWebActorContext<TTopology['actors'][TKey]>,
    ActorWebActorMessage<TTopology['actors'][TKey]>,
    ActorWebActorEvent<TTopology['actors'][TKey]>
  >;
  readModel<TKey extends keyof TTopology['actors'] & string>(
    key: TKey,
    options?: ActorWebSourceOptions | ActorWebLocalRuntimeSourceOptions
  ): ClosableActorWebReadModelSource<
    ActorWebActorContext<TTopology['actors'][TKey]>,
    ActorWebActorEvent<TTopology['actors'][TKey]>
  >;
  commands<TKey extends keyof TTopology['actors'] & string>(
    key: TKey,
    options?: ActorWebSourceOptions | ActorWebLocalRuntimeSourceOptions
  ): ClosableActorWebSource<
    ActorWebActorContext<TTopology['actors'][TKey]>,
    ActorWebActorMessage<TTopology['actors'][TKey]>,
    ActorWebActorEvent<TTopology['actors'][TKey]>
  >;
  session<TKey extends keyof TTopology['actors'] & string>(
    key: TKey,
    options?: ActorWebSourceOptions | ActorWebLocalRuntimeSourceOptions
  ): ActorWebSourceSession<
    ClosableActorWebReadModelSource<
      ActorWebActorContext<TTopology['actors'][TKey]>,
      ActorWebActorEvent<TTopology['actors'][TKey]>
    >,
    ClosableActorWebSource<
      ActorWebActorContext<TTopology['actors'][TKey]>,
      ActorWebActorMessage<TTopology['actors'][TKey]>,
      ActorWebActorEvent<TTopology['actors'][TKey]>
    >
  >;
};

export interface StartActorWebLocalRuntimeOptions<
  TTopology extends ActorWebTopology<ActorWebTopologyInput>,
> {
  readonly nodes?: readonly (keyof TTopology['nodes'] & string)[];
  readonly tools?: ActorToolRegistry;
  readonly network?: InMemoryMessageTransportNetwork;
}

export type StartedActorWebLocalRuntime<TTopology extends ActorWebTopology<ActorWebTopologyInput>> =
  ActorWebLocalRuntimeSources<TTopology> & {
    readonly topology: ActorWebLocalRuntimeTopology<TTopology>;
    readonly nodes: Partial<
      Record<keyof TTopology['nodes'] & string, StartedActorWebNode<TTopology, MessageTransport>>
    >;
    readonly actors: ActorWebLocalRuntimeSources<TTopology>;
    stop(): Promise<void>;
    getActor<TKey extends keyof TTopology['actors'] & string>(
      key: TKey
    ):
      | ActorRef<
          ActorWebActorContext<TTopology['actors'][TKey]>,
          ActorWebActorMessage<TTopology['actors'][TKey]>
        >
      | undefined;
    requireActor<TKey extends keyof TTopology['actors'] & string>(
      key: TKey
    ): ActorRef<
      ActorWebActorContext<TTopology['actors'][TKey]>,
      ActorWebActorMessage<TTopology['actors'][TKey]>
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
  options: ActorWebLocalRuntimeSourceOptions | undefined,
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
  options: ActorWebLocalRuntimeSourceOptions | undefined,
  onClose: () => void
): ClosableActorWebReadModelSource<TContext, TEvent> {
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
  options: ActorWebLocalRuntimeSourceOptions | undefined,
  onClose: () => void
): ClosableActorWebCommandSource<TContext, TMessage, TEvent> {
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

export function createActorWebClient<TTopology extends ActorWebTopology<ActorWebTopologyInput>>(
  topology: TTopology,
  options: ActorWebClientOptions
): ActorWebClient<TTopology> {
  const openedSources = new Set<TrackedActorWebClientSource>();
  const actors = {} as ActorWebClient<TTopology>['actors'];

  for (const [key, actor] of Object.entries(topology.actors)) {
    let source: ClosableActorWebSource | null = null;
    Object.defineProperty(actors, key, {
      enumerable: true,
      get() {
        const createReadModel = (): ClosableActorWebReadModelSource => {
          const readModel = createActorWebReadModelSource({
            actor,
            gateway: options.gateway,
            streamId: `actor-web-${key}-read-model`,
            clientVersion: options.clientVersion,
            ...(options.createSocket ? { createSocket: options.createSocket } : {}),
          });
          return trackActorWebClientSource(openedSources, readModel);
        };
        const createCommands = (): ClosableActorWebSource => {
          const commands = createActorWebCommandSource({
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
            createActorWebSource({
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
        return source as ActorWebClient<TTopology>['actors'][typeof key];
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

export function createActorWebReadModelClient<
  TTopology extends ActorWebTopology<ActorWebTopologyInput>,
>(topology: TTopology, options: ActorWebClientOptions): ActorWebReadModelClient<TTopology> {
  const openedSources = new Set<{ close(): void }>();
  const actors = {} as ActorWebReadModelClient<TTopology>['actors'];

  for (const [key, actor] of Object.entries(topology.actors)) {
    let source: ClosableActorWebReadModelSource | null = null;
    Object.defineProperty(actors, key, {
      enumerable: true,
      get() {
        source ??= createActorWebReadModelSource({
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

export async function startRuntime<TTopology extends ActorWebTopology<ActorWebTopologyInput>>(
  topology: TTopology,
  options: StartActorWebLocalRuntimeOptions<TTopology> = {}
): Promise<StartedActorWebLocalRuntime<TTopology>> {
  const nodeKeys = (options.nodes ??
    Object.keys(topology.nodes)) as readonly (keyof TTopology['nodes'] & string)[];
  const network = options.network ?? createInMemoryMessageTransportNetwork();
  const transports = new Map<string, MessageTransport>();
  const startedNodes = new Map<
    keyof TTopology['nodes'] & string,
    StartedActorWebNode<TTopology, MessageTransport>
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
      const startedNode = await startActorWebNode(topology, {
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
    | ActorRef<
        ActorWebActorContext<TTopology['actors'][TKey]>,
        ActorWebActorMessage<TTopology['actors'][TKey]>
      >
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
    ActorWebActorContext<TTopology['actors'][TKey]>,
    ActorWebActorMessage<TTopology['actors'][TKey]>
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

  const createActorSource = <TActor extends ActorWebActorDescriptor>(
    actorKey: keyof TTopology['actors'] & string
  ): ActorWebLocalRuntimeActorSource<TActor> => {
    const sourceApi: ActorWebLocalRuntimeActorSource<TActor> = {
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
        const source: ClosableActorWebReadModelSource<
          ActorWebActorContext<TActor>,
          ActorWebActorEvent<TActor>
        > = createClosableLocalReadModelSource(
          requireActor(actorKey) as unknown as ActorRef<
            ActorWebActorContext<TActor>,
            ActorWebActorMessage<TActor>
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
        const source: ClosableActorWebCommandSource<
          ActorWebActorContext<TActor>,
          ActorWebActorMessage<TActor>,
          ActorWebActorEvent<TActor>
        > = createClosableLocalCommandSource(
          requireActor(actorKey) as unknown as ActorRef<
            ActorWebActorContext<TActor>,
            ActorWebActorMessage<TActor>
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
          ActorWebActorContext<TActor>,
          ActorWebActorMessage<TActor>
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
  ) as ActorWebLocalRuntimeSources<TTopology>;
  const runtimeTopology = Object.assign({}, topology, {
    source<TKey extends keyof TTopology['actors'] & string>(
      key: TKey,
      options?: ActorWebSourceOptions | ActorWebLocalRuntimeSourceOptions
    ) {
      const localSource = actorSources[key];

      if (hasActorWebSourceGatewayOptions(options)) {
        return topology.source(key, options);
      }

      return localSource.source(options);
    },
    readModel<TKey extends keyof TTopology['actors'] & string>(
      key: TKey,
      options?: ActorWebSourceOptions | ActorWebLocalRuntimeSourceOptions
    ) {
      const localSource = actorSources[key];

      if (hasActorWebSourceGatewayOptions(options)) {
        return topology.readModel(key, options);
      }

      return localSource.readModel(options);
    },
    commands<TKey extends keyof TTopology['actors'] & string>(
      key: TKey,
      options?: ActorWebSourceOptions | ActorWebLocalRuntimeSourceOptions
    ) {
      const localSource = actorSources[key];

      if (hasActorWebSourceGatewayOptions(options)) {
        return topology.commands(key, options);
      }

      return localSource.commands(options);
    },
    session<TKey extends keyof TTopology['actors'] & string>(
      key: TKey,
      options?: ActorWebSourceOptions | ActorWebLocalRuntimeSourceOptions
    ) {
      const localSource = actorSources[key];

      if (hasActorWebSourceGatewayOptions(options)) {
        return topology.session(key, options);
      }

      return localSource.session(options);
    },
  }) as unknown as ActorWebLocalRuntimeTopology<TTopology>;
  const runtimeBase = {
    topology: runtimeTopology,
    nodes: Object.fromEntries(startedNodes) as Partial<
      Record<keyof TTopology['nodes'] & string, StartedActorWebNode<TTopology, MessageTransport>>
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

  return Object.assign(runtimeBase, actorSources) as StartedActorWebLocalRuntime<TTopology>;
}
