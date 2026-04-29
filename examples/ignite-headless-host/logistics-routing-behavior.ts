import { defineActor } from '@actor-core/runtime/browser';
import {
  createInitialShipmentContext,
  type RoutePlan,
  type ShipmentCommand,
  type ShipmentEvent,
} from './logistics-contract';
import { appendTimeline } from './logistics-provider';

export function createRoutingBehavior() {
  return defineActor<ShipmentCommand, ShipmentEvent>()
    .withContext(createInitialShipmentContext())
    .onMessage(({ context, message }) => {
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
    })
    .build();
}
