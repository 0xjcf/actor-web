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

export type ProviderSignalCommand =
  | {
      type: 'LABEL_SCANNED';
      shipmentId?: string;
      facility?: string;
      loadId?: string;
      note?: string;
    }
  | {
      type: 'PACKED_INTO_TRUCK';
      shipmentId?: string;
      facility?: string;
      loadId?: string;
      note?: string;
    }
  | {
      type: 'OUTBOUND_SCAN';
      shipmentId?: string;
      facility?: string;
      loadId?: string;
      note?: string;
    }
  | {
      type: 'DELIVERY_CONFIRMED';
      shipmentId?: string;
      facility?: string;
      loadId?: string;
      note?: string;
    }
  | {
      type: 'RETURN_EXCEPTION';
      shipmentId?: string;
      facility?: string;
      loadId?: string;
      note?: string;
    };

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

export interface ServiceWorkerProofContext {
  status: 'idle' | 'connected';
  pingCount: number;
  lastPingAt: number | null;
}

export type ServiceWorkerProofCommand = { type: 'PING_SERVICE_WORKER'; sentAt?: number };

export type ServiceWorkerProofEvent = { type: 'SERVICE_WORKER_PONG'; pingCount: number };

export interface ProviderHqContext {
  status: import('./logistics-provider-hq').ProviderStatus;
  selectedShipmentId: string | null;
  queuePage: number;
  shipmentContexts: Record<string, ShipmentContext>;
  busy: boolean;
  message: string;
}

export type ProviderShipmentCommand =
  | { type: 'SYNC_PROVIDER_SHIPMENT'; shipment: ShipmentContext }
  | ProviderSignalCommand;

export type ProviderShipmentSignalResult =
  | {
      ok: true;
      shipment: ShipmentContext;
      signal: ProviderSignal;
    }
  | {
      ok: false;
      shipmentId: string | null;
      signal: ProviderSignal;
      expected: string;
      reason: string;
    };

export type ProviderShipmentEvent =
  | { type: 'PROVIDER_SHIPMENT_SYNCED'; shipmentId: string }
  | { type: 'PROVIDER_SHIPMENT_SIGNAL_ACCEPTED'; shipmentId: string; signal: ProviderSignal };

export type ShipmentCommand =
  | { type: 'CREATE_SHIPMENT'; shipmentId: string; destination: string; reference?: string }
  | { type: 'RESET_SHIPMENT'; shipmentId?: string }
  | { type: 'GET_SHIPMENT_COUNT' }
  | { type: 'UPSERT_SHIPMENT_PROJECTION'; shipment: ShipmentContext; event?: ShipmentEvent }
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
      sourceLabel?: string;
      channelLabel?: string;
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

function isProviderSignalValue(value: unknown): value is ProviderSignal {
  return (
    value === 'LABEL_SCANNED' ||
    value === 'PACKED_INTO_TRUCK' ||
    value === 'OUTBOUND_SCAN' ||
    value === 'DELIVERY_CONFIRMED' ||
    value === 'RETURN_EXCEPTION'
  );
}

function isProviderSourceLabelValue(value: unknown): value is ProviderSignalSourceLabel {
  return value === 'manual UI' || value === 'simulator process' || value === 'provider container';
}

export function isShipmentEvent(value: unknown): value is ShipmentEvent {
  if (!value || typeof value !== 'object' || !('type' in value)) {
    return false;
  }

  const event = value as {
    type: unknown;
    shipmentId?: unknown;
    destination?: unknown;
    carrier?: unknown;
    eta?: unknown;
    signal?: unknown;
    facility?: unknown;
    loadId?: unknown;
  };

  return (
    ((event.type === 'SHIPMENT_CREATED' || event.type === 'ROUTE_REQUESTED') &&
      typeof event.shipmentId === 'string' &&
      typeof event.destination === 'string') ||
    (event.type === 'ROUTE_ASSIGNED' &&
      typeof event.shipmentId === 'string' &&
      typeof event.carrier === 'string' &&
      typeof event.eta === 'string') ||
    ((event.type === 'SHIPMENT_IN_TRANSIT' ||
      event.type === 'SHIPMENT_DELIVERED' ||
      event.type === 'SHIPMENT_RETURNED') &&
      typeof event.shipmentId === 'string') ||
    (event.type === 'PROVIDER_SIGNAL_RECORDED' &&
      typeof event.shipmentId === 'string' &&
      isProviderSignalValue(event.signal) &&
      typeof event.facility === 'string' &&
      typeof event.loadId === 'string') ||
    (event.type === 'SHIPMENT_RESET' &&
      (typeof event.shipmentId === 'string' || event.shipmentId === null))
  );
}

export type ProviderHqCommand =
  | { type: 'REFRESH_PROVIDER_STATUS' }
  | { type: 'SET_PROVIDER_MODE'; mode: import('./logistics-provider-hq').LifecycleMode }
  | { type: 'SET_PROVIDER_SOURCE_LABEL'; sourceLabel: ProviderSignalSourceLabel }
  | { type: 'SELECT_PROVIDER_SHIPMENT'; shipmentId: string }
  | { type: 'PROVIDER_QUEUE_NEXT' }
  | { type: 'PROVIDER_QUEUE_PREV' }
  | { type: 'UPSERT_PROVIDER_SHIPMENT'; shipment: ShipmentContext }
  | { type: 'REPORT_PROVIDER_SIGNAL_ACCEPTED'; shipment: ShipmentContext; signal: ProviderSignal }
  | {
      type: 'REPORT_PROVIDER_SIGNAL_REJECTED';
      shipmentId: string | null;
      signal: ProviderSignal;
      expected: string;
      reason: string;
    }
  | { type: 'CLEAR_PROVIDER_QUEUE' }
  | ProviderSignalCommand;

export type ProviderHqEvent =
  | { type: 'PROVIDER_STATUS_REFRESHED' }
  | { type: 'PROVIDER_MODE_CHANGED'; mode: import('./logistics-provider-hq').LifecycleMode }
  | { type: 'PROVIDER_SOURCE_LABEL_CHANGED'; sourceLabel: ProviderSignalSourceLabel }
  | { type: 'PROVIDER_SHIPMENT_SELECTED'; shipmentId: string | null }
  | { type: 'PROVIDER_SIGNAL_REQUESTED'; shipmentId: string; signal: ProviderSignal }
  | { type: 'PROVIDER_SIGNAL_SUBMITTED'; shipmentId: string; signal: ProviderSignal }
  | {
      type: 'PROVIDER_SIGNAL_REJECTED';
      shipmentId: string | null;
      signal: ProviderSignal;
      expected: string;
      reason: string;
    };

export interface LogisticsSupervisorContext {
  activeShipments: number;
  exceptions: number;
  lastDecision: string | null;
}

export type LogisticsSupervisorCommand =
  | { type: 'OBSERVE_SHIPMENT_CREATED'; shipmentId: string }
  | { type: 'OBSERVE_SHIPMENT_EXCEPTION'; shipmentId: string; reason: string }
  | { type: 'OBSERVE_SHIPMENT_COMPLETED'; shipmentId: string };

export type LogisticsSupervisorEvent = {
  type: 'LOGISTICS_SUPERVISOR_DECISION_RECORDED';
  decision: string;
};

export interface DispatcherContext {
  assignedShipments: number;
  lastShipmentId: string | null;
  lastCarrier: string | null;
  lastDriverId: string | null;
}

export type DispatcherCommand =
  | { type: 'DISPATCH_SHIPMENT'; shipmentId: string; destination: string; reference?: string }
  | { type: 'RECORD_ROUTE_ASSIGNMENT'; plan: RoutePlan; driverId: string };

export type DispatcherEvent =
  | { type: 'SHIPMENT_DISPATCH_REQUESTED'; shipmentId: string; destination: string }
  | { type: 'SHIPMENT_DRIVER_ASSIGNED'; shipmentId: string; driverId: string; carrier: string };

export interface DriverDirectoryContext {
  assignedDrivers: Record<string, string>;
  lastDriverId: string | null;
}

export type DriverDirectoryCommand = {
  type: 'ASSIGN_DRIVER';
  shipmentId: string;
  carrier: string;
  destination: string;
};

export type DriverDirectoryEvent = {
  type: 'DRIVER_ASSIGNED';
  shipmentId: string;
  driverId: string;
};

export function isProviderHqEvent(value: unknown): value is ProviderHqEvent {
  if (!value || typeof value !== 'object' || !('type' in value)) {
    return false;
  }

  const event = value as {
    type: unknown;
    shipmentId?: unknown;
    signal?: unknown;
    mode?: unknown;
    sourceLabel?: unknown;
    expected?: unknown;
    reason?: unknown;
  };

  return (
    event.type === 'PROVIDER_STATUS_REFRESHED' ||
    (event.type === 'PROVIDER_MODE_CHANGED' &&
      (event.mode === 'simulation' || event.mode === 'manual')) ||
    (event.type === 'PROVIDER_SOURCE_LABEL_CHANGED' &&
      isProviderSourceLabelValue(event.sourceLabel)) ||
    (event.type === 'PROVIDER_SHIPMENT_SELECTED' &&
      (typeof event.shipmentId === 'string' || event.shipmentId === null)) ||
    (event.type === 'PROVIDER_SIGNAL_REQUESTED' &&
      typeof event.shipmentId === 'string' &&
      isProviderSignalValue(event.signal)) ||
    (event.type === 'PROVIDER_SIGNAL_REJECTED' &&
      (typeof event.shipmentId === 'string' || event.shipmentId === null) &&
      isProviderSignalValue(event.signal) &&
      typeof event.expected === 'string' &&
      typeof event.reason === 'string') ||
    (event.type === 'PROVIDER_SIGNAL_SUBMITTED' &&
      typeof event.shipmentId === 'string' &&
      isProviderSignalValue(event.signal))
  );
}

export const LOCAL_NODE = 'logistics-browser-host';
export const REMOTE_NODE = 'logistics-server-runtime';
export const REMOTE_ACTOR_ID = 'logistics-shipment';
export const PROVIDER_HQ_ACTOR_ID = 'logistics-provider-hq';
export const PROVIDER_NODE = 'logistics-provider-runtime';
export const PROVIDER_RUNTIME_ACTOR_ID = 'logistics-provider-runtime-manager';
export const LOGISTICS_SUPERVISOR_ACTOR_ID = 'logistics-supervisor';
export const DISPATCHER_ACTOR_ID = 'logistics-dispatcher';
export const DRIVER_DIRECTORY_ACTOR_ID = 'logistics-driver-directory';
export const WORKER_NODE = 'logistics-worker-runtime';
export const WORKER_ACTOR_ID = 'logistics-routing';
export const SERVICE_WORKER_NODE = 'logistics-service-worker-runtime';
export const SERVICE_WORKER_ACTOR_ID = 'logistics-service-worker-proof';

export type ProviderRuntimeSource = 'embedded' | 'process' | 'container';
export type ProviderSignalSourceLabel = 'manual UI' | 'simulator process' | 'provider container';

export const REMOTE_ADDRESS = {
  id: REMOTE_ACTOR_ID,
  kind: 'actor',
  node: REMOTE_NODE,
  path: `actor://${REMOTE_NODE}/${REMOTE_ACTOR_ID}`,
} as const;

export const PROVIDER_HQ_ADDRESS = {
  id: PROVIDER_HQ_ACTOR_ID,
  kind: 'actor',
  node: REMOTE_NODE,
  path: `actor://${REMOTE_NODE}/${PROVIDER_HQ_ACTOR_ID}`,
} as const;

export const PROVIDER_RUNTIME_ADDRESS = {
  id: PROVIDER_RUNTIME_ACTOR_ID,
  kind: 'actor',
  node: PROVIDER_NODE,
  path: `actor://${PROVIDER_NODE}/${PROVIDER_RUNTIME_ACTOR_ID}`,
} as const;

export type ProviderRuntimeCommand =
  | { type: 'SYNC_PROVIDER_RUNTIME_SHIPMENT'; shipment: ShipmentContext }
  | { type: 'RESET_PROVIDER_RUNTIME' }
  | {
      type: 'PROCESS_PROVIDER_RUNTIME_SIGNAL';
      shipmentId: string;
      signal: ProviderSignal;
      facility?: string;
      loadId?: string;
      note?: string;
    };

export const LOGISTICS_SUPERVISOR_ADDRESS = {
  id: LOGISTICS_SUPERVISOR_ACTOR_ID,
  kind: 'actor',
  node: REMOTE_NODE,
  path: `actor://${REMOTE_NODE}/${LOGISTICS_SUPERVISOR_ACTOR_ID}`,
} as const;

export const DISPATCHER_ADDRESS = {
  id: DISPATCHER_ACTOR_ID,
  kind: 'actor',
  node: REMOTE_NODE,
  path: `actor://${REMOTE_NODE}/${DISPATCHER_ACTOR_ID}`,
} as const;

export const DRIVER_DIRECTORY_ADDRESS = {
  id: DRIVER_DIRECTORY_ACTOR_ID,
  kind: 'actor',
  node: REMOTE_NODE,
  path: `actor://${REMOTE_NODE}/${DRIVER_DIRECTORY_ACTOR_ID}`,
} as const;

export const WORKER_ADDRESS = {
  id: WORKER_ACTOR_ID,
  kind: 'actor',
  node: WORKER_NODE,
  path: `actor://${WORKER_NODE}/${WORKER_ACTOR_ID}`,
} as const;

export const SERVICE_WORKER_ADDRESS = {
  id: SERVICE_WORKER_ACTOR_ID,
  kind: 'actor',
  node: SERVICE_WORKER_NODE,
  path: `actor://${SERVICE_WORKER_NODE}/${SERVICE_WORKER_ACTOR_ID}`,
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

export function createInitialServiceWorkerProofContext(): ServiceWorkerProofContext {
  return {
    status: 'idle',
    pingCount: 0,
    lastPingAt: null,
  };
}

export function createInitialLogisticsSupervisorContext(): LogisticsSupervisorContext {
  return {
    activeShipments: 0,
    exceptions: 0,
    lastDecision: null,
  };
}

export function createInitialDispatcherContext(): DispatcherContext {
  return {
    assignedShipments: 0,
    lastShipmentId: null,
    lastCarrier: null,
    lastDriverId: null,
  };
}

export function createInitialDriverDirectoryContext(): DriverDirectoryContext {
  return {
    assignedDrivers: {},
    lastDriverId: null,
  };
}
