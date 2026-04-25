import { actor, defineActorWebTopology, node, supervisor } from './actor-web-ignite-source';
import {
  LOCAL_NODE,
  REMOTE_ACTOR_ID,
  REMOTE_NODE,
  WORKER_ACTOR_ID,
  WORKER_NODE,
} from './logistics-contract';
import { createRoutingBehavior } from './logistics-routing-behavior';
import { createShipmentBehavior } from './logistics-shipment-behavior';

export const logistics = defineActorWebTopology({
  contractVersion: '1.0.0',

  nodes: {
    browser: node(LOCAL_NODE),
    server: node(REMOTE_NODE),
    worker: node(WORKER_NODE),
  },

  actors: {
    shipment: actor({
      id: REMOTE_ACTOR_ID,
      node: 'server',
      behavior: createShipmentBehavior,
      supervision: {
        strategy: 'restart',
        maxRestarts: 3,
        withinMs: 60_000,
      },
      gateway: {
        scope: { kind: 'logistics-shipment' },
      },
    }),

    routing: actor({
      id: WORKER_ACTOR_ID,
      node: 'worker',
      behavior: createRoutingBehavior,
      supervision: {
        strategy: 'restart',
        maxRestarts: 5,
        withinMs: 60_000,
      },
      gateway: {
        scope: { kind: 'logistics-routing' },
      },
    }),
  },

  supervisors: {
    serverLogistics: supervisor({
      node: 'server',
      strategy: 'one-for-one',
      children: ['shipment'],
    }),

    workerRouting: supervisor({
      node: 'worker',
      strategy: 'one-for-one',
      children: ['routing'],
    }),
  },
});
