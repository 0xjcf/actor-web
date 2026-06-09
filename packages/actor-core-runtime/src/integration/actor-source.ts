/**
 * @module actor-core/runtime/integration/actor-source
 * @description Neutral actor source: read-model and command source factories for
 * projection/UI host adapters.
 *
 * Keeps Actor-Web responsible for actor lifecycle, typed commands, and runtime
 * snapshots while letting host layers derive their own UI projections.
 * It can also accept explicit remote snapshot/event transport for foreign sources
 * or non-Actor-Web runtimes that do not participate in the runtime node registry.
 */

import type { ActorEventSubscriptionOptions, ActorRef } from '../actor-ref.js';
import type { ActorAddress, ActorMessage } from '../actor-system.js';
import {
  createProjectionTransportStatus,
  type ProjectionTransportStatus,
} from '../projection-transport.js';
import { deriveStateLabel } from '../runtime-projection.js';
import type { ActorSnapshot, JsonValue, Message } from '../types.js';

export interface ActorSourceSnapshot<TContext = unknown> extends ActorSnapshot<TContext> {
  address: ActorAddress;
  phase: string;
  toJSON(): object;
}

export interface ActorReadModelSource<
  TContext = unknown,
  TEvent extends ActorMessage = ActorMessage,
> {
  readonly address: ActorAddress;
  snapshot(): ActorSourceSnapshot<TContext>;
  subscribe(listener: (snapshot: ActorSourceSnapshot<TContext>) => void): () => void;
  subscribeEvent(
    listener: (event: ActorSourceEvent<TEvent>) => void,
    options?: ActorEventSubscriptionOptions
  ): () => void;
  transportStatus(): ProjectionTransportStatus;
  subscribeTransportStatus(listener: (status: ProjectionTransportStatus) => void): () => void;
}

export interface ActorCommandSource<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
  TEvent extends ActorMessage = ActorMessage,
> extends ActorReadModelSource<TContext, TEvent> {
  send(message: TMessage): Promise<void>;
  ask<TResponse = JsonValue>(message: TMessage, timeout?: number): Promise<TResponse>;
}

export type ActorSource<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
  TEvent extends ActorMessage = ActorMessage,
> = ActorCommandSource<TContext, TMessage, TEvent>;

export type ActorSourceEvent<TEvent extends ActorMessage = ActorMessage> = TEvent & {
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

export interface CreateActorSourceOptions<
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

export function actorSnapshotToSourceSnapshot<TContext = unknown>(
  address: ActorAddress,
  snapshot: ActorSnapshot<TContext>
): ActorSourceSnapshot<TContext> {
  const phase = deriveStateLabel(snapshot.value);

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

export function actorEventToSourceEvent<TEvent extends ActorMessage = ActorMessage>(
  address: ActorAddress,
  event: TEvent
): ActorSourceEvent<TEvent> {
  return {
    ...event,
    address,
    toJSON: () => ({
      ...event,
      address,
    }),
  };
}

export function createActorReadModelSource<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
  TEvent extends ActorMessage = ActorMessage,
>(
  actorRef: ActorRef<TContext, TMessage>,
  options: CreateActorSourceOptions<TContext, TEvent> = {}
): ActorReadModelSource<TContext, TEvent> {
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
      'ActorRef does not expose snapshot subscriptions. Pass createActorSource(..., { getSnapshot, subscribeSnapshot }) or use a ref that exposes subscribeSnapshot().'
    );
  }

  return {
    address: actorRef.address,
    snapshot(): ActorSourceSnapshot<TContext> {
      return actorSnapshotToSourceSnapshot(actorRef.address, getSnapshot());
    },
    subscribe(listener: (snapshot: ActorSourceSnapshot<TContext>) => void): () => void {
      listener(actorSnapshotToSourceSnapshot(actorRef.address, getSnapshot()));

      return subscribeSnapshot((snapshot) => {
        listener(actorSnapshotToSourceSnapshot(actorRef.address, snapshot));
      });
    },
    subscribeEvent(
      listener: (event: ActorSourceEvent<TEvent>) => void,
      eventOptions: ActorEventSubscriptionOptions = {}
    ): () => void {
      if (!subscribeActorEvent) {
        throw new Error(
          'ActorRef does not expose emitted-event subscriptions. Pass createActorSource(..., { subscribeEvent }) or use a ref that exposes subscribeEvent().'
        );
      }

      return subscribeActorEvent((event) => {
        listener(actorEventToSourceEvent(actorRef.address, event));
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

export function createActorCommandSource<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
  TEvent extends ActorMessage = ActorMessage,
>(
  actorRef: ActorRef<TContext, TMessage>,
  options: CreateActorSourceOptions<TContext, TEvent> = {}
): ActorCommandSource<TContext, TMessage, TEvent> {
  const readModel = createActorReadModelSource(actorRef, options);

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

export function createActorSource<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
  TEvent extends ActorMessage = ActorMessage,
>(
  actorRef: ActorRef<TContext, TMessage>,
  options: CreateActorSourceOptions<TContext, TEvent> = {}
): ActorSource<TContext, TMessage, TEvent> {
  return createActorCommandSource(actorRef, options);
}
