import {
  type ActorTransitionErrorValue,
  defineBehavior,
  defineFSM,
} from '@actor-web/runtime/browser';
import type {
  ProviderShipmentCommand,
  ProviderShipmentEvent,
  ProviderShipmentSignalResult,
  ProviderSignal,
  ProviderSignalCommand,
  ShipmentContext,
} from './logistics-contract';
import {
  applyProviderSignalToShipment,
  expectedProviderSignal,
  isTerminalShipment,
  providerSignalExpectationLabel,
  providerSignalMatchesExpected,
} from './logistics-provider-hq';

export type ProviderShipmentWorkflowState =
  | 'awaiting-label'
  | 'label-scanned'
  | 'packed'
  | 'in-transit'
  | 'complete';

const providerShipmentFSM = defineFSM<
  ProviderShipmentCommand,
  ShipmentContext,
  ProviderShipmentWorkflowState
>({
  initial: 'awaiting-label',
  states: {
    'awaiting-label': {
      on: {
        LABEL_SCANNED: 'label-scanned',
      },
    },
    'label-scanned': {
      on: {
        PACKED_INTO_TRUCK: 'packed',
      },
    },
    packed: {
      on: {
        OUTBOUND_SCAN: 'in-transit',
      },
    },
    'in-transit': {
      on: {
        DELIVERY_CONFIRMED: 'complete',
        RETURN_EXCEPTION: 'complete',
      },
    },
    complete: {
      on: {},
    },
  },
});

export function isTransitionError(value: unknown): value is ActorTransitionErrorValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    value.ok === false &&
    'error' in value &&
    typeof value.error === 'object' &&
    value.error !== null &&
    'code' in value.error &&
    value.error.code === 'INVALID_TRANSITION'
  );
}

export function providerShipmentActorId(shipmentId: string): string {
  return `logistics-provider-shipment-${shipmentId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

export function createProviderShipmentSignalRejection(
  shipment: ShipmentContext | undefined,
  signal: ProviderSignal
): ProviderShipmentSignalResult {
  const expected = expectedProviderSignal(shipment);
  const expectedLabel = providerSignalExpectationLabel(expected);
  const shipmentId = shipment?.shipmentId ?? null;
  const reason = shipmentId
    ? `${signal} rejected. Next required provider signal is ${expectedLabel}.`
    : `${signal} rejected. Provider shipment actor is not ready.`;

  return {
    ok: false,
    shipmentId,
    signal,
    expected: expectedLabel,
    reason,
  };
}

function acceptProviderSignal(
  signal: ProviderSignal,
  context: ShipmentContext,
  message: ProviderSignalCommand
): ProviderShipmentSignalResult {
  const shipmentId = message.shipmentId ?? context.shipmentId ?? 'unknown-shipment';
  const nextContext = applyProviderSignalToShipment(
    {
      ...context,
      shipmentId,
    },
    signal,
    {
      facility: message.facility,
      loadId: message.loadId,
      note: message.note,
    }
  );

  return {
    ok: true,
    shipment: nextContext,
    signal,
  };
}

export function processProviderShipmentSignal(
  context: ShipmentContext | undefined,
  message: ProviderSignalCommand
): ProviderShipmentSignalResult {
  const signal = message.type;
  if (
    !context ||
    isTerminalShipment(context.status) ||
    !providerSignalMatchesExpected(context, signal)
  ) {
    return createProviderShipmentSignalRejection(context, signal);
  }

  return acceptProviderSignal(signal, context, message);
}

export function createProviderShipmentBehavior(initialContext: ShipmentContext) {
  return defineBehavior<ProviderShipmentCommand, ProviderShipmentEvent>()
    .withContext(initialContext)
    .withFSM(providerShipmentFSM)
    .onMessage(({ message }) => {
      if (message.type !== 'SYNC_PROVIDER_SHIPMENT') {
        return undefined;
      }

      return {
        context: {
          ...message.shipment,
          timeline: message.shipment.timeline.map((entry) => ({ ...entry })),
        },
        emit: [
          {
            type: 'PROVIDER_SHIPMENT_SYNCED',
            shipmentId: message.shipment.shipmentId ?? 'unknown-shipment',
          },
        ],
      };
    })
    .onTransition({
      LABEL_SCANNED: ({ context, message }) => {
        const result = processProviderShipmentSignal(context, message);
        return {
          context: result.ok ? result.shipment : context,
          reply: result,
          emit: result.ok
            ? [
                {
                  type: 'PROVIDER_SHIPMENT_SIGNAL_ACCEPTED',
                  shipmentId: result.shipment.shipmentId ?? 'unknown-shipment',
                  signal: 'LABEL_SCANNED',
                },
              ]
            : [],
        };
      },
      PACKED_INTO_TRUCK: ({ context, message }) => {
        const result = processProviderShipmentSignal(context, message);
        return {
          context: result.ok ? result.shipment : context,
          reply: result,
          emit: result.ok
            ? [
                {
                  type: 'PROVIDER_SHIPMENT_SIGNAL_ACCEPTED',
                  shipmentId: result.shipment.shipmentId ?? 'unknown-shipment',
                  signal: 'PACKED_INTO_TRUCK',
                },
              ]
            : [],
        };
      },
      OUTBOUND_SCAN: ({ context, message }) => {
        const result = processProviderShipmentSignal(context, message);
        return {
          context: result.ok ? result.shipment : context,
          reply: result,
          emit: result.ok
            ? [
                {
                  type: 'PROVIDER_SHIPMENT_SIGNAL_ACCEPTED',
                  shipmentId: result.shipment.shipmentId ?? 'unknown-shipment',
                  signal: 'OUTBOUND_SCAN',
                },
              ]
            : [],
        };
      },
      DELIVERY_CONFIRMED: ({ context, message }) => {
        const result = processProviderShipmentSignal(context, message);
        return {
          context: result.ok ? result.shipment : context,
          reply: result,
          emit: result.ok
            ? [
                {
                  type: 'PROVIDER_SHIPMENT_SIGNAL_ACCEPTED',
                  shipmentId: result.shipment.shipmentId ?? 'unknown-shipment',
                  signal: 'DELIVERY_CONFIRMED',
                },
              ]
            : [],
        };
      },
      RETURN_EXCEPTION: ({ context, message }) => {
        const result = processProviderShipmentSignal(context, message);
        return {
          context: result.ok ? result.shipment : context,
          reply: result,
          emit: result.ok
            ? [
                {
                  type: 'PROVIDER_SHIPMENT_SIGNAL_ACCEPTED',
                  shipmentId: result.shipment.shipmentId ?? 'unknown-shipment',
                  signal: 'RETURN_EXCEPTION',
                },
              ]
            : [],
        };
      },
    })
    .build();
}
