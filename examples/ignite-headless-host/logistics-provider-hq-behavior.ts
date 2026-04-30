import { defineActor } from '@actor-core/runtime/browser';
import {
  PROVIDER_HQ_ADDRESS,
  type ProviderHqCommand,
  type ProviderHqContext,
  type ProviderHqEvent,
  type ProviderSignalCommand,
} from './logistics-contract';
import {
  clampProviderQueuePage,
  createInitialProviderHqContext,
  isTerminalShipment,
  providerSignalFromCommand,
  providerStatusFrom,
  upsertProviderShipment,
} from './logistics-provider-hq';

function isProviderSignalCommand(message: ProviderHqCommand): message is ProviderSignalCommand {
  return (
    message.type === 'LABEL_SCANNED' ||
    message.type === 'PACKED_INTO_TRUCK' ||
    message.type === 'OUTBOUND_SCAN' ||
    message.type === 'DELIVERY_CONFIRMED' ||
    message.type === 'RETURN_EXCEPTION'
  );
}

export function createProviderHqBehavior() {
  return defineActor<ProviderHqCommand, ProviderHqEvent>()
    .withContext(createInitialProviderHqContext())
    .onMessage(({ context, message }) => {
      if (message.type === 'REFRESH_PROVIDER_STATUS') {
        return {
          context,
          reply: context.status,
          emit: [{ type: 'PROVIDER_STATUS_REFRESHED' }],
        };
      }

      if (message.type === 'SET_PROVIDER_MODE') {
        const status = providerStatusFrom(
          message.mode,
          context.shipmentContexts,
          context.selectedShipmentId,
          context.status.sourceLabel
        );
        return {
          context: {
            ...context,
            status,
            message: `Provider mode set to ${message.mode}.`,
          },
          reply: status,
          emit: [{ type: 'PROVIDER_MODE_CHANGED', mode: message.mode }],
        };
      }

      if (message.type === 'SET_PROVIDER_SOURCE_LABEL') {
        const status = providerStatusFrom(
          context.status.mode,
          context.shipmentContexts,
          context.selectedShipmentId,
          message.sourceLabel
        );
        return {
          context: {
            ...context,
            status,
          },
          reply: status,
          emit: [{ type: 'PROVIDER_SOURCE_LABEL_CHANGED', sourceLabel: message.sourceLabel }],
        };
      }

      if (message.type === 'SELECT_PROVIDER_SHIPMENT') {
        const selected = context.status.queue.find(
          (item) => item.shipmentId === message.shipmentId
        );
        if (!selected || isTerminalShipment(selected.status)) {
          return {
            context: {
              ...context,
              selectedShipmentId: null,
              message: `${message.shipmentId} is complete and no longer needs provider processing.`,
            },
            emit: [{ type: 'PROVIDER_SHIPMENT_SELECTED', shipmentId: null }],
          };
        }

        const status = providerStatusFrom(
          context.status.mode,
          context.shipmentContexts,
          message.shipmentId,
          context.status.sourceLabel
        );
        return {
          context: {
            ...context,
            status,
            selectedShipmentId: message.shipmentId,
            message: `Selected ${message.shipmentId} for provider processing.`,
          },
          emit: [{ type: 'PROVIDER_SHIPMENT_SELECTED', shipmentId: message.shipmentId }],
        };
      }

      if (message.type === 'PROVIDER_QUEUE_PREV') {
        return {
          context: {
            ...context,
            queuePage: Math.max(0, context.queuePage - 1),
          },
        };
      }

      if (message.type === 'PROVIDER_QUEUE_NEXT') {
        return {
          context: {
            ...context,
            queuePage: clampProviderQueuePage(context.queuePage + 1, context.status.queue.length),
          },
        };
      }

      if (message.type === 'UPSERT_PROVIDER_SHIPMENT') {
        return {
          context: upsertProviderShipment(context, message.shipment),
        };
      }

      if (message.type === 'REPORT_PROVIDER_SIGNAL_ACCEPTED') {
        const nextContext = upsertProviderShipment(context, message.shipment);
        const finalContext: ProviderHqContext = {
          ...nextContext,
          message: `${message.signal} accepted by provider shipment actor.`,
        };
        const shipmentId = message.shipment.shipmentId ?? 'unknown-shipment';

        return {
          context: finalContext,
          reply: finalContext.status,
          emit: [{ type: 'PROVIDER_SIGNAL_SUBMITTED', shipmentId, signal: message.signal }],
        };
      }

      if (message.type === 'REPORT_PROVIDER_SIGNAL_REJECTED') {
        return {
          context: {
            ...context,
            message: message.reason,
          },
          reply: context.status,
          emit: [
            {
              type: 'PROVIDER_SIGNAL_REJECTED',
              shipmentId: message.shipmentId,
              signal: message.signal,
              expected: message.expected,
              reason: message.reason,
            },
          ],
        };
      }

      if (message.type === 'CLEAR_PROVIDER_QUEUE') {
        const initialContext = createInitialProviderHqContext();
        return {
          context: {
            ...initialContext,
            status: {
              ...initialContext.status,
              mode: context.status.mode,
              sourceLabel: context.status.sourceLabel,
            },
            message: 'Provider queue cleared.',
          },
        };
      }

      if (isProviderSignalCommand(message)) {
        const signal = providerSignalFromCommand(message);
        const shipmentId = message.shipmentId ?? context.selectedShipmentId;
        const currentShipment = shipmentId ? context.shipmentContexts[shipmentId] : undefined;
        if (!shipmentId || !currentShipment || isTerminalShipment(currentShipment.status)) {
          const reason = shipmentId
            ? `${shipmentId} is not available for provider processing.`
            : 'No shipment selected for provider processing.';
          return {
            context: {
              ...context,
              message: reason,
            },
            reply: context.status,
            emit: [
              {
                type: 'PROVIDER_SIGNAL_REJECTED',
                shipmentId: shipmentId ?? null,
                signal,
                expected: 'select a non-terminal shipment',
                reason,
              },
            ],
          };
        }

        return {
          context: {
            ...context,
            message: `${signal} requested for ${shipmentId}.`,
          },
          reply: context.status,
          emit: [{ type: 'PROVIDER_SIGNAL_REQUESTED', shipmentId, signal }],
        };
      }
      return undefined;
    })
    .build();
}

export const providerHqActorAddress = PROVIDER_HQ_ADDRESS;
