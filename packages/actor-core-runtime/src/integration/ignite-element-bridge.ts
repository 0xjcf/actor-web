/**
 * @module actor-core/runtime/integration/ignite-element-bridge
 * @description Minimal host bridge for ignite-element style adapters.
 *
 * This bridge keeps Actor-Web responsible for actor lifecycle, typed commands, and
 * runtime snapshots while letting host layers derive their own UI projections.
 */

import type { ActorRef } from '../actor-ref.js';
import type { ActorAddress, ActorMessage } from '../actor-system.js';
import type { ActorSnapshot, JsonValue, Message } from '../types.js';
import { actorSnapshotPhase } from './fas-shared-contracts.js';

export interface IgniteActorSourceSnapshot<TContext = unknown> extends ActorSnapshot<TContext> {
  address: ActorAddress;
  phase: string;
  toJSON(): object;
}

export interface IgniteActorSource<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
> {
  readonly address: ActorAddress;
  snapshot(): IgniteActorSourceSnapshot<TContext>;
  subscribe(listener: (snapshot: IgniteActorSourceSnapshot<TContext>) => void): () => void;
  send(message: TMessage): Promise<void>;
  ask<TResponse = JsonValue>(message: TMessage, timeout?: number): Promise<TResponse>;
}

export interface SnapshotSubscribableActorRef<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
> extends ActorRef<TContext, TMessage> {
  subscribeSnapshot(listener: (snapshot: ActorSnapshot<TContext>) => void): () => void;
}

export interface CreateIgniteActorSourceOptions<TContext = unknown> {
  subscribeSnapshot?: (listener: (snapshot: ActorSnapshot<TContext>) => void) => () => void;
}

export function isSnapshotSubscribableActorRef<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
>(value: ActorRef<TContext, TMessage>): value is SnapshotSubscribableActorRef<TContext, TMessage> {
  return typeof value.subscribeSnapshot === 'function';
}

export function actorSnapshotToIgniteSourceSnapshot<TContext = unknown>(
  address: ActorAddress,
  snapshot: ActorSnapshot<TContext>
): IgniteActorSourceSnapshot<TContext> {
  const phase = actorSnapshotPhase(snapshot.value);

  return {
    ...snapshot,
    address,
    phase,
    toJSON: () => ({
      ...snapshot.toJSON(),
      address,
      phase,
    }),
  };
}

export function createIgniteActorSource<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
>(
  actorRef: ActorRef<TContext, TMessage>,
  options: CreateIgniteActorSourceOptions<TContext> = {}
): IgniteActorSource<TContext, TMessage> {
  const subscribeSnapshot =
    options.subscribeSnapshot ??
    (isSnapshotSubscribableActorRef(actorRef)
      ? actorRef.subscribeSnapshot.bind(actorRef)
      : undefined);

  if (!subscribeSnapshot) {
    throw new Error(
      'ActorRef does not expose snapshot subscriptions. Pass createIgniteActorSource(..., { subscribeSnapshot }) or use a createActorRef()-backed ref.'
    );
  }

  return {
    address: actorRef.address,
    snapshot(): IgniteActorSourceSnapshot<TContext> {
      return actorSnapshotToIgniteSourceSnapshot(actorRef.address, actorRef.getSnapshot());
    },
    subscribe(listener: (snapshot: IgniteActorSourceSnapshot<TContext>) => void): () => void {
      listener(actorSnapshotToIgniteSourceSnapshot(actorRef.address, actorRef.getSnapshot()));

      return subscribeSnapshot((snapshot) => {
        listener(actorSnapshotToIgniteSourceSnapshot(actorRef.address, snapshot));
      });
    },
    send(message: TMessage): Promise<void> {
      return actorRef.send(message);
    },
    ask<TResponse = JsonValue>(message: TMessage, timeout?: number): Promise<TResponse> {
      return actorRef.ask<TResponse>(message as unknown as Message, timeout);
    },
  };
}
