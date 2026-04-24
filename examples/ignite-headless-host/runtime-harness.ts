import {
  type ActorRef,
  createActorSystem,
  createBrowserWebSocketMessageTransport,
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
  createPlaceholderSnapshot,
  createRoutingBehavior,
  createShipmentBehavior,
  LOCAL_NODE,
  normalizeShipmentSnapshot,
  REMOTE_ACTOR_ID,
  REMOTE_ADDRESS,
  REMOTE_NODE,
  type ShipmentCommand,
  type ShipmentContext,
  type ShipmentEvent,
  WORKER_ACTOR_ID,
  WORKER_NODE,
} from './checkout-contract';
import {
  configuredGatewayUrl,
  createConfiguredLogisticsServerGatewayRuntimeHarness,
  createLogisticsServerGatewayRuntimeHarness,
  type GatewaySocket,
  serverGatewayRuntimeAvailable,
} from './server-gateway-client';

export type { ShipmentCommand, ShipmentContext, ShipmentEvent } from './checkout-contract';

export interface LogisticsRuntimeHarness {
  readonly source: IgniteActorSource<ShipmentContext, ShipmentCommand, ShipmentEvent>;
  destroy(): Promise<void>;
}

export type CheckoutRuntimeHarness = LogisticsRuntimeHarness;

export interface ServerWorkerDemoRuntimeHarnessOptions {
  gatewayUrl: string;
  transportUrl: string;
  createGatewaySocket?: (url: string) => GatewaySocket;
  createWorkerSocket?: (url: string) => WebSocket;
}

function createHarnessSource(
  startRuntime: (options: {
    setSource(source: IgniteActorSource<ShipmentContext, ShipmentCommand, ShipmentEvent>): void;
    setSnapshot(snapshot: IgniteActorSourceSnapshot<ShipmentContext>): void;
    setTransportStatus(status: ProjectionTransportStatus): void;
    notifySnapshots(): void;
    notifyTransportStatus(): void;
  }) => Promise<void>,
  destroyRuntime: () => Promise<void>,
  afterSend: () => Promise<void> = async () => {}
): LogisticsRuntimeHarness {
  let activeSource: IgniteActorSource<ShipmentContext, ShipmentCommand, ShipmentEvent> | null =
    null;
  let currentSnapshot = createPlaceholderSnapshot();
  let currentTransportStatus: ProjectionTransportStatus = {
    state: 'replaying',
    updatedAt: Date.now(),
  };
  let stopped = false;

  const snapshotListeners = new Set<
    (snapshot: IgniteActorSourceSnapshot<ShipmentContext>) => void
  >();
  const eventListeners = new Set<{
    listener: (event: IgniteActorSourceEvent<ShipmentEvent>) => void;
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
      currentSnapshot = normalizeShipmentSnapshot(source.snapshot());
      currentTransportStatus = source.transportStatus();
      notifySnapshots();
      notifyTransportStatus();

      stopRuntimeBridge = source.subscribe((snapshot) => {
        currentSnapshot = normalizeShipmentSnapshot(snapshot);
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
        {
          types: [
            'SHIPMENT_CREATED',
            'ROUTE_REQUESTED',
            'ROUTE_ASSIGNED',
            'SHIPMENT_IN_TRANSIT',
            'SHIPMENT_DELIVERED',
            'SHIPMENT_RETURNED',
            'SHIPMENT_RESET',
          ],
        }
      );

      stopTransportBridge = source.subscribeTransportStatus((status) => {
        currentTransportStatus = status;
        notifyTransportStatus();
      });
    },
    setSnapshot(snapshot) {
      currentSnapshot = normalizeShipmentSnapshot(snapshot);
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
      snapshot(): IgniteActorSourceSnapshot<ShipmentContext> {
        return currentSnapshot;
      },
      subscribe(
        listener: (snapshot: IgniteActorSourceSnapshot<ShipmentContext>) => void
      ): () => void {
        snapshotListeners.add(listener);
        listener(currentSnapshot);

        return () => {
          snapshotListeners.delete(listener);
        };
      },
      subscribeEvent(
        listener: (event: IgniteActorSourceEvent<ShipmentEvent>) => void,
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
      async send(message: ShipmentCommand): Promise<void> {
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
        message: ShipmentCommand,
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
  lookup: () => Promise<ActorRef<ShipmentContext, ShipmentCommand> | undefined>,
  attempts = 80
): Promise<ActorRef<ShipmentContext, ShipmentCommand> | undefined> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const ref = await lookup();
    if (ref) {
      return ref;
    }

    await wait(25);
  }

  return undefined;
}

function createInMemoryLogisticsRuntimeHarness(): LogisticsRuntimeHarness {
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
      await remoteSystem.spawn(createShipmentBehavior(), {
        id: REMOTE_ACTOR_ID,
      });

      await localSystem.join([REMOTE_NODE]);

      const remoteRef = await localSystem.lookup<ShipmentContext, ShipmentCommand>(
        REMOTE_ADDRESS.path
      );
      if (!remoteRef) {
        throw new Error(`Unable to resolve remote actor ${REMOTE_ADDRESS.path}`);
      }

      const source = createIgniteActorSource<ShipmentContext, ShipmentCommand, ShipmentEvent>(
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

function createServiceWorkerLogisticsRuntimeHarness(): LogisticsRuntimeHarness {
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
        localSystem.lookup<ShipmentContext, ShipmentCommand>(REMOTE_ADDRESS.path)
      );
      if (!remoteRef) {
        throw new Error(
          `Unable to resolve remote actor ${REMOTE_ADDRESS.path} through service worker`
        );
      }

      const source = createIgniteActorSource<ShipmentContext, ShipmentCommand, ShipmentEvent>(
        remoteRef
      );
      setSource(source);
    },
    async () => {
      await Promise.allSettled([localSystem.stop(), transport.destroy()]);
    }
  );
}

function configuredTransportUrl(): string | undefined {
  const configuredUrl = import.meta.env.VITE_ACTOR_WEB_TRANSPORT_URL;
  return typeof configuredUrl === 'string' && configuredUrl.trim().length > 0
    ? configuredUrl
    : undefined;
}

export function serverWorkerDemoRuntimeAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof WebSocket !== 'undefined' &&
    configuredGatewayUrl() !== undefined &&
    configuredTransportUrl() !== undefined
  );
}

export function createServerWorkerDemoRuntimeHarness(
  options: ServerWorkerDemoRuntimeHarnessOptions
): LogisticsRuntimeHarness {
  const gatewayHarness = createLogisticsServerGatewayRuntimeHarness({
    url: options.gatewayUrl,
    ...(options.createGatewaySocket ? { createSocket: options.createGatewaySocket } : {}),
  });
  const workerRuntime =
    options.createWorkerSocket || typeof Worker === 'undefined'
      ? createInProcessWorkerRuntime(options)
      : createWebWorkerRuntime(options.transportUrl);

  return {
    source: gatewayHarness.source,
    async destroy(): Promise<void> {
      await Promise.allSettled([gatewayHarness.destroy(), workerRuntime.destroy()]);
    },
  };
}

function createInProcessWorkerRuntime(options: ServerWorkerDemoRuntimeHarnessOptions): {
  destroy(): Promise<void>;
} {
  const workerTransport = createBrowserWebSocketMessageTransport({
    nodeAddress: WORKER_NODE,
    incarnation: `${WORKER_NODE}-demo`,
    heartbeatIntervalMs: 0,
    peers: {
      [REMOTE_NODE]: options.transportUrl,
    },
    ...(options.createWorkerSocket ? { webSocketFactory: options.createWorkerSocket } : {}),
  });
  const workerSystem = createActorSystem({
    nodeAddress: WORKER_NODE,
    transport: workerTransport,
  });
  const workerReady = (async () => {
    await workerSystem.start();
    await workerSystem.spawn(createRoutingBehavior(), {
      id: WORKER_ACTOR_ID,
    });
    await workerSystem.join([REMOTE_NODE]);
  })();

  return {
    async destroy(): Promise<void> {
      await Promise.allSettled([
        workerReady.then(() => workerSystem.stop()),
        workerTransport.stop(),
      ]);
    },
  };
}

function createWebWorkerRuntime(transportUrl: string): { destroy(): Promise<void> } {
  const worker = new Worker(new URL('./worker-websocket-runtime.ts', import.meta.url), {
    type: 'module',
  });
  worker.postMessage({ type: 'start', transportUrl });

  return {
    async destroy(): Promise<void> {
      worker.postMessage({ type: 'stop' });
      worker.terminate();
    },
  };
}

export function createLogisticsRuntimeHarness(): LogisticsRuntimeHarness {
  if (serverWorkerDemoRuntimeAvailable()) {
    const gatewayUrl = configuredGatewayUrl();
    const transportUrl = configuredTransportUrl();
    if (gatewayUrl && transportUrl) {
      return createServerWorkerDemoRuntimeHarness({ gatewayUrl, transportUrl });
    }
  }

  if (serverGatewayRuntimeAvailable()) {
    return createConfiguredLogisticsServerGatewayRuntimeHarness();
  }

  if (serviceWorkerRuntimeAvailable()) {
    return createServiceWorkerLogisticsRuntimeHarness();
  }

  return createInMemoryLogisticsRuntimeHarness();
}

export const createCheckoutRuntimeHarness = createLogisticsRuntimeHarness;
