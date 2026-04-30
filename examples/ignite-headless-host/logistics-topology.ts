import { actor, defineActorWebTopology, node, supervisor } from '@actor-core/runtime/topology';
import {
  DISPATCHER_ACTOR_ID,
  DRIVER_DIRECTORY_ACTOR_ID,
  LOCAL_NODE,
  LOGISTICS_SUPERVISOR_ACTOR_ID,
  PROVIDER_HQ_ACTOR_ID,
  PROVIDER_NODE,
  PROVIDER_RUNTIME_ACTOR_ID,
  REMOTE_ACTOR_ID,
  REMOTE_NODE,
  SERVICE_WORKER_ACTOR_ID,
  SERVICE_WORKER_NODE,
  WORKER_ACTOR_ID,
  WORKER_NODE,
} from './logistics-contract';
import {
  createDispatcherBehavior,
  createDriverDirectoryBehavior,
  createLogisticsSupervisorBehavior,
} from './logistics-operations-behaviors';
import { createProviderHqBehavior } from './logistics-provider-hq-behavior';
import { createProviderRuntimeBehavior } from './logistics-provider-runtime-behavior';
import { createProviderShipmentBehavior } from './logistics-provider-shipment-behavior';
import { createRoutingBehavior } from './logistics-routing-behavior';
import { providerShipmentInstanceId, shipmentLifecycleActorId } from './logistics-runtime-plans';
import { createServiceWorkerProofBehavior } from './logistics-service-worker-behavior';
import { createShipmentBehavior } from './logistics-shipment-behavior';
import { createShipmentDirectoryBehavior } from './logistics-shipment-directory-behavior';

export const logistics = defineActorWebTopology({
  contractVersion: '1.0.0',

  nodes: {
    browser: node(LOCAL_NODE),
    server: node(REMOTE_NODE),
    worker: node(WORKER_NODE),
    provider: node(PROVIDER_NODE),
    serviceWorker: node(SERVICE_WORKER_NODE),
  },

  actors: {
    shipment: actor({
      id: REMOTE_ACTOR_ID,
      node: 'server',
      behavior: createShipmentDirectoryBehavior,
      supervision: {
        strategy: 'restart',
        maxRestarts: 3,
        withinMs: 60_000,
      },
      gateway: true,
    }),

    logisticsSupervisor: actor({
      id: LOGISTICS_SUPERVISOR_ACTOR_ID,
      node: 'server',
      behavior: createLogisticsSupervisorBehavior,
      supervision: {
        strategy: 'restart',
        maxRestarts: 3,
        withinMs: 60_000,
      },
    }),

    shipmentLifecycle: actor({
      id: shipmentLifecycleActorId,
      node: 'server',
      behavior: createShipmentBehavior,
      supervision: {
        strategy: 'restart',
        maxRestarts: 3,
        withinMs: 60_000,
      },
    }),

    dispatcher: actor({
      id: DISPATCHER_ACTOR_ID,
      node: 'server',
      behavior: createDispatcherBehavior,
      supervision: {
        strategy: 'restart',
        maxRestarts: 3,
        withinMs: 60_000,
      },
    }),

    driverDirectory: actor({
      id: DRIVER_DIRECTORY_ACTOR_ID,
      node: 'server',
      behavior: createDriverDirectoryBehavior,
      supervision: {
        strategy: 'restart',
        maxRestarts: 3,
        withinMs: 60_000,
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
      gateway: true,
    }),

    providerHq: actor({
      id: PROVIDER_HQ_ACTOR_ID,
      node: 'server',
      behavior: createProviderHqBehavior,
      supervision: {
        strategy: 'restart',
        maxRestarts: 3,
        withinMs: 60_000,
      },
      gateway: true,
    }),

    providerShipment: actor({
      id: providerShipmentInstanceId,
      node: 'server',
      behavior: ({ shipment }) => createProviderShipmentBehavior(shipment),
      supervision: {
        strategy: 'restart',
        maxRestarts: 3,
        withinMs: 60_000,
      },
    }),

    providerRuntime: actor({
      id: PROVIDER_RUNTIME_ACTOR_ID,
      node: 'provider',
      behavior: createProviderRuntimeBehavior,
      supervision: {
        strategy: 'restart',
        maxRestarts: 3,
        withinMs: 60_000,
      },
    }),

    serviceWorkerProof: actor({
      id: SERVICE_WORKER_ACTOR_ID,
      node: 'serviceWorker',
      behavior: createServiceWorkerProofBehavior,
      supervision: {
        strategy: 'restart',
        maxRestarts: 3,
        withinMs: 60_000,
      },
    }),
  },

  supervisors: {
    serverLogistics: supervisor({
      node: 'server',
      strategy: 'one-for-one',
      children: [
        'logisticsSupervisor',
        'dispatcher',
        'driverDirectory',
        'shipment',
        'shipmentLifecycle',
        'providerHq',
        'providerShipment',
      ],
    }),

    workerRouting: supervisor({
      node: 'worker',
      strategy: 'one-for-one',
      children: ['routing'],
    }),

    providerRuntime: supervisor({
      node: 'provider',
      strategy: 'one-for-one',
      children: ['providerRuntime'],
    }),

    serviceWorkerProof: supervisor({
      node: 'serviceWorker',
      strategy: 'one-for-one',
      children: ['serviceWorkerProof'],
    }),
  },
});
