import type {
  ProviderHqContext,
  ProviderRuntimeSource,
  ProviderSignal,
  ProviderSignalCommand,
  ProviderSignalSourceLabel,
  ShipmentContext,
  ShipmentStatus,
} from './logistics-contract';
import {
  providerFacilityForShipment,
  providerLoadIdForShipment,
  providerNoteForSignal,
} from './logistics-provider';

export type LifecycleMode = 'simulation' | 'manual';
export const PROVIDER_QUEUE_PAGE_SIZE = 5;

export interface ProviderQueueItem {
  shipmentId: string;
  destination: string | null;
  reference: string | null;
  status: ShipmentStatus;
  facility: string;
  signal: ProviderSignal | null;
  loadId: string;
  note: string | null;
  updatedAt: number;
}

export interface ProviderStatus {
  mode: LifecycleMode;
  sourceLabel: ProviderSignalSourceLabel;
  shipmentId: string | null;
  status: ShipmentStatus | null;
  facility: string | null;
  signal: ProviderSignal | null;
  loadId: string | null;
  note: string | null;
  queue: ProviderQueueItem[];
}

export function emptyProviderStatus(mode: LifecycleMode | 'unknown' = 'unknown'): ProviderStatus {
  return {
    mode: mode === 'unknown' ? 'simulation' : mode,
    sourceLabel: 'simulator process',
    shipmentId: null,
    status: null,
    facility: null,
    signal: null,
    loadId: null,
    note: null,
    queue: [],
  };
}

export function resolveProviderSourceLabel(input: {
  mode: LifecycleMode;
  runtimeSource: ProviderRuntimeSource;
}): ProviderSignalSourceLabel {
  if (input.mode === 'manual') {
    return 'manual UI';
  }

  return input.runtimeSource === 'container' ? 'provider container' : 'simulator process';
}

export function shouldReturnShipment(shipmentId: string): boolean {
  let hash = 0;
  for (let index = 0; index < shipmentId.length; index += 1) {
    hash = (hash * 31 + shipmentId.charCodeAt(index)) >>> 0;
  }

  return hash % 5 === 0;
}

export function isProviderSignal(value: unknown): value is ProviderSignal {
  return (
    value === 'LABEL_SCANNED' ||
    value === 'PACKED_INTO_TRUCK' ||
    value === 'OUTBOUND_SCAN' ||
    value === 'DELIVERY_CONFIRMED' ||
    value === 'RETURN_EXCEPTION'
  );
}

export function providerSignalCommandType(signal: ProviderSignal): ProviderSignalCommand['type'] {
  return signal;
}

export function providerSignalFromCommand(message: ProviderSignalCommand): ProviderSignal {
  return message.type;
}

export function isTerminalShipment(status: ShipmentStatus | null | undefined): boolean {
  return status === 'delivered' || status === 'returned';
}

export function expectedProviderSignal(
  shipment: ShipmentContext | undefined
): ProviderSignal | 'DELIVERY_CONFIRMED_OR_RETURN_EXCEPTION' | null {
  if (!shipment || isTerminalShipment(shipment.status)) {
    return null;
  }

  if (!shipment.providerSignal) {
    return 'LABEL_SCANNED';
  }

  if (shipment.providerSignal === 'LABEL_SCANNED') {
    return 'PACKED_INTO_TRUCK';
  }

  if (shipment.providerSignal === 'PACKED_INTO_TRUCK') {
    return 'OUTBOUND_SCAN';
  }

  if (shipment.providerSignal === 'OUTBOUND_SCAN') {
    return 'DELIVERY_CONFIRMED_OR_RETURN_EXCEPTION';
  }

  return null;
}

export function providerSignalMatchesExpected(
  shipment: ShipmentContext | undefined,
  signal: ProviderSignal
): boolean {
  const expected = expectedProviderSignal(shipment);
  return (
    expected === signal ||
    (expected === 'DELIVERY_CONFIRMED_OR_RETURN_EXCEPTION' &&
      (signal === 'DELIVERY_CONFIRMED' || signal === 'RETURN_EXCEPTION'))
  );
}

export function providerSignalExpectationLabel(
  expected: ReturnType<typeof expectedProviderSignal>
): string {
  return expected === 'DELIVERY_CONFIRMED_OR_RETURN_EXCEPTION'
    ? 'DELIVERY_CONFIRMED or RETURN_EXCEPTION'
    : (expected ?? 'no further provider signal');
}

export function clampProviderQueuePage(page: number, queueLength: number): number {
  return Math.min(page, Math.max(0, Math.ceil(queueLength / PROVIDER_QUEUE_PAGE_SIZE) - 1));
}

export function providerStatusFrom(
  mode: LifecycleMode,
  shipmentContexts: Record<string, ShipmentContext>,
  selectedShipmentId: string | null,
  sourceLabel: ProviderSignalSourceLabel
): ProviderStatus {
  const queue = Object.values(shipmentContexts)
    .filter((context) => context.shipmentId)
    .map((context) => ({
      shipmentId: context.shipmentId ?? '',
      destination: context.destination,
      reference: context.reference,
      status: context.status,
      facility: context.providerFacility ?? providerFacilityForShipment(context.shipmentId ?? ''),
      signal: context.providerSignal,
      loadId: context.providerLoadId ?? providerLoadIdForShipment(context.shipmentId ?? ''),
      note: context.providerNote,
      updatedAt:
        context.timeline.at(-1)?.timestamp ??
        Number(context.shipmentId?.replace(/\D/g, '').slice(-8) ?? 0),
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const selected = selectedShipmentId
    ? queue.find((item) => item.shipmentId === selectedShipmentId)
    : undefined;
  const active = queue.find((item) => !isTerminalShipment(item.status));
  const current = selected ?? active ?? queue[0];

  return {
    mode,
    sourceLabel,
    shipmentId: current?.shipmentId ?? null,
    status: current?.status ?? null,
    facility: current?.facility ?? null,
    signal: current?.signal ?? null,
    loadId: current?.loadId ?? null,
    note: current?.note ?? null,
    queue,
  };
}

export function createInitialProviderHqContext(): ProviderHqContext {
  const mode = 'simulation';
  return {
    status: {
      ...emptyProviderStatus(mode),
      sourceLabel: resolveProviderSourceLabel({ mode, runtimeSource: 'embedded' }),
    },
    selectedShipmentId: null,
    queuePage: 0,
    shipmentContexts: {},
    busy: false,
    message: 'Provider HQ ready.',
  };
}

export function upsertProviderShipment(
  context: ProviderHqContext,
  shipment: ShipmentContext
): ProviderHqContext {
  if (!shipment.shipmentId) {
    return context;
  }

  const shipmentContexts = {
    ...context.shipmentContexts,
    [shipment.shipmentId]: {
      ...shipment,
      timeline: shipment.timeline.map((entry) => ({ ...entry })),
    },
  };
  const selectedShipment = context.selectedShipmentId
    ? shipmentContexts[context.selectedShipmentId]
    : undefined;
  const selectedShipmentId =
    selectedShipment && !isTerminalShipment(selectedShipment.status)
      ? context.selectedShipmentId
      : null;
  const nextStatus = providerStatusFrom(
    context.status.mode,
    shipmentContexts,
    selectedShipmentId,
    context.status.sourceLabel
  );

  return {
    ...context,
    status: nextStatus,
    shipmentContexts,
    selectedShipmentId,
    queuePage: clampProviderQueuePage(context.queuePage, nextStatus.queue.length),
    message: `${shipment.shipmentId} queued at Provider HQ.`,
  };
}

export function applyProviderSignalToShipment(
  shipment: ShipmentContext,
  signal: ProviderSignal,
  input: { facility?: string; loadId?: string; note?: string } = {}
): ShipmentContext {
  const shipmentId = shipment.shipmentId ?? 'unknown-shipment';
  return {
    ...shipment,
    status:
      signal === 'OUTBOUND_SCAN'
        ? 'in-transit'
        : signal === 'DELIVERY_CONFIRMED'
          ? 'delivered'
          : signal === 'RETURN_EXCEPTION'
            ? 'returned'
            : shipment.status,
    providerFacility: input.facility ?? providerFacilityForShipment(shipmentId),
    providerSignal: signal,
    providerLoadId: input.loadId ?? providerLoadIdForShipment(shipmentId),
    providerNote: input.note ?? providerNoteForSignal(signal),
  };
}
