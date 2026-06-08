import { defineActor, defineFSM } from '@actor-web/runtime/browser';
import {
  createInitialShipmentContext,
  type ShipmentCommand,
  type ShipmentContext,
  type ShipmentEvent,
  type ShipmentStatus,
} from './logistics-contract';
import {
  appendTimeline,
  eventForProviderSignal,
  providerFacilityForShipment,
  providerLoadIdForShipment,
  providerNoteForSignal,
  providerTimeline,
  statusForProviderSignal,
} from './logistics-provider';

const resetOrCreate = {
  CREATE_SHIPMENT: 'route-requested',
  RESET_SHIPMENT: 'idle',
} as const;

const shipmentFSM = defineFSM<ShipmentCommand, ShipmentContext, ShipmentStatus>({
  initial: 'idle',
  states: {
    idle: {
      on: resetOrCreate,
    },
    accepted: {
      on: resetOrCreate,
    },
    'route-requested': {
      on: {
        ...resetOrCreate,
        ASSIGN_ROUTE: 'route-assigned',
      },
    },
    'route-assigned': {
      on: {
        ...resetOrCreate,
        APPLY_PROVIDER_SIGNAL: {
          target: ({ message, context }) => statusForProviderSignal(message.signal, context.status),
        },
        MARK_IN_TRANSIT: 'in-transit',
        MARK_DELIVERED: 'delivered',
        MARK_RETURNED: 'returned',
      },
    },
    'in-transit': {
      on: {
        ...resetOrCreate,
        APPLY_PROVIDER_SIGNAL: {
          target: ({ message, context }) => statusForProviderSignal(message.signal, context.status),
        },
        MARK_DELIVERED: 'delivered',
        MARK_RETURNED: 'returned',
      },
    },
    delivered: {
      on: resetOrCreate,
    },
    returned: {
      on: resetOrCreate,
    },
  },
});

export function createShipmentBehavior() {
  return defineActor<ShipmentCommand, ShipmentEvent>()
    .withContext(createInitialShipmentContext())
    .withFSM(shipmentFSM)
    .onMessage(({ context, message }) => {
      if (message.type === 'GET_SHIPMENT_COUNT') {
        return { reply: context.shipmentCount };
      }

      return undefined;
    })
    .onTransition({
      CREATE_SHIPMENT: ({ context, message }) => {
        const nextContext = {
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
        };

        return {
          context: nextContext,
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
      },

      ASSIGN_ROUTE: ({ context, message }) => {
        const nextContext = {
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
        };

        return {
          context: nextContext,
          emit: [
            {
              type: 'ROUTE_ASSIGNED',
              shipmentId: message.plan.shipmentId,
              carrier: message.plan.carrier,
              eta: message.plan.eta,
            },
          ],
        };
      },

      MARK_IN_TRANSIT: ({ context, message }) => {
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
      },

      MARK_DELIVERED: ({ context, message }) => {
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
      },

      MARK_RETURNED: ({ context, message }) => {
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
      },

      APPLY_PROVIDER_SIGNAL: ({ context, message }) => {
        const baseContext = message.baseContext ?? context;
        const shipmentId = message.shipmentId ?? baseContext.shipmentId ?? 'unknown-shipment';
        const facility = message.facility ?? providerFacilityForShipment(shipmentId);
        const loadId = message.loadId ?? providerLoadIdForShipment(shipmentId);
        const note = message.note ?? providerNoteForSignal(message.signal);
        const timeline = providerTimeline(message.signal);
        const nextContext = {
          ...baseContext,
          shipmentId,
          status: statusForProviderSignal(message.signal, baseContext.status),
          providerFacility: facility,
          providerSignal: message.signal,
          providerLoadId: loadId,
          providerNote: note,
          shipmentCount: Math.max(context.shipmentCount, baseContext.shipmentCount),
          timeline: appendTimeline(baseContext, timeline.label, timeline.detail, {
            source: message.sourceLabel ?? 'Remote Provider HQ',
            channel: message.channelLabel ?? 'Provider signal -> server runtime -> gateway WS',
            note,
            facility,
            signal: message.signal,
            loadId,
          }),
        };

        return {
          context: nextContext,
          emit: eventForProviderSignal(message.signal, shipmentId).map((event) =>
            event.type === 'PROVIDER_SIGNAL_RECORDED' ? { ...event, facility, loadId } : event
          ),
        };
      },

      RESET_SHIPMENT: ({ context }) => {
        return {
          context: {
            ...createInitialShipmentContext(),
            shipmentCount: context.shipmentCount,
          },
          emit: [{ type: 'SHIPMENT_RESET', shipmentId: context.shipmentId }],
        };
      },
    })
    .build();
}
