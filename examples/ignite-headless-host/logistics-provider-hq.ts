import type { ProviderSignal, ShipmentContext, ShipmentStatus } from './logistics-contract';
import { providerFacilityForShipment, providerLoadIdForShipment } from './logistics-provider';

export type LifecycleMode = 'simulation' | 'manual';

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
  shipmentId: string | null;
  status: ShipmentStatus | null;
  facility: string | null;
  signal: ProviderSignal | null;
  loadId: string | null;
  note: string | null;
  queue: ProviderQueueItem[];
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

export class LogisticsProviderQueue {
  private readonly providerQueue = new Map<string, ProviderQueueItem>();
  private readonly shipmentContexts = new Map<string, ShipmentContext>();

  upsert(context: ShipmentContext): void {
    if (!context.shipmentId) {
      return;
    }

    this.shipmentContexts.set(context.shipmentId, {
      ...context,
      timeline: context.timeline.map((entry) => ({ ...entry })),
    });

    const current = this.providerQueue.get(context.shipmentId);
    this.providerQueue.set(context.shipmentId, {
      shipmentId: context.shipmentId,
      destination: context.destination ?? current?.destination ?? null,
      reference: context.reference ?? current?.reference ?? null,
      status: context.status,
      facility:
        context.providerFacility ??
        current?.facility ??
        providerFacilityForShipment(context.shipmentId),
      signal: context.providerSignal ?? current?.signal ?? null,
      loadId:
        context.providerLoadId ?? current?.loadId ?? providerLoadIdForShipment(context.shipmentId),
      note: context.providerNote ?? current?.note ?? null,
      updatedAt: Date.now(),
    });
  }

  items(): ProviderQueueItem[] {
    return Array.from(this.providerQueue.values()).sort(
      (left, right) => right.updatedAt - left.updatedAt
    );
  }

  selectedShipmentId(): string | null {
    const items = this.items();
    const active = items.find((item) => item.status !== 'delivered' && item.status !== 'returned');
    return active?.shipmentId ?? items[0]?.shipmentId ?? null;
  }

  contextFor(shipmentId: string): ShipmentContext | undefined {
    return this.shipmentContexts.get(shipmentId);
  }

  clear(): void {
    this.providerQueue.clear();
    this.shipmentContexts.clear();
  }

  status(mode: LifecycleMode, snapshot: ShipmentContext | null): ProviderStatus {
    const selectedShipmentId = this.selectedShipmentId();
    const queued = selectedShipmentId ? this.providerQueue.get(selectedShipmentId) : undefined;

    return {
      mode,
      shipmentId: queued?.shipmentId ?? snapshot?.shipmentId ?? null,
      status: queued?.status ?? snapshot?.status ?? null,
      facility: queued?.facility ?? snapshot?.providerFacility ?? null,
      signal: queued?.signal ?? snapshot?.providerSignal ?? null,
      loadId: queued?.loadId ?? snapshot?.providerLoadId ?? null,
      note: queued?.note ?? snapshot?.providerNote ?? null,
      queue: this.items(),
    };
  }
}
