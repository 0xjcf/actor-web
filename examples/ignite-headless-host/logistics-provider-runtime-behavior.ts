import { defineBehavior } from '@actor-web/runtime/browser';
import type {
  ProviderRuntimeCommand,
  ProviderShipmentSignalResult,
  ShipmentContext,
} from './logistics-contract';
import { processProviderShipmentSignal } from './logistics-provider-shipment-behavior';

interface ProviderRuntimeContext {
  readonly shipments: Record<string, ShipmentContext>;
}

function createInitialProviderRuntimeContext(): ProviderRuntimeContext {
  return {
    shipments: {},
  };
}

export function createProviderRuntimeBehavior() {
  return defineBehavior<ProviderRuntimeCommand>()
    .withContext(createInitialProviderRuntimeContext())
    .onMessage(({ context, message }) => {
      if (message.type === 'RESET_PROVIDER_RUNTIME') {
        return {
          context: createInitialProviderRuntimeContext(),
        };
      }

      if (message.type === 'SYNC_PROVIDER_RUNTIME_SHIPMENT') {
        const shipmentId = message.shipment.shipmentId;
        if (!shipmentId) {
          return {
            context,
            reply: null,
          };
        }

        return {
          context: {
            shipments: {
              ...context.shipments,
              [shipmentId]: {
                ...message.shipment,
                timeline: message.shipment.timeline.map((entry) => ({ ...entry })),
              },
            },
          },
          reply: message.shipment,
        };
      }

      if (message.type === 'PROCESS_PROVIDER_RUNTIME_SIGNAL') {
        const shipment = context.shipments[message.shipmentId];
        const result = processProviderShipmentSignal(shipment, {
          type: message.signal,
          shipmentId: message.shipmentId,
          facility: message.facility,
          loadId: message.loadId,
          note: message.note,
        });

        if (!result.ok) {
          return {
            context,
            reply: result satisfies ProviderShipmentSignalResult,
          };
        }

        return {
          context: {
            shipments: {
              ...context.shipments,
              [message.shipmentId]: {
                ...result.shipment,
                timeline: result.shipment.timeline.map((entry) => ({ ...entry })),
              },
            },
          },
          reply: result,
        };
      }

      return undefined;
    })
    .build();
}
