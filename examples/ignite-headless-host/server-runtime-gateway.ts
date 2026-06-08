/// <reference types="node" />

import { timingSafeEqual } from 'node:crypto';
import type {
  ActorRef,
  ActorTransitionErrorValue,
  RuntimePeerStatus,
  RuntimeTransportStats,
  RuntimeTransportTelemetryObserver,
} from '@actor-web/runtime';
import {
  type ServedActorWebHttp,
  type ServedActorWebNode,
  serveActorWebHttp,
  serveActorWebNode,
} from '@actor-web/runtime/node';
import type {
  DispatcherCommand,
  DispatcherContext,
  DriverDirectoryCommand,
  DriverDirectoryContext,
  LogisticsSupervisorCommand,
  LogisticsSupervisorContext,
  ProviderHqCommand,
  ProviderHqContext,
  ProviderHqEvent,
  ProviderRuntimeCommand,
  ProviderRuntimeSource,
  ProviderShipmentCommand,
  ProviderShipmentSignalResult,
  ProviderSignal,
  ProviderSignalSourceLabel,
  RoutePlan,
  ShipmentCommand,
  ShipmentContext,
  ShipmentEvent,
} from './logistics-contract';
import { isProviderHqEvent, isShipmentEvent } from './logistics-contract';
import {
  isProviderSignal,
  type LifecycleMode,
  resolveProviderSourceLabel,
  shouldReturnShipment,
} from './logistics-provider-hq';
import {
  createProviderShipmentSignalRejection,
  isTransitionError,
} from './logistics-provider-shipment-behavior';
import {
  createDispatchShipmentCommand,
  createDriverAssignmentCommand,
  createProviderSignalPlan,
  createProviderSyncPlan,
  createRouteAssignmentRecordCommand,
  createRoutePlanCommand,
  createShipmentLifecyclePlan,
} from './logistics-runtime-plans';
import { logistics } from './logistics-topology';

const shipmentActorDescriptor = logistics.actors.shipment;
const routingActorDescriptor = logistics.actors.routing;
const providerHqActorDescriptor = logistics.actors.providerHq;
const providerRuntimeActorDescriptor = logistics.actors.providerRuntime;
const logisticsSupervisorActorDescriptor = logistics.actors.logisticsSupervisor;
const dispatcherActorDescriptor = logistics.actors.dispatcher;
const driverDirectoryActorDescriptor = logistics.actors.driverDirectory;
const serviceWorkerProofActorDescriptor = logistics.actors.serviceWorkerProof;
const serverNode = logistics.nodes.server.address;
const workerNode = logistics.nodes.worker.address;
const providerNode = logistics.nodes.provider.address;
const serviceWorkerNode = logistics.nodes.serviceWorker.address;

export interface LogisticsRuntimeGatewayServerOptions {
  host?: string;
  port?: number;
  transportPort?: number;
  restPort?: number;
  lifecycleMode?: LifecycleMode;
  lifecycleLabelDelayMs?: number;
  lifecyclePackedDelayMs?: number;
  lifecycleShippedDelayMs?: number;
  lifecycleTerminalDelayMs?: number;
  providerRuntimeEnabled?: boolean;
  providerRuntimeSource?: ProviderRuntimeSource;
  runtimeAuthToken?: string;
  gatewayAuthToken?: string;
  outboundQueueLimit?: number;
  transportTelemetry?: RuntimeTransportTelemetryObserver;
}

interface LogisticsRuntimeIdempotencyStatusResponse {
  readonly windowSize: number;
  readonly duplicateFramesDropped: number;
  readonly providerEnabled: boolean;
  readonly providerClaimCount: number;
  readonly providerDuplicateCount: number;
  readonly providerErrorCount: number;
  readonly lastProviderErrorAt?: string;
  readonly lastProviderErrorMessage?: string;
}

interface LogisticsRuntimePeerStatusResponse extends RuntimePeerStatus {
  readonly idempotency: LogisticsRuntimeIdempotencyStatusResponse;
  readonly outboundQueueDepth?: number;
  readonly outboundQueueLimit?: number;
  readonly outboundFramesDropped?: number;
  readonly backpressureDropCount?: number;
  readonly handshakeAcceptedCount?: number;
  readonly handshakeRejectedCount?: number;
  readonly reconnectCount?: number;
}

interface LogisticsRuntimeTransportTelemetryStatusResponse {
  readonly outboundQueueDepth: number;
  readonly outboundQueueLimit: number;
  readonly outboundFramesDropped: number;
  readonly backpressureDropCount: number;
  readonly duplicateFramesDropped: number;
  readonly handshakeAcceptedCount: number;
  readonly handshakeRejectedCount: number;
  readonly reconnectCount: number;
}

export interface LogisticsRuntimeGatewayServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  getGatewayUrl(): string | null;
  getTransportUrl(): string | null;
  getRestUrl(): string | null;
}

function createShipmentId(): string {
  return `shipment-${Date.now().toString(36)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bodyRecord(body: unknown): Record<string, unknown> {
  return isRecord(body) ? body : {};
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function normalizeIdempotencyStatus(
  status: RuntimePeerStatus['idempotency'],
  duplicateFramesDropped: number
): LogisticsRuntimeIdempotencyStatusResponse {
  return {
    ...status,
    duplicateFramesDropped,
  };
}

function normalizePeerStatus(
  peer: RuntimePeerStatus,
  transportStats?: RuntimeTransportStats
): LogisticsRuntimePeerStatusResponse {
  const peerStats = transportStats?.peers[peer.nodeAddress];
  return {
    ...peer,
    idempotency: normalizeIdempotencyStatus(
      peer.idempotency,
      peerStats?.duplicateFramesDropped ?? 0
    ),
    ...(peerStats
      ? {
          outboundQueueDepth: peerStats.outboundQueueDepth,
          outboundQueueLimit: peerStats.outboundQueueLimit,
          outboundFramesDropped: peerStats.outboundFramesDropped,
          backpressureDropCount: peerStats.backpressureDropCount,
          handshakeAcceptedCount: peerStats.handshakeAcceptedCount,
          handshakeRejectedCount: peerStats.handshakeRejectedCount,
          reconnectCount: peerStats.reconnectCount,
        }
      : {}),
  };
}

function readTransportStats(transport: unknown): RuntimeTransportStats | undefined {
  if (
    typeof transport !== 'object' ||
    transport === null ||
    !('getStats' in transport) ||
    typeof transport.getStats !== 'function'
  ) {
    return undefined;
  }

  return transport.getStats();
}

function createSharedSecretAuth(token: string | undefined, rejectionReason: string) {
  if (!token) {
    return undefined;
  }

  const expectedToken = Buffer.from(token, 'utf8');

  return {
    token,
    verifyToken: ({ token: presentedToken }: { readonly token?: string }) => {
      if (typeof presentedToken !== 'string') {
        return {
          ok: false as const,
          reason: rejectionReason,
        };
      }

      const candidateToken = Buffer.from(presentedToken, 'utf8');
      if (candidateToken.length !== expectedToken.length) {
        return {
          ok: false as const,
          reason: rejectionReason,
        };
      }

      return (
        timingSafeEqual(candidateToken, expectedToken) || {
          ok: false as const,
          reason: rejectionReason,
        }
      );
    },
  };
}

function readTransportTelemetryStatus(
  transportStats?: RuntimeTransportStats
): LogisticsRuntimeTransportTelemetryStatusResponse {
  return {
    outboundQueueDepth: transportStats?.outboundQueueDepth ?? 0,
    outboundQueueLimit: transportStats?.outboundQueueLimit ?? 0,
    outboundFramesDropped: transportStats?.outboundFramesDropped ?? 0,
    backpressureDropCount: transportStats?.backpressureDropCount ?? 0,
    duplicateFramesDropped: transportStats?.duplicateFramesDropped ?? 0,
    handshakeAcceptedCount: transportStats?.handshakeAcceptedCount ?? 0,
    handshakeRejectedCount: transportStats?.handshakeRejectedCount ?? 0,
    reconnectCount: transportStats?.reconnectCount ?? 0,
  };
}

export function createLogisticsRuntimeGatewayServer(
  options: LogisticsRuntimeGatewayServerOptions = {}
): LogisticsRuntimeGatewayServer {
  let lifecycleMode = options.lifecycleMode ?? 'simulation';
  const providerRuntimeEnabled = options.providerRuntimeEnabled ?? false;
  const providerRuntimeSource = options.providerRuntimeSource ?? 'embedded';
  const lifecycleLabelDelayMs = options.lifecycleLabelDelayMs ?? 2_000;
  const lifecyclePackedDelayMs = options.lifecyclePackedDelayMs ?? 6_000;
  const lifecycleShippedDelayMs = options.lifecycleShippedDelayMs ?? 10_000;
  const lifecycleTerminalDelayMs = options.lifecycleTerminalDelayMs ?? 20_000;
  let servedNode: ServedActorWebNode<typeof logistics> | null = null;
  let shipmentActor: ActorRef<ShipmentContext, ShipmentCommand> | null = null;
  let logisticsSupervisorActor: ActorRef<
    LogisticsSupervisorContext,
    LogisticsSupervisorCommand
  > | null = null;
  let dispatcherActor: ActorRef<DispatcherContext, DispatcherCommand> | null = null;
  let driverDirectoryActor: ActorRef<DriverDirectoryContext, DriverDirectoryCommand> | null = null;
  let providerHqActor: ActorRef<ProviderHqContext, ProviderHqCommand> | null = null;
  const shipmentActors = new Map<string, ActorRef<ShipmentContext, ShipmentCommand>>();
  const providerShipmentActors = new Map<string, ActorRef<unknown, ProviderShipmentCommand>>();
  let restServer: ServedActorWebHttp | null = null;
  let restUrl: string | null = null;
  const lifecycleTimers = new Set<ReturnType<typeof setTimeout>>();
  const runtimeUnsubscribers = new Set<() => void>();
  const shipmentLifecycleUnsubscribers = new Map<string, Set<() => void>>();

  const providerSourceLabel = (): ProviderSignalSourceLabel =>
    resolveProviderSourceLabel({
      mode: lifecycleMode,
      runtimeSource: providerRuntimeEnabled ? providerRuntimeSource : 'embedded',
    });

  const providerSignalChannelLabel = (): string =>
    lifecycleMode === 'manual'
      ? 'manual UI -> server runtime -> gateway WS'
      : providerRuntimeEnabled
        ? providerRuntimeSource === 'container'
          ? 'provider container -> Actor-Web transport -> server runtime -> gateway WS'
          : 'simulator process -> Actor-Web transport -> server runtime -> gateway WS'
        : 'simulator process -> server runtime -> gateway WS';

  const system = () => {
    if (!servedNode) {
      throw new Error('Actor-Web server node is not ready.');
    }

    return servedNode.system;
  };

  const transport = () => {
    if (!servedNode) {
      throw new Error('Actor-Web server node is not ready.');
    }

    return servedNode.transport;
  };

  const clearLifecycleTimers = (): void => {
    for (const timer of Array.from(lifecycleTimers)) {
      clearTimeout(timer);
      lifecycleTimers.delete(timer);
    }
  };

  const scheduleLifecycleUpdate = (
    delayMs: number,
    signal: ProviderSignal,
    expectedShipmentId: string
  ): void => {
    const timer = setTimeout(() => {
      lifecycleTimers.delete(timer);
      const activeShipmentId = shipmentActor?.getSnapshot().context.shipmentId;
      if (activeShipmentId !== expectedShipmentId) {
        return;
      }

      void applyProviderSignal({
        shipmentId: expectedShipmentId,
        signal,
        clearLifecycleTimers: false,
      });
    }, delayMs);
    lifecycleTimers.add(timer);
  };

  const projectShipment = async (
    shipment: ShipmentContext,
    event?: ShipmentEvent
  ): Promise<void> => {
    await shipmentActor?.send({
      type: 'UPSERT_SHIPMENT_PROJECTION',
      shipment,
      event,
    });
    await syncShipmentToProviderHq(shipment);
  };

  const trackShipmentLifecycleUnsubscriber = (
    shipmentId: string,
    unsubscribe: () => void
  ): void => {
    const existing = shipmentLifecycleUnsubscribers.get(shipmentId);
    if (existing) {
      existing.add(unsubscribe);
      return;
    }

    shipmentLifecycleUnsubscribers.set(shipmentId, new Set([unsubscribe]));
  };

  const cleanupShipmentLifecycleSubscriptions = (shipmentId: string): void => {
    const unsubscribers = shipmentLifecycleUnsubscribers.get(shipmentId);
    if (!unsubscribers) {
      return;
    }

    for (const unsubscribe of Array.from(unsubscribers)) {
      unsubscribe();
      unsubscribers.delete(unsubscribe);
    }

    shipmentLifecycleUnsubscribers.delete(shipmentId);
  };

  const ensureShipmentActor = async (
    shipmentId: string
  ): Promise<ActorRef<ShipmentContext, ShipmentCommand>> => {
    const existing = shipmentActors.get(shipmentId);
    if (existing) {
      return existing;
    }

    if (!servedNode) {
      throw new Error('Actor-Web server node is not ready.');
    }

    const actorRef = await servedNode.actors.shipmentLifecycle.instance({ shipmentId });
    shipmentActors.set(shipmentId, actorRef);

    const unsubscribeSnapshot = actorRef.subscribeSnapshot?.((snapshot) => {
      if (!snapshot.context.shipmentId) {
        return;
      }
      if (shipmentActors.get(snapshot.context.shipmentId) !== actorRef) {
        return;
      }

      void projectShipment(snapshot.context);
    });
    if (unsubscribeSnapshot) {
      trackShipmentLifecycleUnsubscriber(shipmentId, unsubscribeSnapshot);
    }

    const unsubscribeEvents = actorRef.subscribeEvent?.((event) => {
      if (!isShipmentEvent(event)) {
        return;
      }

      const context = actorRef.getSnapshot().context;
      if (!context.shipmentId) {
        return;
      }
      if (shipmentActors.get(context.shipmentId) !== actorRef) {
        return;
      }

      void projectShipment(context, event);
      if (event.type === 'SHIPMENT_CREATED') {
        void logisticsSupervisorActor?.send({
          type: 'OBSERVE_SHIPMENT_CREATED',
          shipmentId: context.shipmentId,
        });
      }
      if (event.type === 'SHIPMENT_DELIVERED' || event.type === 'SHIPMENT_RETURNED') {
        if (event.type === 'SHIPMENT_RETURNED') {
          void logisticsSupervisorActor?.send({
            type: 'OBSERVE_SHIPMENT_EXCEPTION',
            shipmentId: context.shipmentId,
            reason: 'Provider reported return.',
          });
        } else {
          void logisticsSupervisorActor?.send({
            type: 'OBSERVE_SHIPMENT_COMPLETED',
            shipmentId: context.shipmentId,
          });
        }
      }
    });
    if (unsubscribeEvents) {
      trackShipmentLifecycleUnsubscriber(shipmentId, unsubscribeEvents);
    }

    return actorRef;
  };

  const scheduleShipmentLifecycle = (shipmentId: string): void => {
    clearLifecycleTimers();
    const signalPlan = createShipmentLifecyclePlan({
      mode: lifecycleMode,
      shipmentId,
      delays: {
        labelMs: lifecycleLabelDelayMs,
        packedMs: lifecyclePackedDelayMs,
        shippedMs: lifecycleShippedDelayMs,
        terminalMs: lifecycleTerminalDelayMs,
      },
      terminalSignal: shouldReturnShipment(shipmentId) ? 'RETURN_EXCEPTION' : 'DELIVERY_CONFIRMED',
    });
    for (const signal of signalPlan) {
      scheduleLifecycleUpdate(signal.delayMs, signal.signal, signal.shipmentId);
    }
  };

  const ensureProviderShipmentActor = async (
    context: ShipmentContext
  ): Promise<ActorRef<unknown, ProviderShipmentCommand> | null> => {
    if (!context.shipmentId) {
      return null;
    }

    const existing = providerShipmentActors.get(context.shipmentId);
    if (existing) {
      await existing.send({ type: 'SYNC_PROVIDER_SHIPMENT', shipment: context });
      return existing;
    }

    if (!servedNode) {
      throw new Error('Actor-Web server node is not ready.');
    }

    const actorRef = await servedNode.actors.providerShipment.instance({
      shipmentId: context.shipmentId,
      shipment: context,
    });
    await actorRef.send({ type: 'SYNC_PROVIDER_SHIPMENT', shipment: context });
    providerShipmentActors.set(context.shipmentId, actorRef);
    return actorRef;
  };

  const lookupProviderRuntimeActor = async (): Promise<ActorRef<
    unknown,
    ProviderRuntimeCommand
  > | null> => {
    if (!providerRuntimeEnabled) {
      return null;
    }

    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (!transport().isConnected(providerNode)) {
        await wait(25);
        continue;
      }

      const providerRuntimeRef = await system().lookup<unknown, ProviderRuntimeCommand>(
        providerRuntimeActorDescriptor.address.path
      );
      if (providerRuntimeRef) {
        return providerRuntimeRef;
      }

      await wait(25);
    }

    return null;
  };

  const requireProviderRuntimeActor = async (): Promise<
    ActorRef<unknown, ProviderRuntimeCommand>
  > => {
    const providerRuntimeRef = await lookupProviderRuntimeActor();
    if (!providerRuntimeRef) {
      throw new Error('Provider runtime boundary is enabled but unavailable.');
    }

    return providerRuntimeRef;
  };

  const syncShipmentToProviderRuntime = async (context: ShipmentContext): Promise<void> => {
    const providerRuntimeRef = await requireProviderRuntimeActor();
    await providerRuntimeRef.send({
      type: 'SYNC_PROVIDER_RUNTIME_SHIPMENT',
      shipment: context,
    });
  };

  const syncShipmentToProviderHq = async (context: ShipmentContext): Promise<void> => {
    const plan = createProviderSyncPlan(context);
    if (plan.ensureProviderShipmentActor) {
      if (providerRuntimeEnabled) {
        await syncShipmentToProviderRuntime(context);
      } else {
        await ensureProviderShipmentActor(context);
      }
    }
    if (plan.providerHqCommand) {
      await providerHqActor?.send(plan.providerHqCommand);
    }
  };

  const applyAcceptedProviderSignalToShipment = async (
    shipment: ShipmentContext,
    signal: ProviderSignal
  ): Promise<ShipmentContext> => {
    if (!shipment.shipmentId) {
      return shipment;
    }

    const shipmentLifecycleActor = await ensureShipmentActor(shipment.shipmentId);
    await shipmentLifecycleActor.send({
      type: 'APPLY_PROVIDER_SIGNAL',
      shipmentId: shipment.shipmentId ?? undefined,
      signal,
      facility: shipment.providerFacility ?? undefined,
      loadId: shipment.providerLoadId ?? undefined,
      note: shipment.providerNote ?? undefined,
      sourceLabel: providerSourceLabel(),
      channelLabel: providerSignalChannelLabel(),
      baseContext: shipment,
    });
    await system().flush();

    return shipmentLifecycleActor.getSnapshot().context;
  };

  const processProviderSignalRequest = async (event: ProviderHqEvent): Promise<void> => {
    if (event.type !== 'PROVIDER_SIGNAL_REQUESTED' || !providerHqActor) {
      return;
    }

    const reportProviderRuntimeSignalRejected = async (reason: string): Promise<void> => {
      await providerHqActor?.send({
        type: 'REPORT_PROVIDER_SIGNAL_REJECTED',
        shipmentId: event.shipmentId,
        signal: event.signal,
        expected: 'connected provider runtime',
        reason,
      });
      await system().flush();
    };

    const providerContext = providerHqActor.getSnapshot().context;
    const shipment = providerContext.shipmentContexts[event.shipmentId];
    if (!shipment) {
      await providerHqActor.send({
        type: 'REPORT_PROVIDER_SIGNAL_REJECTED',
        shipmentId: event.shipmentId,
        signal: event.signal,
        expected: 'known provider shipment',
        reason: `${event.signal} rejected. ${event.shipmentId} is not in the Provider HQ queue.`,
      });
      return;
    }

    const signalPlan = createProviderSignalPlan({
      signal: event.signal,
      explicitShipmentId: event.shipmentId,
      facility: shipment.providerFacility ?? undefined,
      loadId: shipment.providerLoadId ?? undefined,
    });
    if (!signalPlan.ok) {
      await providerHqActor.send({
        type: 'REPORT_PROVIDER_SIGNAL_REJECTED',
        shipmentId: event.shipmentId,
        signal: event.signal,
        expected: 'known provider shipment',
        reason: signalPlan.reason,
      });
      return;
    }

    let result: ProviderShipmentSignalResult | ActorTransitionErrorValue;

    if (providerRuntimeEnabled) {
      const providerRuntimeRef = await lookupProviderRuntimeActor();
      if (!providerRuntimeRef) {
        await reportProviderRuntimeSignalRejected(
          `${event.signal} rejected. Provider runtime boundary is enabled but unavailable.`
        );
        return;
      }

      try {
        await providerRuntimeRef.send({
          type: 'SYNC_PROVIDER_RUNTIME_SHIPMENT',
          shipment,
        });
        result = await providerRuntimeRef.ask<ProviderShipmentSignalResult>(
          {
            type: 'PROCESS_PROVIDER_RUNTIME_SIGNAL',
            shipmentId: event.shipmentId,
            signal: event.signal,
            facility: signalPlan.command.facility,
            loadId: signalPlan.command.loadId,
            note: signalPlan.command.note,
          },
          1000
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await reportProviderRuntimeSignalRejected(
          `${event.signal} rejected. Provider runtime signal processing failed: ${detail}`
        );
        return;
      }
    } else {
      const providerShipmentActor = await ensureProviderShipmentActor(shipment);
      if (!providerShipmentActor) {
        await providerHqActor.send({
          type: 'REPORT_PROVIDER_SIGNAL_REJECTED',
          shipmentId: event.shipmentId,
          signal: event.signal,
          expected: 'known provider shipment',
          reason: `${event.signal} rejected. Provider shipment actor is not ready.`,
        });
        return;
      }

      result = await providerShipmentActor.ask<
        ProviderShipmentSignalResult | ActorTransitionErrorValue
      >(signalPlan.command, 1000);
    }

    if (isTransitionError(result)) {
      const rejected = createProviderShipmentSignalRejection(shipment, event.signal);
      await providerHqActor.send({ type: 'REPORT_PROVIDER_SIGNAL_REJECTED', ...rejected });
      await system().flush();
      return;
    }

    if (!result.ok) {
      await providerHqActor.send({ type: 'REPORT_PROVIDER_SIGNAL_REJECTED', ...result });
      await system().flush();
      return;
    }

    const updatedShipment = await applyAcceptedProviderSignalToShipment(
      result.shipment,
      event.signal
    );
    if (providerRuntimeEnabled) {
      const providerRuntimeRef = await lookupProviderRuntimeActor();
      await providerRuntimeRef?.send({
        type: 'SYNC_PROVIDER_RUNTIME_SHIPMENT',
        shipment: updatedShipment,
      });
    } else {
      const providerShipmentActor = await ensureProviderShipmentActor(updatedShipment);
      await providerShipmentActor?.send({
        type: 'SYNC_PROVIDER_SHIPMENT',
        shipment: updatedShipment,
      });
    }
    await providerHqActor.send({
      type: 'REPORT_PROVIDER_SIGNAL_ACCEPTED',
      shipment: updatedShipment,
      signal: event.signal,
    });
    await system().flush();
  };

  const bindRuntimeOrchestration = (): void => {
    if (!shipmentActor || !providerHqActor || runtimeUnsubscribers.size > 0) {
      return;
    }

    const unsubscribeShipmentSnapshot = shipmentActor.subscribeSnapshot?.((snapshot) => {
      const context = snapshot.context;
      if (!context.shipmentId) {
        return;
      }

      void syncShipmentToProviderHq(context).catch((error) => {
        console.error(error);
      });
    });
    if (unsubscribeShipmentSnapshot) {
      runtimeUnsubscribers.add(unsubscribeShipmentSnapshot);
    }

    const unsubscribeShipmentEvents = shipmentActor.subscribeEvent?.((event) => {
      if (event.type === 'SHIPMENT_RESET') {
        void providerHqActor?.send({ type: 'CLEAR_PROVIDER_QUEUE' });
      }
    });
    if (unsubscribeShipmentEvents) {
      runtimeUnsubscribers.add(unsubscribeShipmentEvents);
    }

    const unsubscribeProviderEvents = providerHqActor.subscribeEvent?.((event) => {
      if (!isProviderHqEvent(event)) {
        return;
      }

      if (event.type === 'PROVIDER_MODE_CHANGED') {
        lifecycleMode = event.mode;
        void providerHqActor?.send({
          type: 'SET_PROVIDER_SOURCE_LABEL',
          sourceLabel: providerSourceLabel(),
        });
        clearLifecycleTimers();
        if (event.mode === 'simulation') {
          const activeShipmentId = selectedProviderShipmentId();
          if (activeShipmentId) {
            scheduleShipmentLifecycle(activeShipmentId);
          }
        }
      }

      void processProviderSignalRequest(event).catch((error) => {
        console.error(error);
      });
    });
    if (unsubscribeProviderEvents) {
      runtimeUnsubscribers.add(unsubscribeProviderEvents);
    }
  };

  const unbindRuntimeOrchestration = (): void => {
    for (const unsubscribe of Array.from(runtimeUnsubscribers)) {
      unsubscribe();
      runtimeUnsubscribers.delete(unsubscribe);
    }
  };

  const selectedProviderShipmentId = (): string | null =>
    providerHqActor?.getSnapshot().context.selectedShipmentId ?? null;

  const providerStatus = () => {
    return providerHqActor?.getSnapshot().context.status ?? null;
  };

  const syncProviderSourceStatus = async (): Promise<void> => {
    await providerHqActor?.send({
      type: 'SET_PROVIDER_SOURCE_LABEL',
      sourceLabel: providerSourceLabel(),
    });
  };

  const setLifecycleMode = async (nextMode: LifecycleMode): Promise<void> => {
    lifecycleMode = nextMode;
    clearLifecycleTimers();
    await providerHqActor?.send({ type: 'SET_PROVIDER_MODE', mode: nextMode });
    await syncProviderSourceStatus();
  };

  const applyProviderSignal = async (input: {
    shipmentId?: string;
    signal: ProviderSignal;
    facility?: string;
    loadId?: string;
    note?: string;
    clearLifecycleTimers?: boolean;
  }): Promise<ProviderHqContext> => {
    if (!providerHqActor) {
      throw new Error('Provider HQ actor is not ready.');
    }

    if (input.clearLifecycleTimers !== false) {
      clearLifecycleTimers();
    }
    const plan = createProviderSignalPlan({
      signal: input.signal,
      explicitShipmentId: input.shipmentId,
      selectedShipmentId: providerHqActor.getSnapshot().context.selectedShipmentId,
      activeShipmentId: shipmentActor?.getSnapshot().context.shipmentId,
      facility: input.facility,
      loadId: input.loadId,
      note: input.note,
    });
    if (!plan.ok) {
      throw new Error(plan.reason);
    }

    await providerHqActor.send(plan.command);
    await system().flush();

    return providerHqActor.getSnapshot().context;
  };

  const planRouteForShipment = async (input: {
    shipmentId: string;
    destination: string;
    reference?: string;
  }): Promise<RoutePlan | null> => {
    try {
      for (let attempt = 0; !transport().isConnected(workerNode) && attempt < 40; attempt += 1) {
        await wait(25);
      }

      if (!transport().isConnected(workerNode)) {
        return null;
      }

      await system().join([workerNode]);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const routingRef = await system().lookup<unknown, ShipmentCommand>(
          routingActorDescriptor.address.path
        );
        if (routingRef) {
          return await routingRef.ask<RoutePlan>(createRoutePlanCommand(input), 1000);
        }

        await wait(25);
      }

      return null;
    } catch {
      return null;
    }
  };

  const createShipment = async (input: {
    shipmentId?: string;
    destination: string;
    reference?: string;
  }): Promise<{ shipmentId: string; status: ShipmentContext['status'] }> => {
    if (providerRuntimeEnabled) {
      await requireProviderRuntimeActor();
    }

    const shipmentId = input.shipmentId ?? createShipmentId();
    const shipmentLifecycleActor = await ensureShipmentActor(shipmentId);
    await shipmentLifecycleActor.send({
      type: 'CREATE_SHIPMENT',
      shipmentId,
      destination: input.destination,
      reference: input.reference,
    });
    await system().flush();
    await dispatcherActor?.send(createDispatchShipmentCommand({ ...input, shipmentId }));

    const plan = await planRouteForShipment({
      shipmentId,
      destination: input.destination,
      reference: input.reference,
    });
    if (plan) {
      const driverAssignment = driverDirectoryActor
        ? await driverDirectoryActor.ask<{ driverId: string }>(
            createDriverAssignmentCommand({
              shipmentId,
              plan,
              destination: input.destination,
            }),
            1000
          )
        : { driverId: 'driver-unassigned' };
      await dispatcherActor?.send(
        createRouteAssignmentRecordCommand({
          plan,
          driverId: driverAssignment.driverId,
        })
      );
      await shipmentLifecycleActor.send({ type: 'ASSIGN_ROUTE', plan });
      await system().flush();
      scheduleShipmentLifecycle(shipmentId);
    }

    return { shipmentId, status: plan ? 'route-assigned' : 'route-requested' };
  };

  const serveRest = async (runtime: ServedActorWebNode<typeof logistics>): Promise<void> => {
    const resetCurrentShipment = async (): Promise<{ status: 'idle' }> => {
      clearLifecycleTimers();
      const activeShipmentActorEntries = Array.from(shipmentActors.entries());
      const activeProviderShipmentActors = Array.from(providerShipmentActors.values());
      shipmentActors.clear();
      providerShipmentActors.clear();
      if (providerRuntimeEnabled) {
        const providerRuntimeRef = await lookupProviderRuntimeActor();
        await providerRuntimeRef?.send({ type: 'RESET_PROVIDER_RUNTIME' });
      }
      await providerHqActor?.send({ type: 'CLEAR_PROVIDER_QUEUE' });
      await shipmentActor?.send({ type: 'RESET_SHIPMENT' });
      await system().flush();
      for (const [shipmentId, actorRef] of activeShipmentActorEntries) {
        cleanupShipmentLifecycleSubscriptions(shipmentId);
        await actorRef.stop();
      }
      for (const actorRef of activeProviderShipmentActors) {
        await actorRef.stop();
      }
      return { status: 'idle' };
    };

    restServer = await serveActorWebHttp(runtime)
      .for(shipmentActorDescriptor)
      .post('/shipments', async (request, response) => {
        const body = bodyRecord(request.body);
        const destination = typeof body.destination === 'string' ? body.destination.trim() : '';
        if (destination.length === 0) {
          return response.badRequest({ error: 'destination is required' });
        }

        const result = await createShipment({
          shipmentId: typeof body.shipmentId === 'string' ? body.shipmentId : undefined,
          destination,
          reference: typeof body.reference === 'string' ? body.reference : undefined,
        });
        return response.accepted(result);
      })
      .post('/shipments/current/reset', async (_request, response) => {
        return response.accepted(await resetCurrentShipment());
      })
      .post('/shipments/:id/reset', async (_request, response) => {
        return response.accepted(await resetCurrentShipment());
      })
      .get('/shipments/current', (_request, response) => {
        return response.ok(shipmentActor?.getSnapshot().context ?? null);
      })
      .get('/shipments/count', async (_request, response, actorWeb) => {
        const count = await actorWeb.actor.ask<number>({ type: 'GET_SHIPMENT_COUNT' });
        return response.ok({ count });
      })
      .get('/provider/status', (_request, response) => {
        return response.ok(providerStatus());
      })
      .post('/provider/mode', async (request, response) => {
        const body = bodyRecord(request.body);
        if (body.mode !== 'simulation' && body.mode !== 'manual') {
          return response.badRequest({ error: 'provider mode must be simulation or manual' });
        }

        await setLifecycleMode(body.mode);
        return response.accepted(providerStatus());
      })
      .post('/provider/signals', async (request, response) => {
        const body = bodyRecord(request.body);
        if (!isProviderSignal(body.signal)) {
          return response.badRequest({ error: 'provider signal is required' });
        }

        await applyProviderSignal({
          shipmentId:
            typeof body.shipmentId === 'string'
              ? body.shipmentId
              : (selectedProviderShipmentId() ?? undefined),
          signal: body.signal,
          facility: typeof body.facility === 'string' ? body.facility : undefined,
          loadId: typeof body.loadId === 'string' ? body.loadId : undefined,
          note: typeof body.note === 'string' ? body.note : undefined,
        });
        return response.accepted(providerStatus());
      })
      .get('/runtime/status', (_request, response, actorWeb) => {
        const transportStatus = actorWeb.runtime.getTransportStatus();
        const transportStats = readTransportStats(transport());
        const peers = transportStatus.peers.map((peer) =>
          normalizePeerStatus(peer, transportStats)
        );
        const workerPeer = normalizePeerStatus(
          actorWeb.runtime.getPeerStatus(workerNode),
          transportStats
        );
        const providerPeer = normalizePeerStatus(
          actorWeb.runtime.getPeerStatus(providerNode),
          transportStats
        );
        return response.ok({
          gatewayUrl: actorWeb.runtime.getGatewayUrl(),
          transportUrl: actorWeb.runtime.getTransportUrl(),
          lifecycleMode,
          provider: {
            runtimeEnabled: providerRuntimeEnabled,
            runtimeSource: providerRuntimeSource,
            sourceLabel: providerSourceLabel(),
          },
          transport: {
            connectedNodes: transportStatus.connectedNodes,
            peers,
            telemetry: readTransportTelemetryStatus(transportStats),
            idempotency: normalizeIdempotencyStatus(
              transportStatus.idempotency ?? {
                windowSize: 0,
                providerEnabled: false,
                providerClaimCount: 0,
                providerDuplicateCount: 0,
                providerErrorCount: 0,
              },
              transportStats?.duplicateFramesDropped ?? 0
            ),
            workerConnected: workerPeer.connected,
            workerPeerFresh: workerPeer.fresh,
            workerPeer,
            providerConnected: providerPeer.connected,
            providerPeerFresh: providerPeer.fresh,
            providerPeer,
          },
          nodes: {
            browserHost: 'thin Ignite host',
            serverRuntime: serverNode,
            workerRuntime: workerNode,
            providerRuntime: providerNode,
            serviceWorkerRuntime: serviceWorkerNode,
          },
          actors: {
            shipment: shipmentActorDescriptor.address.path,
            routing: routingActorDescriptor.address.path,
            providerHq: providerHqActorDescriptor.address.path,
            providerRuntime: providerRuntimeActorDescriptor.address.path,
            logisticsSupervisor: logisticsSupervisorActorDescriptor.address.path,
            dispatcher: dispatcherActorDescriptor.address.path,
            driverDirectory: driverDirectoryActorDescriptor.address.path,
            serviceWorkerProof: serviceWorkerProofActorDescriptor.address.path,
          },
        });
      })
      .listen({
        host: options.host ?? '127.0.0.1',
        port: options.restPort ?? 0,
      });
    restUrl = restServer.url;
  };

  return {
    async start(): Promise<void> {
      if (servedNode) {
        return;
      }

      servedNode = await serveActorWebNode(logistics, {
        node: 'server',
        host: options.host ?? '127.0.0.1',
        transport: {
          listen: {
            host: options.host ?? '127.0.0.1',
            port: options.transportPort ?? 0,
          },
          ...(options.outboundQueueLimit !== undefined
            ? { outboundQueueLimit: options.outboundQueueLimit }
            : {}),
          ...(options.runtimeAuthToken
            ? {
                auth: createSharedSecretAuth(
                  options.runtimeAuthToken,
                  'Shared runtime secret rejected.'
                ),
              }
            : {}),
          ...(options.transportTelemetry ? { telemetry: options.transportTelemetry } : {}),
        },
        gateway: {
          host: options.host ?? '127.0.0.1',
          port: options.port ?? 0,
          ...(options.gatewayAuthToken
            ? {
                auth: createSharedSecretAuth(
                  options.gatewayAuthToken,
                  'Gateway authentication rejected.'
                ),
              }
            : {}),
        },
      });
      shipmentActor = servedNode.requireActor('shipment');
      logisticsSupervisorActor = servedNode.requireActor('logisticsSupervisor');
      dispatcherActor = servedNode.requireActor('dispatcher');
      driverDirectoryActor = servedNode.requireActor('driverDirectory');
      providerHqActor = servedNode.requireActor('providerHq');
      bindRuntimeOrchestration();
      await providerHqActor.send({ type: 'SET_PROVIDER_MODE', mode: lifecycleMode });
      await syncProviderSourceStatus();

      await serveRest(servedNode);
    },
    async stop(): Promise<void> {
      const activeServedNode = servedNode;
      const activeRestServer = restServer;
      servedNode = null;
      restServer = null;
      restUrl = null;
      shipmentActor = null;
      logisticsSupervisorActor = null;
      dispatcherActor = null;
      driverDirectoryActor = null;
      providerHqActor = null;
      shipmentActors.clear();
      providerShipmentActors.clear();
      for (const shipmentId of Array.from(shipmentLifecycleUnsubscribers.keys())) {
        cleanupShipmentLifecycleSubscriptions(shipmentId);
      }
      clearLifecycleTimers();
      unbindRuntimeOrchestration();

      if (activeRestServer) {
        await activeRestServer.stop();
      }

      await activeServedNode?.stop();
    },
    getGatewayUrl(): string | null {
      return servedNode?.getGatewayUrl() ?? null;
    },
    getTransportUrl(): string | null {
      return servedNode?.getTransportUrl() ?? null;
    },
    getRestUrl(): string | null {
      return restUrl;
    },
  };
}
