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
}

export interface ShipmentContext {
  shipmentId: string | null;
  destination: string | null;
  reference: string | null;
  status: ShipmentStatus;
  carrier: string | null;
  eta: string | null;
  routeNotes: string | null;
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
  | { type: 'MARK_RETURNED'; shipmentId?: string };

export type ShipmentEvent =
  | { type: 'SHIPMENT_CREATED'; shipmentId: string; destination: string }
  | { type: 'ROUTE_REQUESTED'; shipmentId: string; destination: string }
  | { type: 'ROUTE_ASSIGNED'; shipmentId: string; carrier: string; eta: string }
  | { type: 'SHIPMENT_IN_TRANSIT'; shipmentId: string }
  | { type: 'SHIPMENT_DELIVERED'; shipmentId: string }
  | { type: 'SHIPMENT_RETURNED'; shipmentId: string }
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
    shipmentCount: 0,
    timeline: [],
  };
}

function appendTimeline(
  context: ShipmentContext,
  label: string,
  detail: string
): ShipmentTimelineEntry[] {
  return [{ label, detail }, ...context.timeline].slice(0, 8);
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
            shipmentCount: context.shipmentCount + 1,
            timeline: appendTimeline(
              context,
              'Shipment accepted',
              `${message.shipmentId} to ${message.destination}`
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
              `${message.plan.carrier} arriving ${message.plan.eta}`
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
            timeline: appendTimeline(context, 'In transit', shipmentId),
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
            timeline: appendTimeline(context, 'Delivered', shipmentId),
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
            timeline: appendTimeline(context, 'Returned', shipmentId),
          },
          emit: [{ type: 'SHIPMENT_RETURNED', shipmentId }],
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
