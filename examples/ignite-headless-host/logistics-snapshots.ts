import type { ActorSnapshot, ActorSourceSnapshot } from '@actor-web/runtime/browser';
import { actorSnapshotToSourceSnapshot } from '@actor-web/runtime/browser';
import { createInitialShipmentContext, type ShipmentContext } from './logistics-contract';
import { logistics } from './logistics-topology';

export function createActorSnapshot<TContext>(
  value: unknown,
  context: TContext,
  status: ActorSnapshot<TContext>['status'] = 'running'
): ActorSnapshot<TContext> {
  return {
    value,
    context,
    status,
    matches: (state: string) => state === value,
    can: () => status === 'running',
    hasTag: () => false,
    toJSON: () => ({
      value,
      context,
      status,
    }),
  };
}

export function createPlaceholderSnapshot(): ActorSourceSnapshot<ShipmentContext> {
  return actorSnapshotToSourceSnapshot(
    logistics.actors.shipment.address,
    createActorSnapshot('idle', createInitialShipmentContext())
  );
}

export function normalizeShipmentSnapshot(
  snapshot: ActorSourceSnapshot<ShipmentContext>
): ActorSourceSnapshot<ShipmentContext> {
  const derivedPhase = snapshot.context.status;

  if (derivedPhase === snapshot.phase) {
    return snapshot;
  }

  return {
    ...snapshot,
    phase: derivedPhase,
    toJSON: () => ({
      ...snapshot.toJSON(),
      phase: derivedPhase,
    }),
  };
}
