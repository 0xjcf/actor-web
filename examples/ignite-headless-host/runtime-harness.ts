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
import type { ShipmentCommand, ShipmentContext, ShipmentEvent } from './logistics-contract';
import { createRoutingBehavior } from './logistics-routing-behavior';
import { createShipmentBehavior } from './logistics-shipment-behavior';
import { createPlaceholderSnapshot, normalizeShipmentSnapshot } from './logistics-snapshots';
import { logistics } from './logistics-topology';
import {
  configuredGatewayUrl,
  createConfiguredLogisticsServerGatewayRuntimeHarness,
  createLogisticsServerGatewayRuntimeHarness,
  type GatewaySocket,
  serverGatewayRuntimeAvailable,
} from './server-gateway-client';

export type { ShipmentCommand, ShipmentContext, ShipmentEvent } from './logistics-contract';

export interface LogisticsRuntimeHarness {
  readonly source: IgniteActorSource<ShipmentContext, ShipmentCommand, ShipmentEvent>;
  readonly routingSource?: IgniteActorSource<ShipmentContext, ShipmentCommand, ShipmentEvent>;
  destroy(): Promise<void>;
}

export interface ServerWorkerDemoRuntimeHarnessOptions {
  gatewayUrl: string;
  transportUrl: string;
  createGatewaySocket?: (url: string) => GatewaySocket;
  createWorkerSocket?: (url: string) => WebSocket;
}

const browserNode = logistics.nodes.browser.address;
const serverNode = logistics.nodes.server.address;
const workerNode = logistics.nodes.worker.address;
const shipmentActor = logistics.actors.shipment;
const routingActor = logistics.actors.routing;

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
            'PROVIDER_SIGNAL_RECORDED',
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
      address: shipmentActor.address,
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
  const localTransport = network.createTransport(browserNode);
  const remoteTransport = network.createTransport(serverNode);
  const localSystem = createActorSystem({
    nodeAddress: browserNode,
    transport: localTransport,
  });
  const remoteSystem = createActorSystem({
    nodeAddress: serverNode,
    transport: remoteTransport,
  });

  return createHarnessSource(
    async ({ setSource }) => {
      await Promise.all([localSystem.start(), remoteSystem.start()]);
      await remoteSystem.spawn(createShipmentBehavior(), {
        id: shipmentActor.id,
      });

      await localSystem.join([serverNode]);

      const remoteRef = await localSystem.lookup<ShipmentContext, ShipmentCommand>(
        shipmentActor.address.path
      );
      if (!remoteRef) {
        throw new Error(`Unable to resolve remote actor ${shipmentActor.address.path}`);
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
    nodeAddress: browserNode,
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
        localSystem.lookup<ShipmentContext, ShipmentCommand>(shipmentActor.address.path)
      );
      if (!remoteRef) {
        throw new Error(
          `Unable to resolve remote actor ${shipmentActor.address.path} through service worker`
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
  const routingGatewayHarness = createLogisticsServerGatewayRuntimeHarness({
    url: options.gatewayUrl,
    streamId: 'logistics-routing',
    scope: routingActor.gateway?.scope,
    ...(options.createGatewaySocket ? { createSocket: options.createGatewaySocket } : {}),
  });
  const workerRuntime =
    options.createWorkerSocket || typeof Worker === 'undefined'
      ? createInProcessWorkerRuntime(options)
      : createWebWorkerRuntime(options.transportUrl);

  return {
    source: gatewayHarness.source,
    routingSource: routingGatewayHarness.source,
    async destroy(): Promise<void> {
      await Promise.allSettled([
        gatewayHarness.destroy(),
        routingGatewayHarness.destroy(),
        workerRuntime.destroy(),
      ]);
    },
  };
}

function createInProcessWorkerRuntime(options: ServerWorkerDemoRuntimeHarnessOptions): {
  destroy(): Promise<void>;
} {
  const workerTransport = createBrowserWebSocketMessageTransport({
    nodeAddress: workerNode,
    incarnation: `${workerNode}-demo`,
    heartbeatIntervalMs: 0,
    peers: {
      [serverNode]: options.transportUrl,
    },
    ...(options.createWorkerSocket ? { webSocketFactory: options.createWorkerSocket } : {}),
  });
  const workerSystem = createActorSystem({
    nodeAddress: workerNode,
    transport: workerTransport,
  });
  const workerReady = (async () => {
    await workerSystem.start();
    await workerSystem.spawn(createRoutingBehavior(), {
      id: routingActor.id,
    });
    await workerSystem.join([serverNode]);
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
