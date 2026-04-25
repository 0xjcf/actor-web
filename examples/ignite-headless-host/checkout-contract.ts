import type { ActorSnapshot, IgniteActorSourceSnapshot } from '@actor-core/runtime/browser';
import { actorSnapshotToIgniteSourceSnapshot, defineActor } from '@actor-core/runtime/browser';

export type ShipmentStatus =
  | 'idle'
  | 'accepted'
  | 'route-requested'
  | 'route-assigned'
  | 'in-transit'
  | 'delivered'
  | 'returned';

export interface ShipmentTimelineEntry {
  label: string;
  detail: string;
  source?: string;
  channel?: string;
  note?: string;
  timestamp?: number;
  facility?: string;
  signal?: ProviderSignal;
  loadId?: string;
}

export type ProviderSignal =
  | 'LABEL_SCANNED'
  | 'PACKED_INTO_TRUCK'
  | 'OUTBOUND_SCAN'
  | 'DELIVERY_CONFIRMED'
  | 'RETURN_EXCEPTION';

export interface ShipmentContext {
  shipmentId: string | null;
  destination: string | null;
  reference: string | null;
  status: ShipmentStatus;
  carrier: string | null;
  eta: string | null;
  routeNotes: string | null;
  providerFacility: string | null;
  providerSignal: ProviderSignal | null;
  providerLoadId: string | null;
  providerNote: string | null;
  shipmentCount: number;
  timeline: ShipmentTimelineEntry[];
}

export type RoutePlan = {
  shipmentId: string;
  carrier: string;
  eta: string;
  routeNotes: string;
};

export type ShipmentCommand =
  | { type: 'CREATE_SHIPMENT'; shipmentId: string; destination: string; reference?: string }
  | { type: 'RESET_SHIPMENT'; shipmentId?: string }
  | { type: 'GET_SHIPMENT_COUNT' }
  | { type: 'PLAN_ROUTE'; shipmentId: string; destination: string; reference?: string }
  | { type: 'ASSIGN_ROUTE'; plan: RoutePlan }
  | { type: 'MARK_IN_TRANSIT'; shipmentId?: string }
  | { type: 'MARK_DELIVERED'; shipmentId?: string }
  | { type: 'MARK_RETURNED'; shipmentId?: string }
  | {
      type: 'APPLY_PROVIDER_SIGNAL';
      shipmentId?: string;
      signal: ProviderSignal;
      facility?: string;
      loadId?: string;
      note?: string;
      baseContext?: ShipmentContext;
    };

export type ShipmentEvent =
  | { type: 'SHIPMENT_CREATED'; shipmentId: string; destination: string }
  | { type: 'ROUTE_REQUESTED'; shipmentId: string; destination: string }
  | { type: 'ROUTE_ASSIGNED'; shipmentId: string; carrier: string; eta: string }
  | { type: 'SHIPMENT_IN_TRANSIT'; shipmentId: string }
  | { type: 'SHIPMENT_DELIVERED'; shipmentId: string }
  | { type: 'SHIPMENT_RETURNED'; shipmentId: string }
  | {
      type: 'PROVIDER_SIGNAL_RECORDED';
      shipmentId: string;
      signal: ProviderSignal;
      facility: string;
      loadId: string;
    }
  | { type: 'SHIPMENT_RESET'; shipmentId: string | null };

export const LOCAL_NODE = 'logistics-browser-host';
export const REMOTE_NODE = 'logistics-server-runtime';
export const REMOTE_ACTOR_ID = 'logistics-shipment';
export const WORKER_NODE = 'logistics-worker-runtime';
export const WORKER_ACTOR_ID = 'logistics-routing';
export const REMOTE_ADDRESS = {
  id: REMOTE_ACTOR_ID,
  type: 'actor',
  node: REMOTE_NODE,
  path: `actor://${REMOTE_NODE}/actor/${REMOTE_ACTOR_ID}`,
} as const;
export const WORKER_ADDRESS = {
  id: WORKER_ACTOR_ID,
  type: 'actor',
  node: WORKER_NODE,
  path: `actor://${WORKER_NODE}/actor/${WORKER_ACTOR_ID}`,
} as const;

export function createInitialShipmentContext(): ShipmentContext {
  return {
    shipmentId: null,
    destination: null,
    reference: null,
    status: 'idle',
    carrier: null,
    eta: null,
    routeNotes: null,
    providerFacility: null,
    providerSignal: null,
    providerLoadId: null,
    providerNote: null,
    shipmentCount: 0,
    timeline: [],
  };
}

function appendTimeline(
  context: ShipmentContext,
  label: string,
  detail: string,
  metadata: Omit<ShipmentTimelineEntry, 'label' | 'detail'> = {}
): ShipmentTimelineEntry[] {
  return [{ label, detail, timestamp: Date.now(), ...metadata }, ...context.timeline];
}

function providerTimeline(signal: ProviderSignal): { label: string; detail: string } {
  switch (signal) {
    case 'LABEL_SCANNED':
      return {
        label: 'Provider label scan',
        detail: 'Shipment label scanned at provider HQ',
      };
    case 'PACKED_INTO_TRUCK':
      return {
        label: 'Packed into truck',
        detail: 'Provider packed the shipment into the assigned load',
      };
    case 'OUTBOUND_SCAN':
      return {
        label: 'Shipped',
        detail: 'Provider outbound scan completed',
      };
    case 'DELIVERY_CONFIRMED':
      return {
        label: 'Delivered',
        detail: 'Delivery confirmed at destination dock',
      };
    case 'RETURN_EXCEPTION':
      return {
        label: 'Returned',
        detail: 'Provider reported a return exception',
      };
  }
}

function statusForProviderSignal(signal: ProviderSignal, current: ShipmentStatus): ShipmentStatus {
  switch (signal) {
    case 'OUTBOUND_SCAN':
      return 'in-transit';
    case 'DELIVERY_CONFIRMED':
      return 'delivered';
    case 'RETURN_EXCEPTION':
      return 'returned';
    default:
      return current;
  }
}

function eventForProviderSignal(signal: ProviderSignal, shipmentId: string): ShipmentEvent[] {
  const providerEvent = {
    type: 'PROVIDER_SIGNAL_RECORDED' as const,
    shipmentId,
    signal,
    facility: providerFacilityForShipment(shipmentId),
    loadId: providerLoadIdForShipment(shipmentId),
  };

  if (signal === 'OUTBOUND_SCAN') {
    return [providerEvent, { type: 'SHIPMENT_IN_TRANSIT', shipmentId }];
  }

  if (signal === 'DELIVERY_CONFIRMED') {
    return [providerEvent, { type: 'SHIPMENT_DELIVERED', shipmentId }];
  }

  if (signal === 'RETURN_EXCEPTION') {
    return [providerEvent, { type: 'SHIPMENT_RETURNED', shipmentId }];
  }

  return [providerEvent];
}

export function providerFacilityForShipment(seed: string): string {
  const facilities = ['ORD Provider HQ', 'DFW Fulfillment Hub', 'LAX Cross-Dock'];
  const index = Math.abs(hashString(seed)) % facilities.length;
  return facilities[index];
}

export function providerLoadIdForShipment(seed: string): string {
  return `LOAD-${Math.abs(hashString(seed)).toString(36).slice(0, 5).toUpperCase()}`;
}

export function providerNoteForSignal(signal: ProviderSignal): string {
  switch (signal) {
    case 'LABEL_SCANNED':
      return 'Label barcode matched shipment manifest.';
    case 'PACKED_INTO_TRUCK':
      return 'Shipment was packed into the assigned truck load.';
    case 'OUTBOUND_SCAN':
      return 'Carrier accepted handoff and outbound scan was recorded.';
    case 'DELIVERY_CONFIRMED':
      return 'Destination dock confirmed delivery.';
    case 'RETURN_EXCEPTION':
      return 'Return exception triggered by address validation hold.';
  }
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return hash;
}

export function createShipmentBehavior() {
  return defineActor<ShipmentCommand>()
    .withContext(createInitialShipmentContext())
    .onMessage(({ actor, message }) => {
      const context = actor.getSnapshot().context as ShipmentContext;

      if (message.type === 'GET_SHIPMENT_COUNT') {
        return { reply: context.shipmentCount };
      }

      if (message.type === 'CREATE_SHIPMENT') {
        return {
          context: {
            ...context,
            shipmentId: message.shipmentId,
            destination: message.destination,
            reference: message.reference ?? null,
            status: 'route-requested' as const,
            carrier: null,
            eta: null,
            routeNotes: null,
            providerFacility: null,
            providerSignal: null,
            providerLoadId: null,
            providerNote: null,
            shipmentCount: context.shipmentCount + 1,
            timeline: appendTimeline(
              context,
              'Shipment accepted',
              `${message.shipmentId} to ${message.destination}`,
              {
                source: 'Server Shipment Runtime',
                channel: 'REST command ingress',
              }
            ),
          },
          emit: [
            {
              type: 'SHIPMENT_CREATED',
              shipmentId: message.shipmentId,
              destination: message.destination,
            },
            {
              type: 'ROUTE_REQUESTED',
              shipmentId: message.shipmentId,
              destination: message.destination,
            },
          ],
        };
      }

      if (message.type === 'ASSIGN_ROUTE') {
        return {
          context: {
            ...context,
            shipmentId: message.plan.shipmentId,
            status: 'route-assigned' as const,
            carrier: message.plan.carrier,
            eta: message.plan.eta,
            routeNotes: message.plan.routeNotes,
            timeline: appendTimeline(
              context,
              'Route assigned',
              `${message.plan.carrier} arriving ${message.plan.eta}`,
              {
                source: 'Worker Routing Runtime',
                channel: 'Actor-Web transport',
                note: message.plan.routeNotes,
              }
            ),
          },
          emit: [
            {
              type: 'ROUTE_ASSIGNED',
              shipmentId: message.plan.shipmentId,
              carrier: message.plan.carrier,
              eta: message.plan.eta,
            },
          ],
        };
      }

      if (message.type === 'MARK_IN_TRANSIT') {
        const shipmentId = message.shipmentId ?? context.shipmentId ?? 'unknown-shipment';
        return {
          context: {
            ...context,
            shipmentId,
            status: 'in-transit' as const,
            timeline: appendTimeline(context, 'Shipped', shipmentId, {
              source: 'Server Lifecycle',
              channel: 'gateway WS update',
            }),
          },
          emit: [{ type: 'SHIPMENT_IN_TRANSIT', shipmentId }],
        };
      }

      if (message.type === 'MARK_DELIVERED') {
        const shipmentId = message.shipmentId ?? context.shipmentId ?? 'unknown-shipment';
        return {
          context: {
            ...context,
            shipmentId,
            status: 'delivered' as const,
            timeline: appendTimeline(context, 'Delivered', shipmentId, {
              source: 'Server Lifecycle',
              channel: 'gateway WS update',
            }),
          },
          emit: [{ type: 'SHIPMENT_DELIVERED', shipmentId }],
        };
      }

      if (message.type === 'MARK_RETURNED') {
        const shipmentId = message.shipmentId ?? context.shipmentId ?? 'unknown-shipment';
        return {
          context: {
            ...context,
            shipmentId,
            status: 'returned' as const,
            timeline: appendTimeline(context, 'Returned', shipmentId, {
              source: 'Server Lifecycle',
              channel: 'gateway WS update',
            }),
          },
          emit: [{ type: 'SHIPMENT_RETURNED', shipmentId }],
        };
      }

      if (message.type === 'APPLY_PROVIDER_SIGNAL') {
        const baseContext = message.baseContext ?? context;
        const shipmentId = message.shipmentId ?? baseContext.shipmentId ?? 'unknown-shipment';
        const facility = message.facility ?? providerFacilityForShipment(shipmentId);
        const loadId = message.loadId ?? providerLoadIdForShipment(shipmentId);
        const note = message.note ?? providerNoteForSignal(message.signal);
        const timeline = providerTimeline(message.signal);

        return {
          context: {
            ...baseContext,
            shipmentId,
            status: statusForProviderSignal(message.signal, baseContext.status),
            providerFacility: facility,
            providerSignal: message.signal,
            providerLoadId: loadId,
            providerNote: note,
            shipmentCount: Math.max(context.shipmentCount, baseContext.shipmentCount),
            timeline: appendTimeline(baseContext, timeline.label, timeline.detail, {
              source: 'Remote Provider HQ',
              channel: 'Provider signal -> server runtime -> gateway WS',
              note,
              facility,
              signal: message.signal,
              loadId,
            }),
          },
          emit: eventForProviderSignal(message.signal, shipmentId).map((event) =>
            event.type === 'PROVIDER_SIGNAL_RECORDED' ? { ...event, facility, loadId } : event
          ),
        };
      }

      return {
        context: {
          ...createInitialShipmentContext(),
          shipmentCount: context.shipmentCount,
        },
        emit: [{ type: 'SHIPMENT_RESET', shipmentId: context.shipmentId }],
      };
    });
}

export function createRoutingBehavior() {
  return defineActor<ShipmentCommand>()
    .withContext(createInitialShipmentContext())
    .onMessage(({ actor, message }) => {
      const context = actor.getSnapshot().context as ShipmentContext;

      if (message.type === 'RESET_SHIPMENT') {
        return {
          context: {
            ...createInitialShipmentContext(),
            shipmentCount: context.shipmentCount,
          },
          emit: [{ type: 'SHIPMENT_RESET', shipmentId: context.shipmentId }],
        };
      }

      if (message.type !== 'PLAN_ROUTE') {
        return;
      }

      const plan: RoutePlan = {
        shipmentId: message.shipmentId,
        carrier: message.destination.toLowerCase().includes('international')
          ? 'Atlas Freight'
          : 'Northline Express',
        eta: message.destination.toLowerCase().includes('international') ? '72h' : '24h',
        routeNotes: `Route ${message.shipmentId} through ${message.destination}`,
      };

      return {
        context: {
          ...context,
          shipmentId: message.shipmentId,
          destination: message.destination,
          reference: message.reference ?? null,
          status: 'route-assigned' as const,
          carrier: plan.carrier,
          eta: plan.eta,
          routeNotes: plan.routeNotes,
          shipmentCount: context.shipmentCount + 1,
          timeline: appendTimeline(context, 'Worker route planned', plan.routeNotes),
        },
        reply: plan,
        emit: [
          {
            type: 'ROUTE_ASSIGNED',
            shipmentId: plan.shipmentId,
            carrier: plan.carrier,
            eta: plan.eta,
          },
        ],
      };
    });
}

export function createActorSnapshot<TContext>(
  value: unknown,
  context: TContext,
  status: ActorSnapshot<TContext>['status'] = 'running'
): ActorSnapshot<TContext> {
  return {
    value,
    context,
    status,
    matches: (state: string) => state === value,
    can: () => status === 'running',
    hasTag: () => false,
    toJSON: () => ({
      value,
      context,
      status,
    }),
  };
}

export function createPlaceholderSnapshot(): IgniteActorSourceSnapshot<ShipmentContext> {
  return actorSnapshotToIgniteSourceSnapshot(
    REMOTE_ADDRESS,
    createActorSnapshot('idle', createInitialShipmentContext())
  );
}

export function normalizeShipmentSnapshot(
  snapshot: IgniteActorSourceSnapshot<ShipmentContext>
): IgniteActorSourceSnapshot<ShipmentContext> {
  const derivedPhase = snapshot.context.status;

  if (derivedPhase === snapshot.phase) {
    return snapshot;
  }

  return {
    ...snapshot,
    phase: derivedPhase,
    toJSON: () => ({
      ...snapshot.toJSON(),
      phase: derivedPhase,
    }),
  };
}
