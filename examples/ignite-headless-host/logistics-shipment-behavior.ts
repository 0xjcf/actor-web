import { defineActor } from '@actor-core/runtime/browser';
import {
  createInitialShipmentContext,
  type ShipmentCommand,
  type ShipmentContext,
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
