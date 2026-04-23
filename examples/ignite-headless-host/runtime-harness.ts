import {
  type ActorRef,
  createActorSystem,
  createIgniteActorSource,
  createInMemoryMessageTransportNetwork,
  type IgniteActorSource,
  type IgniteActorSourceEvent,
  type IgniteActorSourceSnapshot,
  type ProjectionTransportStatus,
} from '@actor-core/runtime/browser';
import {
  createBrowserServiceWorkerTransport,
  serviceWorkerRemoteNode,
  serviceWorkerRuntimeAvailable,
} from './browser-transport';
import {
  type CheckoutCommand,
  type CheckoutContext,
  type CheckoutEvent,
  createCheckoutBehavior,
  createPlaceholderSnapshot,
  LOCAL_NODE,
  normalizeCheckoutSnapshot,
  REMOTE_ACTOR_ID,
  REMOTE_ADDRESS,
  REMOTE_NODE,
} from './checkout-contract';

export type { CheckoutCommand, CheckoutContext, CheckoutEvent } from './checkout-contract';

export interface CheckoutRuntimeHarness {
  readonly source: IgniteActorSource<CheckoutContext, CheckoutCommand, CheckoutEvent>;
  destroy(): Promise<void>;
}

function createHarnessSource(
  startRuntime: (options: {
    setSource(source: IgniteActorSource<CheckoutContext, CheckoutCommand, CheckoutEvent>): void;
    setSnapshot(snapshot: IgniteActorSourceSnapshot<CheckoutContext>): void;
    setTransportStatus(status: ProjectionTransportStatus): void;
    notifySnapshots(): void;
    notifyTransportStatus(): void;
  }) => Promise<void>,
  destroyRuntime: () => Promise<void>,
  afterSend: () => Promise<void> = async () => {}
): CheckoutRuntimeHarness {
  let activeSource: IgniteActorSource<CheckoutContext, CheckoutCommand, CheckoutEvent> | null =
    null;
  let currentSnapshot = createPlaceholderSnapshot();
  let currentTransportStatus: ProjectionTransportStatus = {
    state: 'replaying',
    updatedAt: Date.now(),
  };
  let stopped = false;

  const snapshotListeners = new Set<
    (snapshot: IgniteActorSourceSnapshot<CheckoutContext>) => void
  >();
  const eventListeners = new Set<{
    listener: (event: IgniteActorSourceEvent<CheckoutEvent>) => void;
    types?: readonly string[];
  }>();
  const transportStatusListeners = new Set<(status: ProjectionTransportStatus) => void>();

  let stopRuntimeBridge = () => {};
  let stopEventBridge = () => {};
  let stopTransportBridge = () => {};

  const notifySnapshots = (): void => {
    for (const listener of Array.from(snapshotListeners)) {
      listener(currentSnapshot);
    }
  };

  const notifyTransportStatus = (): void => {
    for (const listener of Array.from(transportStatusListeners)) {
      listener(currentTransportStatus);
    }
  };

  const runtimeReady = startRuntime({
    setSource(source) {
      activeSource = source;
      currentSnapshot = normalizeCheckoutSnapshot(source.snapshot());
      currentTransportStatus = source.transportStatus();
      notifySnapshots();
      notifyTransportStatus();

      stopRuntimeBridge = source.subscribe((snapshot) => {
        currentSnapshot = normalizeCheckoutSnapshot(snapshot);
        notifySnapshots();
      });

      stopEventBridge = source.subscribeEvent(
        (event) => {
          for (const subscriber of Array.from(eventListeners)) {
            if (
              subscriber.types &&
              subscriber.types.length > 0 &&
              !subscriber.types.includes(event.type)
            ) {
              continue;
            }

            subscriber.listener(event);
          }
        },
        { types: ['CHECKOUT_SUBMITTED', 'CHECKOUT_RESET'] }
      );

      stopTransportBridge = source.subscribeTransportStatus((status) => {
        currentTransportStatus = status;
        notifyTransportStatus();
      });
    },
    setSnapshot(snapshot) {
      currentSnapshot = normalizeCheckoutSnapshot(snapshot);
    },
    setTransportStatus(status) {
      currentTransportStatus = status;
    },
    notifySnapshots,
    notifyTransportStatus,
  }).catch((error: unknown) => {
    currentTransportStatus = {
      state: 'degraded',
      updatedAt: Date.now(),
      reason: error instanceof Error ? error.message : String(error),
    };
    notifyTransportStatus();
    throw error;
  });

  return {
    source: {
      address: REMOTE_ADDRESS,
      snapshot(): IgniteActorSourceSnapshot<CheckoutContext> {
        return currentSnapshot;
      },
      subscribe(
        listener: (snapshot: IgniteActorSourceSnapshot<CheckoutContext>) => void
      ): () => void {
        snapshotListeners.add(listener);
        listener(currentSnapshot);

        return () => {
          snapshotListeners.delete(listener);
        };
      },
      subscribeEvent(
        listener: (event: IgniteActorSourceEvent<CheckoutEvent>) => void,
        options = {}
      ): () => void {
        const subscriber = {
          listener,
          types: options.types,
        };
        eventListeners.add(subscriber);

        return () => {
          eventListeners.delete(subscriber);
        };
      },
      transportStatus(): ProjectionTransportStatus {
        return currentTransportStatus;
      },
      subscribeTransportStatus(listener: (status: ProjectionTransportStatus) => void): () => void {
        transportStatusListeners.add(listener);
        listener(currentTransportStatus);

        return () => {
          transportStatusListeners.delete(listener);
        };
      },
      async send(message: CheckoutCommand): Promise<void> {
        if (!activeSource) {
          await runtimeReady;
        }

        const source = activeSource;
        if (!source) {
          throw new Error('Runtime source is unavailable');
        }

        await source.send(message);
        await afterSend();
      },
      async ask<TResponse = unknown>(
        message: CheckoutCommand,
        timeout?: number
      ): Promise<TResponse> {
        if (!activeSource) {
          await runtimeReady;
        }

        const source = activeSource;
        if (!source) {
          throw new Error('Runtime source is unavailable');
        }

        return source.ask<TResponse>(message, timeout);
      },
    },
    async destroy(): Promise<void> {
      if (stopped) {
        return;
      }

      stopped = true;
      stopTransportBridge();
      stopEventBridge();
      stopRuntimeBridge();
      snapshotListeners.clear();
      eventListeners.clear();
      transportStatusListeners.clear();

      await runtimeReady.catch(() => undefined);
      await destroyRuntime();
    },
  };
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function waitForRemoteRef(
  lookup: () => Promise<ActorRef<CheckoutContext, CheckoutCommand> | undefined>,
  attempts = 20
): Promise<ActorRef<CheckoutContext, CheckoutCommand> | undefined> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const ref = await lookup();
    if (ref) {
      return ref;
    }

    await wait(25);
  }

  return undefined;
}

function createInMemoryCheckoutRuntimeHarness(): CheckoutRuntimeHarness {
  const network = createInMemoryMessageTransportNetwork();
  const localTransport = network.createTransport(LOCAL_NODE);
  const remoteTransport = network.createTransport(REMOTE_NODE);
  const localSystem = createActorSystem({
    nodeAddress: LOCAL_NODE,
    transport: localTransport,
  });
  const remoteSystem = createActorSystem({
    nodeAddress: REMOTE_NODE,
    transport: remoteTransport,
  });

  return createHarnessSource(
    async ({ setSource }) => {
      await Promise.all([localSystem.start(), remoteSystem.start()]);
      await remoteSystem.spawn(createCheckoutBehavior(), {
        id: REMOTE_ACTOR_ID,
      });

      await localSystem.join([REMOTE_NODE]);

      const remoteRef = await localSystem.lookup<CheckoutContext, CheckoutCommand>(
        REMOTE_ADDRESS.path
      );
      if (!remoteRef) {
        throw new Error(`Unable to resolve remote actor ${REMOTE_ADDRESS.path}`);
      }

      const source = createIgniteActorSource<CheckoutContext, CheckoutCommand, CheckoutEvent>(
        remoteRef
      );
      setSource(source);
    },
    async () => {
      await Promise.allSettled([localSystem.stop(), remoteSystem.stop()]);
    },
    async () => {
      await remoteSystem.flush();
      await localSystem.flush();
    }
  );
}

function createServiceWorkerCheckoutRuntimeHarness(): CheckoutRuntimeHarness {
  const transport = createBrowserServiceWorkerTransport();
  const localSystem = createActorSystem({
    nodeAddress: LOCAL_NODE,
    transport,
  });

  return createHarnessSource(
    async ({
      setSnapshot,
      setTransportStatus,
      notifySnapshots,
      notifyTransportStatus,
      setSource,
    }) => {
      setTransportStatus({
        state: 'replaying',
        updatedAt: Date.now(),
        reason: 'Starting service worker runtime',
      });
      notifyTransportStatus();
      setSnapshot(createPlaceholderSnapshot());
      notifySnapshots();

      await transport.ready();
      await localSystem.start();
      await localSystem.join([serviceWorkerRemoteNode()]);

      const remoteRef = await waitForRemoteRef(() =>
        localSystem.lookup<CheckoutContext, CheckoutCommand>(REMOTE_ADDRESS.path)
      );
      if (!remoteRef) {
        throw new Error(
          `Unable to resolve remote actor ${REMOTE_ADDRESS.path} through service worker`
        );
      }

      const source = createIgniteActorSource<CheckoutContext, CheckoutCommand, CheckoutEvent>(
        remoteRef
      );
      setSource(source);
    },
    async () => {
      await Promise.allSettled([localSystem.stop(), transport.destroy()]);
    }
  );
}

export function createCheckoutRuntimeHarness(): CheckoutRuntimeHarness {
  if (serviceWorkerRuntimeAvailable()) {
    return createServiceWorkerCheckoutRuntimeHarness();
  }

  return createInMemoryCheckoutRuntimeHarness();
}
