/**
 * @module actor-core/runtime/integration/ignite-element-bridge
 * @description Minimal host bridge for ignite-element style adapters.
 *
 * This bridge keeps Actor-Web responsible for actor lifecycle, typed commands, and
 * runtime snapshots while letting host layers derive their own UI projections.
 * It can also accept explicit remote snapshot/event transport for foreign sources
 * or non-Actor-Web runtimes that do not participate in the runtime node registry.
 */

import type { ActorEventSubscriptionOptions, ActorRef } from '../actor-ref.js';
import type { ActorAddress, ActorMessage } from '../actor-system.js';
import {
  createProjectionTransportStatus,
  type ProjectionTransportStatus,
} from '../projection-transport.js';
import type { ActorSnapshot, JsonValue, Message } from '../types.js';
import { actorSnapshotPhase } from './fas-shared-contracts.js';

export interface IgniteActorSourceSnapshot<TContext = unknown> extends ActorSnapshot<TContext> {
  address: ActorAddress;
  phase: string;
  toJSON(): object;
}

export interface IgniteReadModelSource<
  TContext = unknown,
  TEvent extends ActorMessage = ActorMessage,
> {
  readonly address: ActorAddress;
  snapshot(): IgniteActorSourceSnapshot<TContext>;
  subscribe(listener: (snapshot: IgniteActorSourceSnapshot<TContext>) => void): () => void;
  subscribeEvent(
    listener: (event: IgniteActorSourceEvent<TEvent>) => void,
    options?: ActorEventSubscriptionOptions
  ): () => void;
  transportStatus(): ProjectionTransportStatus;
  subscribeTransportStatus(listener: (status: ProjectionTransportStatus) => void): () => void;
}

export interface IgniteCommandSource<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
  TEvent extends ActorMessage = ActorMessage,
> extends IgniteReadModelSource<TContext, TEvent> {
  send(message: TMessage): Promise<void>;
  ask<TResponse = JsonValue>(message: TMessage, timeout?: number): Promise<TResponse>;
}

export type IgniteActorSource<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
  TEvent extends ActorMessage = ActorMessage,
> = IgniteCommandSource<TContext, TMessage, TEvent>;

export type IgniteActorSourceEvent<TEvent extends ActorMessage = ActorMessage> = TEvent & {
  address: ActorAddress;
  toJSON(): object;
};

export interface SnapshotSubscribableActorRef<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
> extends ActorRef<TContext, TMessage> {
  subscribeSnapshot(listener: (snapshot: ActorSnapshot<TContext>) => void): () => void;
}

export interface EventSubscribableActorRef<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
  TEvent extends ActorMessage = ActorMessage,
> extends ActorRef<TContext, TMessage> {
  subscribeEvent(
    listener: (event: TEvent) => void,
    options?: ActorEventSubscriptionOptions
  ): () => void;
}

export interface TransportStatusSubscribableActorRef<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
> extends ActorRef<TContext, TMessage> {
  getTransportStatus(): ProjectionTransportStatus;
  subscribeTransportStatus(listener: (status: ProjectionTransportStatus) => void): () => void;
}

export interface CreateIgniteActorSourceOptions<
  TContext = unknown,
  TEvent extends ActorMessage = ActorMessage,
> {
  getSnapshot?: () => ActorSnapshot<TContext>;
  subscribeSnapshot?: (listener: (snapshot: ActorSnapshot<TContext>) => void) => () => void;
  subscribeEvent?: (
    listener: (event: TEvent) => void,
    options?: ActorEventSubscriptionOptions
  ) => () => void;
  getTransportStatus?: () => ProjectionTransportStatus;
  subscribeTransportStatus?: (listener: (status: ProjectionTransportStatus) => void) => () => void;
}

export function isSnapshotSubscribableActorRef<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
>(value: ActorRef<TContext, TMessage>): value is SnapshotSubscribableActorRef<TContext, TMessage> {
  return typeof value.subscribeSnapshot === 'function';
}

export function isEventSubscribableActorRef<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
  TEvent extends ActorMessage = ActorMessage,
>(
  value: ActorRef<TContext, TMessage>
): value is EventSubscribableActorRef<TContext, TMessage, TEvent> {
  return typeof value.subscribeEvent === 'function';
}

export function isTransportStatusSubscribableActorRef<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
>(
  value: ActorRef<TContext, TMessage>
): value is TransportStatusSubscribableActorRef<TContext, TMessage> {
  return (
    typeof value.getTransportStatus === 'function' &&
    typeof value.subscribeTransportStatus === 'function'
  );
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

export function actorEventToIgniteSourceEvent<TEvent extends ActorMessage = ActorMessage>(
  address: ActorAddress,
  event: TEvent
): IgniteActorSourceEvent<TEvent> {
  return {
    ...event,
    address,
    toJSON: () => ({
      ...event,
      address,
    }),
  };
}

export function createIgniteReadModelSource<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
  TEvent extends ActorMessage = ActorMessage,
>(
  actorRef: ActorRef<TContext, TMessage>,
  options: CreateIgniteActorSourceOptions<TContext, TEvent> = {}
): IgniteReadModelSource<TContext, TEvent> {
  const getSnapshot = options.getSnapshot ?? actorRef.getSnapshot.bind(actorRef);
  const subscribeSnapshot =
    options.subscribeSnapshot ??
    (isSnapshotSubscribableActorRef(actorRef)
      ? actorRef.subscribeSnapshot.bind(actorRef)
      : undefined);
  const subscribeActorEvent =
    options.subscribeEvent ??
    (isEventSubscribableActorRef<TContext, TMessage, TEvent>(actorRef)
      ? actorRef.subscribeEvent.bind(actorRef)
      : undefined);
  const getTransportStatus =
    options.getTransportStatus ??
    (isTransportStatusSubscribableActorRef(actorRef)
      ? actorRef.getTransportStatus.bind(actorRef)
      : () => createProjectionTransportStatus('local'));
  const subscribeTransportStatus =
    options.subscribeTransportStatus ??
    (isTransportStatusSubscribableActorRef(actorRef)
      ? actorRef.subscribeTransportStatus.bind(actorRef)
      : (listener: (status: ProjectionTransportStatus) => void) => {
          listener(getTransportStatus());
          return () => {};
        });

  if (!subscribeSnapshot) {
    throw new Error(
      'ActorRef does not expose snapshot subscriptions. Pass createIgniteActorSource(..., { getSnapshot, subscribeSnapshot }) or use a ref that exposes subscribeSnapshot().'
    );
  }

  return {
    address: actorRef.address,
    snapshot(): IgniteActorSourceSnapshot<TContext> {
      return actorSnapshotToIgniteSourceSnapshot(actorRef.address, getSnapshot());
    },
    subscribe(listener: (snapshot: IgniteActorSourceSnapshot<TContext>) => void): () => void {
      listener(actorSnapshotToIgniteSourceSnapshot(actorRef.address, getSnapshot()));

      return subscribeSnapshot((snapshot) => {
        listener(actorSnapshotToIgniteSourceSnapshot(actorRef.address, snapshot));
      });
    },
    subscribeEvent(
      listener: (event: IgniteActorSourceEvent<TEvent>) => void,
      eventOptions: ActorEventSubscriptionOptions = {}
    ): () => void {
      if (!subscribeActorEvent) {
        throw new Error(
          'ActorRef does not expose emitted-event subscriptions. Pass createIgniteActorSource(..., { subscribeEvent }) or use a ref that exposes subscribeEvent().'
        );
      }

      return subscribeActorEvent((event) => {
        listener(actorEventToIgniteSourceEvent(actorRef.address, event));
      }, eventOptions);
    },
    transportStatus(): ProjectionTransportStatus {
      return getTransportStatus();
    },
    subscribeTransportStatus(listener: (status: ProjectionTransportStatus) => void): () => void {
      return subscribeTransportStatus(listener);
    },
  };
}

export function createIgniteCommandSource<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
  TEvent extends ActorMessage = ActorMessage,
>(
  actorRef: ActorRef<TContext, TMessage>,
  options: CreateIgniteActorSourceOptions<TContext, TEvent> = {}
): IgniteCommandSource<TContext, TMessage, TEvent> {
  const readModel = createIgniteReadModelSource(actorRef, options);

  return {
    ...readModel,
    send(message: TMessage): Promise<void> {
      return actorRef.send(message);
    },
    ask<TResponse = JsonValue>(message: TMessage, timeout?: number): Promise<TResponse> {
      return actorRef.ask<TResponse>(message as unknown as Message, timeout);
    },
  };
}

export function createIgniteActorSource<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
  TEvent extends ActorMessage = ActorMessage,
>(
  actorRef: ActorRef<TContext, TMessage>,
  options: CreateIgniteActorSourceOptions<TContext, TEvent> = {}
): IgniteActorSource<TContext, TMessage, TEvent> {
  return createIgniteCommandSource(actorRef, options);
}
