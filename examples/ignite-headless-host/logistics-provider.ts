import type {
  ProviderSignal,
  ShipmentContext,
  ShipmentEvent,
  ShipmentStatus,
  ShipmentTimelineEntry,
} from './logistics-contract';

export function appendTimeline(
  context: ShipmentContext,
  label: string,
  detail: string,
  metadata: Omit<ShipmentTimelineEntry, 'label' | 'detail'> = {}
): ShipmentTimelineEntry[] {
  return [{ label, detail, timestamp: Date.now(), ...metadata }, ...context.timeline];
}

export function providerTimeline(signal: ProviderSignal): { label: string; detail: string } {
  switch (signal) {
    case 'LABEL_SCANNED':
      return {
        label: 'Provider label scan',
        detail: 'Shipment label scanned at provider HQ',
      };
    case 'PACKED_INTO_TRUCK':
      return {
        label: 'Packed into truck',
        detail: 'Provider packed the shipment into the assigned load',
      };
    case 'OUTBOUND_SCAN':
      return {
        label: 'Shipped',
        detail: 'Provider outbound scan completed',
      };
    case 'DELIVERY_CONFIRMED':
      return {
        label: 'Delivered',
        detail: 'Delivery confirmed at destination dock',
      };
    case 'RETURN_EXCEPTION':
      return {
        label: 'Returned',
        detail: 'Provider reported a return exception',
      };
  }
}

export function statusForProviderSignal(
  signal: ProviderSignal,
  current: ShipmentStatus
): ShipmentStatus {
  switch (signal) {
    case 'OUTBOUND_SCAN':
      return 'in-transit';
    case 'DELIVERY_CONFIRMED':
      return 'delivered';
    case 'RETURN_EXCEPTION':
      return 'returned';
    default:
      return current;
  }
}

export function eventForProviderSignal(
  signal: ProviderSignal,
  shipmentId: string
): ShipmentEvent[] {
  const providerEvent = {
    type: 'PROVIDER_SIGNAL_RECORDED' as const,
    shipmentId,
    signal,
    facility: providerFacilityForShipment(shipmentId),
    loadId: providerLoadIdForShipment(shipmentId),
  };

  if (signal === 'OUTBOUND_SCAN') {
    return [providerEvent, { type: 'SHIPMENT_IN_TRANSIT', shipmentId }];
  }

  if (signal === 'DELIVERY_CONFIRMED') {
    return [providerEvent, { type: 'SHIPMENT_DELIVERED', shipmentId }];
  }

  if (signal === 'RETURN_EXCEPTION') {
    return [providerEvent, { type: 'SHIPMENT_RETURNED', shipmentId }];
  }

  return [providerEvent];
}

export function providerFacilityForShipment(seed: string): string {
  const facilities = ['ORD Provider HQ', 'DFW Fulfillment Hub', 'LAX Cross-Dock'];
  const index = Math.abs(hashString(seed)) % facilities.length;
  return facilities[index];
}

export function providerLoadIdForShipment(seed: string): string {
  return `LOAD-${Math.abs(hashString(seed)).toString(36).slice(0, 5).toUpperCase()}`;
}

export function providerNoteForSignal(signal: ProviderSignal): string {
  switch (signal) {
    case 'LABEL_SCANNED':
      return 'Label barcode matched shipment manifest.';
    case 'PACKED_INTO_TRUCK':
      return 'Shipment was packed into the assigned truck load.';
    case 'OUTBOUND_SCAN':
      return 'Carrier accepted handoff and outbound scan was recorded.';
    case 'DELIVERY_CONFIRMED':
      return 'Destination dock confirmed delivery.';
    case 'RETURN_EXCEPTION':
      return 'Return exception triggered by address validation hold.';
  }
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return hash;
}
