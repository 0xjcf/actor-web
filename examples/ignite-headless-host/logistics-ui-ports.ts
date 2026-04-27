import type { ActorWebSourceHandle } from 'ignite-element/actor-web';
import type { ShipmentCommand, ShipmentContext, ShipmentEvent } from './logistics-contract';
import { logistics } from './logistics-topology';
import { createLogisticsTopologySources } from './runtime-harness';

export interface CreateShipmentInput {
  destination: string;
  reference?: string | null;
  shipmentId?: string;
}

interface ShipmentCommandActor {
  send(message: ShipmentCommand): Promise<unknown>;
}

export interface LogisticsShipmentPortsOptions {
  actor: ShipmentCommandActor;
  restUrl?: string | null;
  createShipmentId?: () => string;
}

export function configuredRestUrl(): string | undefined {
  const configuredUrl = import.meta.env.VITE_ACTOR_WEB_REST_URL;
  return typeof configuredUrl === 'string' && configuredUrl.trim().length > 0
    ? configuredUrl.replace(/\/$/, '')
    : undefined;
}

async function submitShipment(
  actor: ShipmentCommandActor,
  input: CreateShipmentInput,
  restUrl: string | null,
  createShipmentId: () => string
): Promise<void> {
  const destination = input.destination.trim();
  if (destination.length === 0) {
    return;
  }

  const shipmentId = input.shipmentId ?? createShipmentId();
  const reference = input.reference?.trim() || undefined;

  if (restUrl) {
    const response = await fetch(`${restUrl}/shipments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId,
        destination,
        reference,
      }),
    });
    if (!response.ok) {
      throw new Error(`Shipment REST ingress failed with ${response.status}.`);
    }
    return;
  }

  await actor.send({
    type: 'CREATE_SHIPMENT',
    shipmentId,
    destination,
    reference,
  });
}

function createShipmentId(): string {
  return `shipment-${Date.now().toString(36)}`;
}

function createSourceHandle(
  actor: typeof logistics.actors.shipment | typeof logistics.actors.routing
): ActorWebSourceHandle<ShipmentContext, ShipmentCommand, ShipmentEvent> {
  const runtimeSources = createLogisticsTopologySources();
  const source =
    actor.key === logistics.actors.routing.key
      ? (runtimeSources.routingSource ?? runtimeSources.source)
      : runtimeSources.source;

  return {
    source,
    stop: runtimeSources.destroy,
  };
}

export const logisticsSources = {
  shipment(): ActorWebSourceHandle<ShipmentContext, ShipmentCommand, ShipmentEvent> {
    return createSourceHandle(logistics.actors.shipment);
  },

  routing(): ActorWebSourceHandle<ShipmentContext, ShipmentCommand, ShipmentEvent> {
    return createSourceHandle(logistics.actors.routing);
  },
};

export const logisticsPorts = {
  shipments(options: LogisticsShipmentPortsOptions) {
    const restUrl = options.restUrl ?? null;
    const nextShipmentId = options.createShipmentId ?? createShipmentId;

    return {
      createShipment(input: CreateShipmentInput): Promise<void> {
        return submitShipment(options.actor, input, restUrl, nextShipmentId);
      },

      resetShipment(): Promise<unknown> {
        return options.actor.send({ type: 'RESET_SHIPMENT' });
      },
    };
  },
};
