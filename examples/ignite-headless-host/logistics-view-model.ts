import type { ShipmentContext, ShipmentEvent } from './logistics-contract';

export interface LogisticsEventLog {
  type: ShipmentEvent['type'];
  shipmentId: string | null;
  actorId: string;
}

export interface RuntimeDisplay {
  source: string;
  via: string;
  tone: string;
}

export interface ProjectedLogisticsEventLog extends LogisticsEventLog {
  runtime: RuntimeDisplay;
  actorLabel: string;
}

export type ProjectedTimelineEntry = ShipmentContext['timeline'][number] & {
  runtime: RuntimeDisplay;
};

export interface PaginatedItems<T> {
  canGoToNextPage: boolean;
  canGoToPreviousPage: boolean;
  items: T[];
  page: number;
  pageCount: number;
  total: number;
}

export function paginateItems<T>(
  items: readonly T[],
  requestedPage: number,
  pageSize: number
): PaginatedItems<T> {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(0, requestedPage), pageCount - 1);
  const start = page * pageSize;

  return {
    canGoToNextPage: page + 1 < pageCount,
    canGoToPreviousPage: page > 0,
    items: items.slice(start, start + pageSize),
    page,
    pageCount,
    total,
  };
}

export function eventRuntime(eventType: ShipmentEvent['type']): RuntimeDisplay {
  if (eventType === 'ROUTE_ASSIGNED') {
    return {
      source: 'Worker -> Server',
      via: 'Actor-Web transport + gateway WS',
      tone: 'tone-worker',
    };
  }

  if (eventType === 'PROVIDER_SIGNAL_RECORDED') {
    return {
      source: 'Remote Provider HQ',
      via: 'provider signal -> server runtime -> gateway WS',
      tone: 'tone-provider',
    };
  }

  if (eventType === 'SHIPMENT_CREATED' || eventType === 'ROUTE_REQUESTED') {
    return {
      source: 'Server Runtime',
      via: 'REST ingress + gateway WS',
      tone: 'tone-server',
    };
  }

  if (
    eventType === 'SHIPMENT_IN_TRANSIT' ||
    eventType === 'SHIPMENT_DELIVERED' ||
    eventType === 'SHIPMENT_RETURNED'
  ) {
    return {
      source: 'Server Lifecycle',
      via: 'gateway WS',
      tone: 'tone-lifecycle',
    };
  }

  return {
    source: 'Server Runtime',
    via: 'gateway command + gateway WS',
    tone: 'tone-server',
  };
}

export function timelineRuntime(label: string): RuntimeDisplay {
  if (label === 'Route assigned') {
    return {
      source: 'Worker Routing Runtime',
      via: 'Actor-Web transport',
      tone: 'tone-worker',
    };
  }

  if (label === 'Shipped' || label === 'Delivered' || label === 'Returned') {
    return {
      source: 'Server Lifecycle',
      via: 'gateway WS update',
      tone: 'tone-lifecycle',
    };
  }

  if (label === 'Provider label scan' || label === 'Packed into truck') {
    return {
      source: 'Remote Provider HQ',
      via: 'provider signal',
      tone: 'tone-provider',
    };
  }

  return {
    source: 'Server Shipment Runtime',
    via: 'REST command ingress',
    tone: 'tone-server',
  };
}

export function projectEventLogItem(event: ShipmentEvent, actorId: string): LogisticsEventLog {
  return {
    type: event.type,
    shipmentId: 'shipmentId' in event ? event.shipmentId : null,
    actorId,
  };
}

export function projectEventLogViewItem(event: LogisticsEventLog): ProjectedLogisticsEventLog {
  return {
    ...event,
    runtime: eventRuntime(event.type),
    actorLabel: `Actor ${event.actorId}${event.shipmentId ? ` / ${event.shipmentId}` : ''}`,
  };
}

export function projectTimelineEntry(
  entry: ShipmentContext['timeline'][number]
): ProjectedTimelineEntry {
  return {
    ...entry,
    runtime: timelineRuntime(entry.label),
  };
}

export function projectTimeline(timeline: ShipmentContext['timeline']): ProjectedTimelineEntry[] {
  return timeline.map((entry) => projectTimelineEntry(entry));
}
