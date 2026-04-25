export type ShipmentStatus =
  | 'idle'
  | 'accepted'
  | 'route-requested'
  | 'route-assigned'
  | 'in-transit'
  | 'delivered'
  | 'returned';

export type ProviderSignal =
  | 'LABEL_SCANNED'
  | 'PACKED_INTO_TRUCK'
  | 'OUTBOUND_SCAN'
  | 'DELIVERY_CONFIRMED'
  | 'RETURN_EXCEPTION';

export interface ShipmentTimelineEntry {
  label: string;
  detail: string;
  source?: string;
  channel?: string;
  note?: string;
  timestamp?: number;
  facility?: string;
  signal?: ProviderSignal;
  loadId?: string;
}

export interface ShipmentContext {
  shipmentId: string | null;
  destination: string | null;
  reference: string | null;
  status: ShipmentStatus;
  carrier: string | null;
  eta: string | null;
  routeNotes: string | null;
  providerFacility: string | null;
  providerSignal: ProviderSignal | null;
  providerLoadId: string | null;
  providerNote: string | null;
  shipmentCount: number;
  timeline: ShipmentTimelineEntry[];
}

export type RoutePlan = {
  shipmentId: string;
  carrier: string;
  eta: string;
  routeNotes: string;
};

export type ShipmentCommand =
  | { type: 'CREATE_SHIPMENT'; shipmentId: string; destination: string; reference?: string }
  | { type: 'RESET_SHIPMENT'; shipmentId?: string }
  | { type: 'GET_SHIPMENT_COUNT' }
  | { type: 'PLAN_ROUTE'; shipmentId: string; destination: string; reference?: string }
  | { type: 'ASSIGN_ROUTE'; plan: RoutePlan }
  | { type: 'MARK_IN_TRANSIT'; shipmentId?: string }
  | { type: 'MARK_DELIVERED'; shipmentId?: string }
  | { type: 'MARK_RETURNED'; shipmentId?: string }
  | {
      type: 'APPLY_PROVIDER_SIGNAL';
      shipmentId?: string;
      signal: ProviderSignal;
      facility?: string;
      loadId?: string;
      note?: string;
      baseContext?: ShipmentContext;
    };

export type ShipmentEvent =
  | { type: 'SHIPMENT_CREATED'; shipmentId: string; destination: string }
  | { type: 'ROUTE_REQUESTED'; shipmentId: string; destination: string }
  | { type: 'ROUTE_ASSIGNED'; shipmentId: string; carrier: string; eta: string }
  | { type: 'SHIPMENT_IN_TRANSIT'; shipmentId: string }
  | { type: 'SHIPMENT_DELIVERED'; shipmentId: string }
  | { type: 'SHIPMENT_RETURNED'; shipmentId: string }
  | {
      type: 'PROVIDER_SIGNAL_RECORDED';
      shipmentId: string;
      signal: ProviderSignal;
      facility: string;
      loadId: string;
    }
  | { type: 'SHIPMENT_RESET'; shipmentId: string | null };

export const LOCAL_NODE = 'logistics-browser-host';
export const REMOTE_NODE = 'logistics-server-runtime';
export const REMOTE_ACTOR_ID = 'logistics-shipment';
export const WORKER_NODE = 'logistics-worker-runtime';
export const WORKER_ACTOR_ID = 'logistics-routing';

export const REMOTE_ADDRESS = {
  id: REMOTE_ACTOR_ID,
  type: 'actor',
  node: REMOTE_NODE,
  path: `actor://${REMOTE_NODE}/actor/${REMOTE_ACTOR_ID}`,
} as const;

export const WORKER_ADDRESS = {
  id: WORKER_ACTOR_ID,
  type: 'actor',
  node: WORKER_NODE,
  path: `actor://${WORKER_NODE}/actor/${WORKER_ACTOR_ID}`,
} as const;

export function createInitialShipmentContext(): ShipmentContext {
  return {
    shipmentId: null,
    destination: null,
    reference: null,
    status: 'idle',
    carrier: null,
    eta: null,
    routeNotes: null,
    providerFacility: null,
    providerSignal: null,
    providerLoadId: null,
    providerNote: null,
    shipmentCount: 0,
    timeline: [],
  };
}
