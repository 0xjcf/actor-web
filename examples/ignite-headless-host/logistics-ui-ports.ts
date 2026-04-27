import type { ActorWebSourceHandle } from 'ignite-element/actor-web';
import type { ShipmentCommand, ShipmentContext, ShipmentEvent } from './logistics-contract';
import { logistics } from './logistics-topology';
import { createLogisticsTopologySources } from './runtime-harness';

export interface CreateShipmentInput {
  destination: string;
  reference?: string | null;
  shipmentId?: string;
}

export function createShipmentId(): string {
  return `shipment-${Date.now().toString(36)}`;
}

function createSourceHandle(
  actor: typeof logistics.actors.shipment | typeof logistics.actors.routing
): ActorWebSourceHandle<ShipmentContext, ShipmentCommand, ShipmentEvent> {
  const runtimeSources = createLogisticsTopologySources();
  const source =
    actor.key === logistics.actors.routing.key
      ? (runtimeSources.routingSource ?? runtimeSources.source)
      : runtimeSources.source;

  return {
    source,
    stop: runtimeSources.destroy,
  };
}

export const logisticsSources = {
  shipment(): ActorWebSourceHandle<ShipmentContext, ShipmentCommand, ShipmentEvent> {
    return createSourceHandle(logistics.actors.shipment);
  },

  routing(): ActorWebSourceHandle<ShipmentContext, ShipmentCommand, ShipmentEvent> {
    return createSourceHandle(logistics.actors.routing);
  },
};
