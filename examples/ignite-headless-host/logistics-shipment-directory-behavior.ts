import { defineBehavior } from '@actor-web/runtime/browser';
import {
  createInitialShipmentContext,
  type ShipmentCommand,
  type ShipmentContext,
  type ShipmentEvent,
} from './logistics-contract';
import { appendTimeline } from './logistics-provider';

export function createShipmentDirectoryBehavior() {
  return defineBehavior<ShipmentCommand, ShipmentEvent>()
    .withContext(createInitialShipmentContext())
    .onMessage(({ context, message }) => {
      if (message.type === 'GET_SHIPMENT_COUNT') {
        return { reply: context.shipmentCount };
      }

      if (message.type === 'CREATE_SHIPMENT') {
        const nextContext: ShipmentContext = {
          ...context,
          shipmentId: message.shipmentId,
          destination: message.destination,
          reference: message.reference ?? null,
          status: 'route-requested',
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
              source: 'Shipment Directory',
              channel: 'gateway command ingress',
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
      }

      if (message.type === 'UPSERT_SHIPMENT_PROJECTION') {
        return {
          context: {
            ...message.shipment,
            shipmentCount: Math.max(context.shipmentCount, message.shipment.shipmentCount),
            timeline: message.shipment.timeline.map((entry) => ({ ...entry })),
          },
          emit: message.event ? [message.event] : [],
        };
      }

      if (message.type === 'RESET_SHIPMENT') {
        return {
          context: {
            ...createInitialShipmentContext(),
            shipmentCount: context.shipmentCount,
          },
          emit: [{ type: 'SHIPMENT_RESET', shipmentId: context.shipmentId }],
        };
      }

      return undefined;
    })
    .build();
}
