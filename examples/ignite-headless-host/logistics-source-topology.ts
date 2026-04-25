import { createActorWebSource } from './actor-web-ignite-source';
import { logistics } from './logistics-topology';

export const logisticsSources = {
  ...logistics,
  actors: {
    ...logistics.actors,
    shipment: {
      ...logistics.actors.shipment,
      source: (options?: Parameters<typeof createActorWebSource>[1]) =>
        createActorWebSource(logistics.actors.shipment, options),
    },
    routing: {
      ...logistics.actors.routing,
      source: (options?: Parameters<typeof createActorWebSource>[1]) =>
        createActorWebSource(logistics.actors.routing, options),
    },
  },
} as const;
