import type { LogisticsEventLog } from './headless-host';
import type { ShipmentContext, ShipmentEvent } from './logistics-contract';

export interface RuntimeDisplay {
  source: string;
  via: string;
  tone: string;
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

export function cloneTimeline(timeline: ShipmentContext['timeline']): ShipmentContext['timeline'] {
  return timeline.map((entry) => ({ ...entry }));
}
