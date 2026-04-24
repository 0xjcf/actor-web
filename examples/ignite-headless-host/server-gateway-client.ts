/// <reference types="vite/client" />

import type {
  ActorEventSubscriptionOptions,
  IgniteActorSourceEvent,
  IgniteActorSourceSnapshot,
  ProjectionTransportStatus,
  RuntimeGatewayClientFrame,
  RuntimeGatewayEventProjection,
  RuntimeGatewayScopeDescriptor,
  RuntimeGatewayServerFrame,
  RuntimeGatewaySnapshotProjection,
} from '@actor-core/runtime/browser';
import {
  actorSnapshotToIgniteSourceSnapshot,
  createProjectionTransportStatus,
} from '@actor-core/runtime/browser';
import {
  type CheckoutCommand,
  type CheckoutContext,
  type CheckoutEvent,
  createActorSnapshot,
  createPlaceholderSnapshot,
  normalizeCheckoutSnapshot,
  REMOTE_ADDRESS,
} from './checkout-contract';
import type { CheckoutRuntimeHarness } from './runtime-harness';

interface GatewaySocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  addEventListener(type: 'error', listener: (event: Event) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<string>) => void): void;
}

interface CreateCheckoutServerGatewaySourceOptions {
  url: string;
  streamId?: string;
  scope?: RuntimeGatewayScopeDescriptor;
  createSocket?: (url: string) => GatewaySocket;
}

type PendingAsk = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

type PendingSend = {
  resolve(): void;
  reject(error: Error): void;
};

function defaultGatewayUrl(): string | undefined {
  const configuredUrl = import.meta.env.VITE_ACTOR_WEB_GATEWAY_URL;
  return typeof configuredUrl === 'string' && configuredUrl.trim().length > 0
    ? configuredUrl
    : undefined;
}

function toGatewaySnapshot(
  projection: RuntimeGatewaySnapshotProjection<CheckoutContext>
): IgniteActorSourceSnapshot<CheckoutContext> {
  return normalizeCheckoutSnapshot(
    actorSnapshotToIgniteSourceSnapshot(
      projection.address,
      createActorSnapshot(projection.value, projection.context)
    )
  );
}

function toGatewayEvent(
  projection: RuntimeGatewayEventProjection
): IgniteActorSourceEvent<CheckoutEvent> {
  const event = {
    type: projection.envelope.type,
    ...projection.envelope.payload,
  } as CheckoutEvent;

  return {
    ...event,
    address: projection.address,
    toJSON: () => ({
      ...event,
      address: projection.address,
    }),
  };
}

export function serverGatewayRuntimeAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof WebSocket !== 'undefined' &&
    defaultGatewayUrl() !== undefined
  );
}

export function createCheckoutServerGatewayRuntimeHarness(
  options: CreateCheckoutServerGatewaySourceOptions
): CheckoutRuntimeHarness {
  const streamId = options.streamId ?? 'checkout-main';
  const scope = options.scope ?? { kind: 'ignite-headless-checkout' };
  const socket = (options.createSocket ?? ((url: string): GatewaySocket => new WebSocket(url)))(
    options.url
  );
  const snapshotListeners = new Set<
    (snapshot: IgniteActorSourceSnapshot<CheckoutContext>) => void
  >();
  const eventListeners = new Set<{
    listener: (event: IgniteActorSourceEvent<CheckoutEvent>) => void;
    types?: readonly string[];
  }>();
  const statusListeners = new Set<(status: ProjectionTransportStatus) => void>();
  const pendingAsks = new Map<string, PendingAsk>();
  let pendingSend: PendingSend | null = null;
  let resolveReady: (() => void) | null = null;
  let rejectReady: ((error: Error) => void) | null = null;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let currentSnapshot = createPlaceholderSnapshot();
  let currentStatus: ProjectionTransportStatus = createProjectionTransportStatus('replaying', {
    reason: 'Connecting to server runtime gateway',
  });
  let requestSequence = 0;

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

  const emitEvent = (event: IgniteActorSourceEvent<CheckoutEvent>): void => {
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
    sendFrame({ type: 'hello', clientVersion: 'ignite-headless-host' });
  });

  socket.addEventListener('message', (event) => {
    const frameText = typeof event.data === 'string' ? event.data : String(event.data);
    const frame = JSON.parse(frameText) as RuntimeGatewayServerFrame;

    switch (frame.type) {
      case 'ready':
        currentStatus = createProjectionTransportStatus('replaying', {
          reason: 'Subscribing to server runtime gateway',
        });
        emitStatus();
        sendFrame({ type: 'subscribe', streamId, scope });
        return;
      case 'snapshot':
        currentSnapshot = toGatewaySnapshot(
          frame.projection as RuntimeGatewaySnapshotProjection<CheckoutContext>
        );
        resolveReady?.();
        resolveReady = null;
        rejectReady = null;
        emitSnapshot();
        return;
      case 'event':
        emitEvent(toGatewayEvent(frame.projection));
        return;
      case 'status':
        currentStatus =
          frame.status.state === 'local'
            ? createProjectionTransportStatus('connected', { updatedAt: frame.status.updatedAt })
            : frame.status;
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
      case 'pong':
        return;
    }
  });

  socket.addEventListener('close', () => {
    const error = new Error('Server runtime gateway disconnected.');
    rejectPending(error);
    currentStatus = createProjectionTransportStatus('disconnected', { reason: error.message });
    emitStatus();
  });

  socket.addEventListener('error', () => {
    const error = new Error('Server runtime gateway connection failed.');
    rejectPending(error);
    currentStatus = createProjectionTransportStatus('degraded', { reason: error.message });
    emitStatus();
  });

  return {
    source: {
      address: REMOTE_ADDRESS,
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
      async send(message: CheckoutCommand): Promise<void> {
        await ready;
        await new Promise<void>((resolve, reject) => {
          pendingSend = { resolve, reject };
          try {
            sendFrame({ type: 'send', streamId, message });
          } catch (error) {
            pendingSend = null;
            reject(error);
          }
        });
      },
      async ask<TResponse = unknown>(
        message: CheckoutCommand,
        timeout?: number
      ): Promise<TResponse> {
        await ready;
        requestSequence += 1;
        const requestId = `gateway-request-${requestSequence}`;
        return new Promise<TResponse>((resolve, reject) => {
          pendingAsks.set(requestId, {
            resolve: (value) => {
              resolve(value as TResponse);
            },
            reject,
          });
          try {
            sendFrame({ type: 'ask', streamId, requestId, message, timeoutMs: timeout });
          } catch (error) {
            pendingAsks.delete(requestId);
            reject(error);
          }
        });
      },
    },
    async destroy(): Promise<void> {
      rejectPending(new Error('Server runtime gateway source destroyed.'));
      socket.close();
      snapshotListeners.clear();
      eventListeners.clear();
      statusListeners.clear();
    },
  };
}

export function createConfiguredCheckoutServerGatewayRuntimeHarness(): CheckoutRuntimeHarness {
  const url = defaultGatewayUrl();
  if (!url) {
    throw new Error('VITE_ACTOR_WEB_GATEWAY_URL is not configured.');
  }

  return createCheckoutServerGatewayRuntimeHarness({ url });
}
