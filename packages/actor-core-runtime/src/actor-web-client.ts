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
  createActorWebSourceHandle,
  hasActorWebSourceGatewayOptions,
} from './actor-web-source.js';
import {
  createIgniteCommandSource,
  createIgniteReadModelSource,
} from './integration/ignite-element-bridge.js';
import {
  createRuntimeGatewaySourceHandle,
  type RuntimeGatewaySourceHandle,
} from './runtime-gateway-shared.js';
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
  ActorWebTopology,
  ActorWebTopologyInput,
} from './topology.js';

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
    sourceHandle(): RuntimeGatewaySourceHandle<
      ClosableActorWebReadModelSource<ActorWebActorContext<TActor>, ActorWebActorEvent<TActor>>,
      ClosableActorWebSource<
        ActorWebActorContext<TActor>,
        ActorWebActorMessage<TActor>,
        ActorWebActorEvent<TActor>
      >
    >;
    readModelHandle(): RuntimeGatewaySourceHandle<
      ClosableActorWebReadModelSource<ActorWebActorContext<TActor>, ActorWebActorEvent<TActor>>,
      never
    >;
  };

export type ActorWebClient<TTopology extends ActorWebTopology<ActorWebTopologyInput>> = {
  readonly actors: {
    readonly [K in keyof TTopology['actors']]: ActorWebClientActorSource<TTopology['actors'][K]>;
  };
  close(): void;
};

/**
 * Projection-only client for UI and Ignite Element hosts. This is the default
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
   * Ignite Element passes the host into source factories. Actor-Web accepts it
   * so product code can use `readModel({ host })` without adapter glue; source
   * cleanup is still governed by close(), AbortSignal, or runtime.stop().
   */
}

export type ActorWebLocalRuntimeActorSource<TActor extends ActorWebActorDescriptor> = {
  sourceHandle(
    options?: ActorWebLocalRuntimeSourceOptions
  ): RuntimeGatewaySourceHandle<
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
  readModelHandle(
    options?: ActorWebLocalRuntimeSourceOptions
  ): RuntimeGatewaySourceHandle<
    ClosableActorWebReadModelSource<ActorWebActorContext<TActor>, ActorWebActorEvent<TActor>>,
    never
  >;
  commandSource(
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

export type ActorWebLocalRuntimeTopologySourceFactory<TActor extends ActorWebActorDescriptor> = {
  bivarianceHack(
    options?: ActorWebSourceOptions | ActorWebLocalRuntimeSourceOptions
  ): RuntimeGatewaySourceHandle<
    ClosableActorWebReadModelSource<ActorWebActorContext<TActor>, ActorWebActorEvent<TActor>>,
    ClosableActorWebCommandSource<
      ActorWebActorContext<TActor>,
      ActorWebActorMessage<TActor>,
      ActorWebActorEvent<TActor>
    >
  >;
}['bivarianceHack'];

export type ActorWebLocalRuntimeTopology<
  TTopology extends ActorWebTopology<ActorWebTopologyInput>,
> = Omit<TTopology, 'source'> & {
  source<TKey extends keyof TTopology['actors'] & string>(
    key: TKey
  ): ActorWebLocalRuntimeTopologySourceFactory<TTopology['actors'][TKey]>;
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
  const source = createIgniteReadModelSource<TContext, TMessage, TEvent>(actorRef);
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
  const commandSource = createIgniteCommandSource<TContext, TMessage, TEvent>(actorRef);
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
  const openedSources = new Set<{ close(): void }>();
  const actors = {} as ActorWebClient<TTopology>['actors'];

  for (const [key, actor] of Object.entries(topology.actors)) {
    let source: ClosableActorWebSource | null = null;
    Object.defineProperty(actors, key, {
      enumerable: true,
      get() {
        source ??= Object.assign(
          createActorWebSource({
            actor,
            gateway: options.gateway,
            streamId: `actor-web-${key}`,
            clientVersion: options.clientVersion,
            ...(options.createSocket ? { createSocket: options.createSocket } : {}),
          }),
          {
            sourceHandle() {
              const readModel = createActorWebReadModelSource({
                actor,
                gateway: options.gateway,
                streamId: `actor-web-${key}-source-handle-read-model`,
                clientVersion: options.clientVersion,
                ...(options.createSocket ? { createSocket: options.createSocket } : {}),
              });
              const commandSource = createActorWebCommandSource({
                actor,
                gateway: options.gateway,
                streamId: `actor-web-${key}-source-handle-command`,
                clientVersion: options.clientVersion,
                ...(options.createSocket ? { createSocket: options.createSocket } : {}),
              });
              openedSources.add(readModel);
              openedSources.add(commandSource);
              return createActorWebSourceHandle(readModel, commandSource);
            },
            readModelHandle() {
              const readModel = createActorWebReadModelSource({
                actor,
                gateway: options.gateway,
                streamId: `actor-web-${key}-read-model`,
                clientVersion: options.clientVersion,
                ...(options.createSocket ? { createSocket: options.createSocket } : {}),
              });
              openedSources.add(readModel);
              return createRuntimeGatewaySourceHandle(readModel);
            },
          }
        );
        openedSources.add(source);
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
      const peerKeys = nodeKeys.filter((peerKey) => peerKey !== nodeKey);
      const startedNode = await startActorWebNode(topology, {
        node: nodeKey,
        transport: transports.get(nodeKey) as MessageTransport,
        connect: peerKeys,
        ...(options.tools ? { tools: options.tools } : {}),
      });
      startedNodes.set(nodeKey, startedNode);
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
      sourceHandle(sourceOptions) {
        return createRuntimeGatewaySourceHandle(
          sourceApi.readModel(sourceOptions),
          sourceApi.commandSource(sourceOptions)
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
      readModelHandle(sourceOptions) {
        return createRuntimeGatewaySourceHandle(sourceApi.readModel(sourceOptions));
      },
      commandSource(sourceOptions) {
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
    source<TKey extends keyof TTopology['actors'] & string>(key: TKey) {
      const localSource = actorSources[key];
      const remoteSource = topology.source(key);

      return ((options?: ActorWebSourceOptions | ActorWebLocalRuntimeSourceOptions) => {
        if (hasActorWebSourceGatewayOptions(options)) {
          return remoteSource(options);
        }

        return localSource.sourceHandle(options);
      }) as ActorWebLocalRuntimeTopology<TTopology>['source'] extends (
        actorKey: typeof key
      ) => infer TFactory
        ? TFactory
        : never;
    },
  }) as ActorWebLocalRuntimeTopology<TTopology>;
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
