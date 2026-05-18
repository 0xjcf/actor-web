import type { ActorEventSubscriptionOptions } from './actor-ref.js';
import type { ActorAddress, ActorMessage } from './actor-system.js';
import {
  actorSnapshotToIgniteSourceSnapshot,
  type IgniteActorSourceEvent,
  type IgniteActorSourceSnapshot,
  type IgniteCommandSource,
  type IgniteReadModelSource,
} from './integration/ignite-element-bridge.js';
import {
  createProjectionTransportStatus,
  type ProjectionTransportStatus,
} from './projection-transport.js';
import { type RuntimeGatewayAuthProvider, resolveRuntimeAuthPayload } from './runtime-auth.js';
import type {
  RuntimeGatewayClientFrame,
  RuntimeGatewayEventProjection,
  RuntimeGatewayScopeDescriptor,
  RuntimeGatewayServerFrame,
  RuntimeGatewaySnapshotProjection,
  RuntimeGatewaySubscribeMode,
} from './runtime-gateway.js';
import type {
  ActorWebActorAddress,
  ActorWebActorContext,
  ActorWebActorDescriptor,
  ActorWebActorEvent,
  ActorWebActorMessage,
} from './topology.js';
import type { ActorSnapshot, JsonValue, Message } from './types.js';

export interface ActorWebGatewaySocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  addEventListener(type: 'error', listener: (event: Event) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<string>) => void): void;
}

export type ActorWebSourceGatewayScopeOptions = Omit<RuntimeGatewayScopeDescriptor, 'kind'> & {
  readonly kind?: string;
};

export interface ActorWebSourceGatewayOptions {
  readonly url: string;
  readonly scope?: ActorWebSourceGatewayScopeOptions;
  readonly auth?: RuntimeGatewayAuthProvider;
}

export interface ActorWebSourceOptions {
  readonly gateway: ActorWebSourceGatewayOptions;
  readonly streamId?: string;
  readonly createSocket?: (url: string) => ActorWebGatewaySocket;
  readonly clientVersion?: string;
}

interface GatewaySourceBehaviorOptions {
  readonly subscribeMode?: RuntimeGatewaySubscribeMode;
  readonly readyOnStatus?: boolean;
}

interface ResolvedGatewayBackedSourceInput {
  readonly address: ActorAddress;
  readonly scope: RuntimeGatewayScopeDescriptor;
  readonly options: ActorWebSourceOptions;
}

export interface ActorWebAddressSourceInput {
  readonly address: string | ActorWebActorAddress | ActorAddress;
  readonly contractVersion?: string;
  readonly gateway: ActorWebSourceGatewayOptions;
  readonly scope?: ActorWebSourceGatewayScopeOptions;
}

export interface ActorWebActorSourceInput<TActor extends ActorWebActorDescriptor> {
  readonly actor: TActor;
  readonly gateway: ActorWebSourceGatewayOptions;
  readonly streamId?: string;
  readonly createSocket?: (url: string) => ActorWebGatewaySocket;
  readonly clientVersion?: string;
}

export interface ClosableActorWebReadModelSource<
  TContext = unknown,
  TEvent extends ActorMessage = ActorMessage,
> extends IgniteReadModelSource<TContext, TEvent> {
  close(): void;
}

export interface ClosableActorWebCommandSource<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
  TEvent extends ActorMessage = ActorMessage,
> extends ClosableActorWebReadModelSource<TContext, TEvent>,
    IgniteCommandSource<TContext, TMessage, TEvent> {}

export type ClosableActorWebSource<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
  TEvent extends ActorMessage = ActorMessage,
> = ClosableActorWebCommandSource<TContext, TMessage, TEvent>;

type PendingAsk = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

type PendingSend = {
  resolve(): void;
  reject(error: Error): void;
};

function normalizeAddress(address: string | ActorWebActorAddress | ActorAddress): ActorAddress {
  if (typeof address !== 'string') {
    return address;
  }

  const match = /^actor:\/\/([^/]+)\/actor\/(.+)$/.exec(address);
  const id = match?.[2] ?? address.split('/').at(-1) ?? address;
  const node = match?.[1];

  return {
    id,
    type: 'actor',
    ...(node ? { node } : {}),
    path: address,
  };
}

function placeholderSnapshot<TContext>(address: ActorAddress): IgniteActorSourceSnapshot<TContext> {
  const snapshot: ActorSnapshot<TContext> = {
    context: undefined as TContext,
    value: 'unknown',
    status: 'idle',
    matches: (state: string) => state === 'unknown',
    can: () => false,
    hasTag: () => false,
    toJSON: () => ({
      context: undefined,
      value: 'unknown',
      status: 'idle',
    }),
  };

  return actorSnapshotToIgniteSourceSnapshot(address, snapshot);
}

function mergeScope(
  scope: RuntimeGatewayScopeDescriptor,
  override: ActorWebSourceGatewayScopeOptions | undefined
): RuntimeGatewayScopeDescriptor {
  if (!override) {
    return scope;
  }

  const params =
    scope.params || override.params
      ? {
          ...(scope.params ?? {}),
          ...(override.params ?? {}),
        }
      : undefined;

  return {
    ...scope,
    ...override,
    kind: override.kind ?? scope.kind,
    ...(params ? { params } : {}),
  };
}

function snapshotProjectionToIgniteSnapshot<TContext>(
  projection: RuntimeGatewaySnapshotProjection<TContext>
): IgniteActorSourceSnapshot<TContext> {
  return actorSnapshotToIgniteSourceSnapshot(projection.address, {
    context: projection.context,
    value: projection.value,
    status: projection.workflowSnapshot.status as ActorSnapshot<TContext>['status'],
    matches: (state: string) => state === projection.workflowSnapshot.phase,
    can: () => projection.workflowSnapshot.status === 'running',
    hasTag: () => false,
    toJSON: () => ({
      context: projection.context,
      value: projection.value,
      status: projection.workflowSnapshot.status,
    }),
  });
}

function eventProjectionToIgniteEvent<TEvent extends ActorMessage>(
  projection: RuntimeGatewayEventProjection
): IgniteActorSourceEvent<TEvent> {
  const event = {
    type: projection.envelope.type,
    ...(projection.envelope.payload ?? {}),
  } as TEvent;

  return {
    ...event,
    address: projection.address,
    toJSON: () => ({
      ...event,
      address: projection.address,
    }),
  };
}

function defaultSocket(url: string): ActorWebGatewaySocket {
  if (typeof WebSocket === 'undefined') {
    throw new Error(
      'createActorWebSource requires WebSocket. Pass createSocket when running outside a browser.'
    );
  }

  return new WebSocket(url);
}

function resolveGatewayBackedSourceInput(
  input:
    | ActorWebActorDescriptor
    | ActorWebActorSourceInput<ActorWebActorDescriptor>
    | ActorWebAddressSourceInput,
  options?: ActorWebSourceOptions | Omit<ActorWebSourceOptions, 'gateway'>
): ResolvedGatewayBackedSourceInput {
  const isObjectActorInput = 'gateway' in input && 'actor' in input;
  const isAddressInput = 'gateway' in input && 'address' in input && !('nodeAddress' in input);
  const actorDescriptor: ActorWebActorDescriptor | undefined = isObjectActorInput
    ? input.actor
    : isAddressInput
      ? undefined
      : input;
  let address: ActorAddress;
  if (isAddressInput) {
    address = normalizeAddress(input.address);
  } else if (actorDescriptor) {
    address = normalizeAddress(actorDescriptor.address);
  } else {
    throw new Error('createActorWebSource requires an actor descriptor or actor address.');
  }

  const resolvedOptions = {
    ...(isObjectActorInput ? input : (options ?? {})),
    gateway:
      isAddressInput || isObjectActorInput
        ? input.gateway
        : (options as ActorWebSourceOptions).gateway,
  } as ActorWebSourceOptions;
  const descriptorScope = actorDescriptor?.gateway?.scope;
  const legacyInputScope = isAddressInput ? input.scope : undefined;
  const inferredScope = {
    kind: actorDescriptor ? actorDescriptor.key : address.id,
  } satisfies RuntimeGatewayScopeDescriptor;
  const baseScope = mergeScope(inferredScope, descriptorScope);
  const inputScope = mergeScope(baseScope, legacyInputScope);
  const scope = mergeScope(inputScope, resolvedOptions.gateway.scope);

  return {
    address,
    scope,
    options: resolvedOptions,
  };
}

function createGatewayBackedSource<
  TContext,
  TMessage extends ActorMessage,
  TEvent extends ActorMessage,
>(
  address: ActorAddress,
  scope: RuntimeGatewayScopeDescriptor,
  options: ActorWebSourceOptions,
  behavior: GatewaySourceBehaviorOptions = {}
): ClosableActorWebSource<TContext, TMessage, TEvent> {
  const streamId = options.streamId ?? `actor-web-${address.id}`;
  const socket = (options.createSocket ?? defaultSocket)(options.gateway.url);
  const subscribeMode = behavior.subscribeMode ?? 'full';
  const readyOnStatus = behavior.readyOnStatus ?? false;
  const snapshotListeners = new Set<(snapshot: IgniteActorSourceSnapshot<TContext>) => void>();
  const eventListeners = new Set<{
    listener: (event: IgniteActorSourceEvent<TEvent>) => void;
    types?: readonly string[];
  }>();
  const statusListeners = new Set<(status: ProjectionTransportStatus) => void>();
  const pendingAsks = new Map<string, PendingAsk>();
  let pendingSend: PendingSend | null = null;
  let resolveReady: (() => void) | null = null;
  let rejectReady: ((error: Error) => void) | null = null;
  let currentSnapshot = placeholderSnapshot<TContext>(address);
  let currentStatus = createProjectionTransportStatus('replaying', {
    reason: 'Connecting to Actor-Web gateway',
  });
  let requestSequence = 0;
  let lastSequence = 0;
  let resyncInProgress = false;

  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  ready.catch(() => {});

  const emitSnapshot = (): void => {
    for (const listener of Array.from(snapshotListeners)) {
      listener(currentSnapshot);
    }
  };

  const emitStatus = (): void => {
    for (const listener of Array.from(statusListeners)) {
      listener(currentStatus);
    }
  };

  const emitEvent = (event: IgniteActorSourceEvent<TEvent>): void => {
    for (const subscriber of Array.from(eventListeners)) {
      if (
        subscriber.types &&
        subscriber.types.length > 0 &&
        !subscriber.types.includes(event.type)
      ) {
        continue;
      }

      subscriber.listener(event);
    }
  };

  const sendFrame = (frame: RuntimeGatewayClientFrame): void => {
    socket.send(JSON.stringify(frame));
  };

  const acceptSequence = (
    frame: Extract<RuntimeGatewayServerFrame, { sequence: number }>
  ): boolean => {
    const expectedSequence = lastSequence + 1;
    if (frame.sequence === expectedSequence) {
      lastSequence = frame.sequence;
      return true;
    }

    if (frame.sequence <= lastSequence) {
      return false;
    }

    if (resyncInProgress && frame.type === 'snapshot') {
      lastSequence = frame.sequence;
      resyncInProgress = false;
      return true;
    }

    resyncInProgress = true;
    currentStatus = createProjectionTransportStatus('degraded', {
      reason: `Gateway stream sequence gap: expected ${expectedSequence}, received ${frame.sequence}.`,
    });
    emitStatus();
    sendFrame({ type: 'resync', streamId, fromSequence: expectedSequence });
    return false;
  };

  const rejectPending = (error: Error): void => {
    rejectReady?.(error);
    rejectReady = null;
    resolveReady = null;
    pendingSend?.reject(error);
    pendingSend = null;
    for (const pending of Array.from(pendingAsks.values())) {
      pending.reject(error);
    }
    pendingAsks.clear();
  };

  socket.addEventListener('open', () => {
    if (!options.gateway.auth) {
      sendFrame({
        type: 'hello',
        clientVersion: options.clientVersion ?? 'actor-web-source',
      });
      return;
    }

    void resolveRuntimeAuthPayload(options.gateway.auth).then((auth) => {
      sendFrame({
        type: 'hello',
        clientVersion: options.clientVersion ?? 'actor-web-source',
        ...(auth ? { auth } : {}),
      });
    }, rejectPending);
  });

  socket.addEventListener('message', (event) => {
    const frameText = typeof event.data === 'string' ? event.data : String(event.data);
    const frame = JSON.parse(frameText) as RuntimeGatewayServerFrame;

    switch (frame.type) {
      case 'ready':
        currentStatus = createProjectionTransportStatus('replaying', {
          reason: 'Subscribing to Actor-Web gateway',
        });
        emitStatus();
        sendFrame({
          type: 'subscribe',
          streamId,
          scope,
          ...(subscribeMode === 'command-only' ? { mode: subscribeMode } : {}),
        });
        return;
      case 'snapshot':
        if (!acceptSequence(frame)) {
          return;
        }
        currentSnapshot = snapshotProjectionToIgniteSnapshot(
          frame.projection as RuntimeGatewaySnapshotProjection<TContext>
        );
        resolveReady?.();
        resolveReady = null;
        rejectReady = null;
        emitSnapshot();
        return;
      case 'event':
        if (!acceptSequence(frame)) {
          return;
        }
        emitEvent(eventProjectionToIgniteEvent<TEvent>(frame.projection));
        return;
      case 'status':
        if (frame.status.state !== 'replaying') {
          resyncInProgress = false;
        }
        currentStatus =
          frame.status.state === 'local'
            ? createProjectionTransportStatus('connected', { updatedAt: frame.status.updatedAt })
            : frame.status;
        if (readyOnStatus) {
          resolveReady?.();
          resolveReady = null;
          rejectReady = null;
        }
        emitStatus();
        return;
      case 'ack':
        pendingSend?.resolve();
        pendingSend = null;
        return;
      case 'reply': {
        const pending = pendingAsks.get(frame.requestId);
        pendingAsks.delete(frame.requestId);
        pending?.resolve(frame.value);
        return;
      }
      case 'error': {
        const error = new Error(frame.message);
        if (frame.requestId) {
          const pending = pendingAsks.get(frame.requestId);
          pendingAsks.delete(frame.requestId);
          pending?.reject(error);
          return;
        }
        rejectPending(error);
        currentStatus = createProjectionTransportStatus('degraded', { reason: frame.message });
        emitStatus();
        return;
      }
      case 'transition':
        if (!acceptSequence(frame)) {
          return;
        }
        return;
      case 'pong':
        return;
    }
  });

  socket.addEventListener('close', () => {
    const error = new Error('Actor-Web gateway disconnected.');
    rejectPending(error);
    currentStatus = createProjectionTransportStatus('disconnected', { reason: error.message });
    emitStatus();
  });

  socket.addEventListener('error', () => {
    const error = new Error('Actor-Web gateway connection failed.');
    rejectPending(error);
    currentStatus = createProjectionTransportStatus('degraded', { reason: error.message });
    emitStatus();
  });

  return {
    address,
    snapshot() {
      return currentSnapshot;
    },
    subscribe(listener) {
      snapshotListeners.add(listener);
      listener(currentSnapshot);
      return () => {
        snapshotListeners.delete(listener);
      };
    },
    subscribeEvent(listener, eventOptions: ActorEventSubscriptionOptions = {}) {
      const subscriber = { listener, types: eventOptions.types };
      eventListeners.add(subscriber);
      return () => {
        eventListeners.delete(subscriber);
      };
    },
    transportStatus() {
      return currentStatus;
    },
    subscribeTransportStatus(listener) {
      statusListeners.add(listener);
      listener(currentStatus);
      return () => {
        statusListeners.delete(listener);
      };
    },
    async send(message: TMessage): Promise<void> {
      await ready;
      await new Promise<void>((resolve, reject) => {
        pendingSend = { resolve, reject };
        try {
          sendFrame({ type: 'send', streamId, message: message as unknown as Message });
        } catch (error) {
          pendingSend = null;
          reject(error);
        }
      });
    },
    async ask<TResponse = JsonValue>(message: TMessage, timeout?: number): Promise<TResponse> {
      await ready;
      requestSequence += 1;
      const requestId = `actor-web-source-request-${requestSequence}`;
      return new Promise<TResponse>((resolve, reject) => {
        pendingAsks.set(requestId, {
          resolve: (value) => {
            resolve(value as TResponse);
          },
          reject,
        });
        try {
          sendFrame({
            type: 'ask',
            streamId,
            requestId,
            message: message as unknown as Message,
            timeoutMs: timeout,
          });
        } catch (error) {
          pendingAsks.delete(requestId);
          reject(error);
        }
      });
    },
    close(): void {
      rejectPending(new Error('Actor-Web source closed.'));
      socket.close();
      snapshotListeners.clear();
      eventListeners.clear();
      statusListeners.clear();
    },
  };
}

export function createActorWebReadModelSource<TActor extends ActorWebActorDescriptor>(
  input: ActorWebActorSourceInput<TActor>
): ClosableActorWebReadModelSource<ActorWebActorContext<TActor>, ActorWebActorEvent<TActor>>;
export function createActorWebReadModelSource<TActor extends ActorWebActorDescriptor>(
  actorDescriptor: TActor,
  options: ActorWebSourceOptions
): ClosableActorWebReadModelSource<ActorWebActorContext<TActor>, ActorWebActorEvent<TActor>>;
export function createActorWebReadModelSource(
  input: ActorWebAddressSourceInput,
  options?: Omit<ActorWebSourceOptions, 'gateway'>
): ClosableActorWebReadModelSource<unknown, ActorMessage>;
export function createActorWebReadModelSource(
  input:
    | ActorWebActorDescriptor
    | ActorWebActorSourceInput<ActorWebActorDescriptor>
    | ActorWebAddressSourceInput,
  options?: ActorWebSourceOptions | Omit<ActorWebSourceOptions, 'gateway'>
): ClosableActorWebReadModelSource<unknown, ActorMessage> {
  const resolved = resolveGatewayBackedSourceInput(input, options);
  const source = createGatewayBackedSource(resolved.address, resolved.scope, resolved.options);

  return {
    address: source.address,
    snapshot: source.snapshot,
    subscribe: source.subscribe,
    subscribeEvent: source.subscribeEvent,
    transportStatus: source.transportStatus,
    subscribeTransportStatus: source.subscribeTransportStatus,
    close: source.close,
  };
}

export function createActorWebCommandSource<TActor extends ActorWebActorDescriptor>(
  input: ActorWebActorSourceInput<TActor>
): ClosableActorWebSource<
  ActorWebActorContext<TActor>,
  ActorWebActorMessage<TActor>,
  ActorWebActorEvent<TActor>
>;
export function createActorWebCommandSource<TActor extends ActorWebActorDescriptor>(
  actorDescriptor: TActor,
  options: ActorWebSourceOptions
): ClosableActorWebSource<
  ActorWebActorContext<TActor>,
  ActorWebActorMessage<TActor>,
  ActorWebActorEvent<TActor>
>;
export function createActorWebCommandSource(
  input: ActorWebAddressSourceInput,
  options?: Omit<ActorWebSourceOptions, 'gateway'>
): ClosableActorWebSource<unknown, ActorMessage, ActorMessage>;
export function createActorWebCommandSource(
  input:
    | ActorWebActorDescriptor
    | ActorWebActorSourceInput<ActorWebActorDescriptor>
    | ActorWebAddressSourceInput,
  options?: ActorWebSourceOptions | Omit<ActorWebSourceOptions, 'gateway'>
): ClosableActorWebSource<unknown, ActorMessage, ActorMessage> {
  const resolved = resolveGatewayBackedSourceInput(input, options);

  return createGatewayBackedSource(resolved.address, resolved.scope, resolved.options, {
    subscribeMode: 'command-only',
    readyOnStatus: true,
  });
}

export function createActorWebSource<TActor extends ActorWebActorDescriptor>(
  input: ActorWebActorSourceInput<TActor>
): ClosableActorWebSource<
  ActorWebActorContext<TActor>,
  ActorWebActorMessage<TActor>,
  ActorWebActorEvent<TActor>
>;
export function createActorWebSource<TActor extends ActorWebActorDescriptor>(
  actorDescriptor: TActor,
  options: ActorWebSourceOptions
): ClosableActorWebSource<
  ActorWebActorContext<TActor>,
  ActorWebActorMessage<TActor>,
  ActorWebActorEvent<TActor>
>;
export function createActorWebSource(
  input: ActorWebAddressSourceInput,
  options?: Omit<ActorWebSourceOptions, 'gateway'>
): ClosableActorWebSource<unknown, ActorMessage, ActorMessage>;
export function createActorWebSource(
  input:
    | ActorWebActorDescriptor
    | ActorWebActorSourceInput<ActorWebActorDescriptor>
    | ActorWebAddressSourceInput,
  options?: ActorWebSourceOptions | Omit<ActorWebSourceOptions, 'gateway'>
): ClosableActorWebSource<unknown, ActorMessage, ActorMessage> {
  const resolved = resolveGatewayBackedSourceInput(input, options);

  return createGatewayBackedSource(resolved.address, resolved.scope, resolved.options);
}
