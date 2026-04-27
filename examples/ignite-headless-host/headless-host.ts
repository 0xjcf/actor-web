import type {
  IgniteActorSource,
  IgniteActorSourceEvent,
  ProjectionTransportState,
} from '@actor-core/runtime/browser';
import {
  createInitialShipmentContext,
  type ShipmentCommand,
  type ShipmentContext,
  type ShipmentEvent,
} from './logistics-contract';
import { createLogisticsTopologySources } from './runtime-harness';

export interface LogisticsEventLog {
  type: ShipmentEvent['type'];
  shipmentId: string | null;
  actorId: string;
}

export interface LogisticsHostState {
  phase: string;
  shipmentId: string | null;
  destination: string | null;
  reference: string | null;
  status: ShipmentContext['status'];
  carrier: string | null;
  eta: string | null;
  routeNotes: string | null;
  providerFacility: string | null;
  providerSignal: ShipmentContext['providerSignal'];
  providerLoadId: string | null;
  providerNote: string | null;
  shipmentCount: number;
  timeline: ShipmentContext['timeline'];
  eventLog: LogisticsEventLog[];
  transportState: ProjectionTransportState;
  transportReason: string | null;
}

export interface LogisticsHost {
  readonly address: string;
  getState(): LogisticsHostState;
  subscribe(listener: (state: LogisticsHostState) => void): () => void;
  createShipment(input: {
    shipmentId?: string;
    destination: string;
    reference?: string;
  }): Promise<void>;
  reset(): Promise<void>;
  destroy(): Promise<void>;
}

interface CreateLogisticsHostOptions {
  destroy?: () => Promise<void>;
}

function cloneState(state: LogisticsHostState): LogisticsHostState {
  return {
    ...state,
    timeline: state.timeline.map((entry) => ({ ...entry })),
    eventLog: state.eventLog.map((event) => ({ ...event })),
  };
}

function toEventLogEntry(event: IgniteActorSourceEvent<ShipmentEvent>): LogisticsEventLog {
  return {
    type: event.type,
    shipmentId: 'shipmentId' in event ? event.shipmentId : null,
    actorId: event.address.id,
  };
}

function shipmentContextFromSnapshot(
  snapshot: ReturnType<
    IgniteActorSource<ShipmentContext, ShipmentCommand, ShipmentEvent>['snapshot']
  >
): ShipmentContext {
  return snapshot.context ?? createInitialShipmentContext();
}

function projectSourceState(
  source: IgniteActorSource<ShipmentContext, ShipmentCommand, ShipmentEvent>,
  eventLog: LogisticsEventLog[] = []
): LogisticsHostState {
  const snapshot = source.snapshot();
  const status = source.transportStatus();
  const context = shipmentContextFromSnapshot(snapshot);

  return {
    phase: snapshot.phase,
    shipmentId: context.shipmentId,
    destination: context.destination,
    reference: context.reference,
    status: context.status,
    carrier: context.carrier,
    eta: context.eta,
    routeNotes: context.routeNotes,
    providerFacility: context.providerFacility,
    providerSignal: context.providerSignal,
    providerLoadId: context.providerLoadId,
    providerNote: context.providerNote,
    shipmentCount: context.shipmentCount,
    timeline: context.timeline.map((entry) => ({ ...entry })),
    eventLog,
    transportState: status.state,
    transportReason: status.reason ?? null,
  };
}

export function createLogisticsHostFromSource(
  source: IgniteActorSource<ShipmentContext, ShipmentCommand, ShipmentEvent>,
  options: CreateLogisticsHostOptions = {}
): LogisticsHost {
  const listeners = new Set<(state: LogisticsHostState) => void>();
  let state = projectSourceState(source);

  const notify = (): void => {
    const snapshot = cloneState(state);
    for (const listener of Array.from(listeners)) {
      listener(snapshot);
    }
  };

  const unsubscribeSnapshot = source.subscribe((snapshot) => {
    const context = shipmentContextFromSnapshot(snapshot);
    state = {
      ...state,
      phase: snapshot.phase,
      shipmentId: context.shipmentId,
      destination: context.destination,
      reference: context.reference,
      status: context.status,
      carrier: context.carrier,
      eta: context.eta,
      routeNotes: context.routeNotes,
      providerFacility: context.providerFacility,
      providerSignal: context.providerSignal,
      providerLoadId: context.providerLoadId,
      providerNote: context.providerNote,
      shipmentCount: context.shipmentCount,
      timeline: context.timeline.map((entry) => ({ ...entry })),
    };
    notify();
  });

  const unsubscribeEvent = source.subscribeEvent(
    (event) => {
      state = {
        ...state,
        eventLog: [toEventLogEntry(event), ...state.eventLog],
      };
      notify();
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

  const unsubscribeTransportStatus = source.subscribeTransportStatus((status) => {
    state = {
      ...state,
      transportState: status.state,
      transportReason: status.reason ?? null,
    };
    notify();
  });

  return {
    address: source.address.path,
    getState(): LogisticsHostState {
      return cloneState(state);
    },
    subscribe(listener: (nextState: LogisticsHostState) => void): () => void {
      listeners.add(listener);
      listener(cloneState(state));

      return () => {
        listeners.delete(listener);
      };
    },
    async createShipment(input): Promise<void> {
      const destination = input.destination.trim();
      if (destination.length === 0) {
        return;
      }

      await source.send({
        type: 'CREATE_SHIPMENT',
        shipmentId: input.shipmentId ?? `shipment-${Date.now().toString(36)}`,
        destination,
        reference: input.reference?.trim() || undefined,
      });
    },
    async reset(): Promise<void> {
      await source.send({ type: 'RESET_SHIPMENT' });
    },
    async destroy(): Promise<void> {
      unsubscribeTransportStatus();
      unsubscribeEvent();
      unsubscribeSnapshot();
      listeners.clear();
      await options.destroy?.();
    },
  };
}

export function createLogisticsHost(): LogisticsHost {
  const shipmentSource = createLogisticsTopologySources();
  return createLogisticsHostFromSource(shipmentSource.source, { destroy: shipmentSource.destroy });
}
