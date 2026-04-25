import type { ActorSnapshot, IgniteActorSourceSnapshot } from '@actor-core/runtime/browser';
import { actorSnapshotToIgniteSourceSnapshot } from '@actor-core/runtime/browser';
import {
  createInitialShipmentContext,
  REMOTE_ADDRESS,
  type ShipmentContext,
} from './logistics-contract';

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

export function createPlaceholderSnapshot(): IgniteActorSourceSnapshot<ShipmentContext> {
  return actorSnapshotToIgniteSourceSnapshot(
    REMOTE_ADDRESS,
    createActorSnapshot('idle', createInitialShipmentContext())
  );
}

export function normalizeShipmentSnapshot(
  snapshot: IgniteActorSourceSnapshot<ShipmentContext>
): IgniteActorSourceSnapshot<ShipmentContext> {
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
