import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { emit, setup } from 'xstate';
import { createActorRef } from '../create-actor-ref.js';
import {
  createProjectionTransportStatus,
  type ProjectionTransportStatus,
} from '../projection-transport.js';
import {
  createRuntimeGatewayCommandSource,
  createRuntimeGatewayHub,
  createRuntimeGatewayReadModelSource,
  createRuntimeGatewaySource,
  type RuntimeGatewayClientFrame,
  type RuntimeGatewayConnectionAdapter,
  type RuntimeGatewayEventProjection,
  type RuntimeGatewayInvalidFrameEvent,
  type RuntimeGatewayObserverEvent,
  type RuntimeGatewayReplayFrame,
  type RuntimeGatewayReplayStorageErrorEvent,
  type RuntimeGatewayReplayStorageProvider,
  type RuntimeGatewayScopeDescriptor,
  RuntimeGatewayScopeError,
  type RuntimeGatewaySnapshotProjection,
  type RuntimeGatewaySource,
} from '../runtime-gateway.js';
import type { Message } from '../types.js';

type CheckoutCommand = { type: 'SUBMIT'; orderId: string } | { type: 'RESET' };
type CheckoutEvent = { type: 'CHECKOUT_SUBMITTED'; orderId: string } | { type: 'CHECKOUT_RESET' };

interface CheckoutContext {
  submittedOrders: string[];
  lastSubmittedOrderId: string | null;
}

const fixedNow = () => new Date('2026-04-23T15:00:00.000Z');

async function flushGatewayFrames(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
  await Promise.resolve();
}

async function flushGatewayMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const checkoutMachine = setup({
  types: {
    context: {} as CheckoutContext,
    events: {} as CheckoutCommand,
    emitted: {} as CheckoutEvent,
  },
  actions: {
    emitSubmitted: emit(({ event }) => ({
      type: 'CHECKOUT_SUBMITTED' as const,
      orderId: event.type === 'SUBMIT' ? event.orderId : '',
    })),
    emitReset: emit(() => ({
      type: 'CHECKOUT_RESET' as const,
    })),
  },
}).createMachine({
  id: 'gateway-checkout',
  initial: 'ready',
  context: {
    submittedOrders: [],
    lastSubmittedOrderId: null,
  },
  states: {
    ready: {
      on: {
        SUBMIT: {
          target: 'submitted',
          actions: ['emitSubmitted'],
        },
      },
    },
    submitted: {
      on: {
        SUBMIT: {
          target: 'submitted',
          actions: ['emitSubmitted'],
        },
        RESET: {
          target: 'ready',
          actions: ['emitReset'],
        },
      },
    },
  },
});

interface FakeConnection<TAuthContext = unknown>
  extends RuntimeGatewayConnectionAdapter<TAuthContext> {
  frames: unknown[];
  closed: boolean;
  sendAttempts: number;
  push(frame: RuntimeGatewayClientFrame): void;
  pushInvalidFrame(event: RuntimeGatewayInvalidFrameEvent): void;
  close(): void;
}

interface FakeConnectionOptions {
  sendBehavior?: (frame: unknown, attempt: number) => void | Promise<void>;
  closeBehavior?: () => void | Promise<void>;
}

function createFakeConnection<TAuthContext = unknown>(
  authContext: TAuthContext,
  options: FakeConnectionOptions = {}
): FakeConnection<TAuthContext> {
  const receiveListeners = new Set<(frame: RuntimeGatewayClientFrame) => void>();
  const invalidFrameListeners = new Set<(event: RuntimeGatewayInvalidFrameEvent) => void>();
  const closeListeners = new Set<() => void>();
  const frames: unknown[] = [];
  let sendAttempts = 0;

  return {
    authContext,
    frames,
    closed: false,
    sendAttempts: 0,
    receive(listener, onInvalidFrame) {
      receiveListeners.add(listener);
      if (onInvalidFrame) {
        invalidFrameListeners.add(onInvalidFrame);
      }
      return () => {
        receiveListeners.delete(listener);
        if (onInvalidFrame) {
          invalidFrameListeners.delete(onInvalidFrame);
        }
      };
    },
    onClose(listener) {
      closeListeners.add(listener);
      return () => {
        closeListeners.delete(listener);
      };
    },
    send(frame) {
      sendAttempts += 1;
      this.sendAttempts = sendAttempts;
      if (options.sendBehavior) {
        return options.sendBehavior(frame, sendAttempts);
      }
      frames.push(frame);
    },
    push(frame) {
      for (const listener of Array.from(receiveListeners)) {
        listener(frame);
      }
    },
    pushInvalidFrame(event) {
      for (const listener of Array.from(invalidFrameListeners)) {
        listener(event);
      }
    },
    close() {
      this.closed = true;
      void Promise.resolve(options.closeBehavior?.()).catch(() => {});
      for (const listener of Array.from(closeListeners)) {
        listener();
      }
    },
  };
}

function createGatewaySnapshot(
  phase: string,
  context: Record<string, unknown>,
  actorKey = phase
): RuntimeGatewaySnapshotProjection {
  return {
    address: {
      id: `actor-${actorKey}`,
      type: 'actor',
      path: `/actors/${actorKey}`,
    },
    workflowSnapshot: {
      workflowId: `workflow-${phase}`,
      actorId: `actor-${phase}`,
      taskId: `task-${phase}`,
      taskTitle: `Task ${phase}`,
      phase,
      status: 'running',
      createdAt: '2026-04-23T15:00:00.000Z',
      updatedAt: '2026-04-23T15:00:00.000Z',
      branchName: null,
      baseBranch: null,
      correlationId: `corr-${phase}`,
      lastEventType: null,
      notes: [],
      artifacts: {},
    },
    value: phase,
    context,
  };
}

function createGatewayAddress(actorKey: string) {
  return {
    id: `actor-${actorKey}`,
    type: 'actor' as const,
    path: `/actors/${actorKey}`,
  };
}

function createGatewayEvent(
  source: RuntimeGatewaySource,
  type: string,
  occurredAt = '2026-04-23T15:00:01.000Z'
): RuntimeGatewayEventProjection {
  return {
    address: source.address,
    envelope: {
      id: `${type}-id`,
      kind: 'fact',
      type,
      schemaVersion: 1,
      occurredAt,
      sourceActor: source.address.path,
      payload: {},
    },
  };
}

function replayStorageKey(replaySessionId: string, streamId: string): string {
  return `${replaySessionId}::${streamId}`;
}

function toCanonicalAuthOwnerValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    const normalizedEntries = value.flatMap((entry) => {
      const normalizedValue = toCanonicalAuthOwnerValue(entry);
      return normalizedValue === null ? [] : [normalizedValue];
    });
    return normalizedEntries.length > 0 ? normalizedEntries : null;
  }

  if (typeof value === 'object') {
    const normalizedEntries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([key, entryValue]) => {
        const normalizedValue = toCanonicalAuthOwnerValue(entryValue);
        return normalizedValue === null ? [] : ([[key, normalizedValue]] as const);
      });

    return normalizedEntries.length > 0 ? Object.fromEntries(normalizedEntries) : null;
  }

  return null;
}

function replayOwnerKey(authContext: unknown): string | null {
  const canonicalValue = toCanonicalAuthOwnerValue(authContext);
  if (canonicalValue === null) {
    return null;
  }

  return `auth:${createHash('sha256').update(JSON.stringify(canonicalValue)).digest('base64url')}`;
}

function replaySessionIdForAuth(authContext: unknown, connectionIdOrResumeToken: string): string {
  const ownerKey = replayOwnerKey(authContext);
  return ownerKey ? `${ownerKey}::${connectionIdOrResumeToken}` : connectionIdOrResumeToken;
}

function toCanonicalScopeValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toCanonicalScopeValue(entry));
  }

  if (typeof value === 'object') {
    const normalizedEntries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, toCanonicalScopeValue(entryValue)] as const);

    return Object.fromEntries(normalizedEntries);
  }

  return String(value);
}

function replayStorageStreamId(streamId: string, scope: RuntimeGatewayScopeDescriptor): string {
  return `${streamId}::${JSON.stringify(
    toCanonicalScopeValue({
      kind: scope.kind,
      params: scope.params ?? {},
    })
  )}`;
}

function scopedReplayStorageKey(
  replaySessionId: string,
  streamId: string,
  scope: RuntimeGatewayScopeDescriptor
): string {
  return replayStorageKey(replaySessionId, replayStorageStreamId(streamId, scope));
}

function createMapBackedReplayStorageFixture(): {
  provider: RuntimeGatewayReplayStorageProvider;
  storage: Map<string, RuntimeGatewayReplayFrame[]>;
  calls: Array<{ type: 'load' | 'store'; key: string; sequences: number[] }>;
  failLoadFor(key: string): void;
  failStoreFor(key: string): void;
} {
  const storage = new Map<string, RuntimeGatewayReplayFrame[]>();
  const calls: Array<{ type: 'load' | 'store'; key: string; sequences: number[] }> = [];
  const failingLoads = new Set<string>();
  const failingStores = new Set<string>();

  return {
    provider: {
      loadFrames(replaySessionId, streamId) {
        const key = replayStorageKey(replaySessionId, streamId);
        if (failingLoads.has(key)) {
          throw new Error(`load failed for ${key}`);
        }

        const frames = storage.get(key) ?? [];
        calls.push({
          type: 'load',
          key,
          sequences: frames.map((frame) => frame.sequence),
        });
        return frames.map((frame) => ({ ...frame }));
      },
      storeFrames(replaySessionId, streamId, frames) {
        const key = replayStorageKey(replaySessionId, streamId);
        calls.push({
          type: 'store',
          key,
          sequences: frames.map((frame) => frame.sequence),
        });
        if (failingStores.has(key)) {
          throw new Error(`store failed for ${key}`);
        }

        storage.set(
          key,
          frames.map((frame) => ({ ...frame }))
        );
      },
    },
    storage,
    calls,
    failLoadFor(key) {
      failingLoads.add(key);
    },
    failStoreFor(key) {
      failingStores.add(key);
    },
  };
}

function createAsyncMapBackedReplayStorageFixture(): {
  provider: RuntimeGatewayReplayStorageProvider;
  storage: Map<string, RuntimeGatewayReplayFrame[]>;
  startedStores: Array<{ key: string; sequences: number[] }>;
  resolveNextStore(key: string): void;
} {
  const storage = new Map<string, RuntimeGatewayReplayFrame[]>();
  const startedStores: Array<{ key: string; sequences: number[] }> = [];
  const pendingStores = new Map<string, Array<() => void>>();

  return {
    provider: {
      loadFrames(replaySessionId, streamId) {
        const key = replayStorageKey(replaySessionId, streamId);
        return (storage.get(key) ?? []).map((frame) => ({ ...frame }));
      },
      storeFrames(replaySessionId, streamId, frames) {
        const key = replayStorageKey(replaySessionId, streamId);
        startedStores.push({
          key,
          sequences: frames.map((frame) => frame.sequence),
        });

        return new Promise<void>((resolve) => {
          const queue = pendingStores.get(key) ?? [];
          queue.push(() => {
            storage.set(
              key,
              frames.map((frame) => ({ ...frame }))
            );
            resolve();
          });
          pendingStores.set(key, queue);
        });
      },
    },
    storage,
    startedStores,
    resolveNextStore(key) {
      const queue = pendingStores.get(key) ?? [];
      const next = queue.shift();
      if (!next) {
        throw new Error(`No pending store for ${key}`);
      }

      if (queue.length === 0) {
        pendingStores.delete(key);
      } else {
        pendingStores.set(key, queue);
      }
      next();
    },
  };
}

function createFakeSource(
  initialPhase = 'ready',
  actorKey = initialPhase
): RuntimeGatewaySource & {
  emitSnapshot(snapshot: RuntimeGatewaySnapshotProjection): void;
  emitEvent(projection: RuntimeGatewayEventProjection): void;
  emitTransition(transition: {
    fromPhase: string;
    toPhase: string;
    fromStatus: string;
    toStatus: string;
  }): void;
  setStatus(status: ProjectionTransportStatus): void;
  sentMessages: unknown[];
  askMessages: unknown[];
  listenerCounts(): { snapshots: number; events: number; statuses: number; transitions: number };
} {
  const address = createGatewayAddress(actorKey);
  let currentSnapshot = createGatewaySnapshot(initialPhase, { phase: initialPhase }, actorKey);
  let currentStatus = createProjectionTransportStatus('connected');
  const sentMessages: unknown[] = [];
  const askMessages: unknown[] = [];
  const snapshotListeners = new Set<(projection: RuntimeGatewaySnapshotProjection) => void>();
  const eventListeners = new Set<(projection: RuntimeGatewayEventProjection) => void>();
  const statusListeners = new Set<(status: ProjectionTransportStatus) => void>();
  const transitionListeners = new Set<
    (transition: {
      fromPhase: string;
      toPhase: string;
      fromStatus: string;
      toStatus: string;
    }) => void
  >();

  return {
    address,
    snapshot() {
      return currentSnapshot;
    },
    subscribeSnapshot(listener) {
      snapshotListeners.add(listener);
      listener(currentSnapshot);
      return () => {
        snapshotListeners.delete(listener);
      };
    },
    subscribeEvent(listener) {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
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
    subscribeTransition(listener) {
      transitionListeners.add(listener);
      return () => {
        transitionListeners.delete(listener);
      };
    },
    emitSnapshot(snapshot) {
      currentSnapshot = {
        ...snapshot,
        address,
      };
      for (const listener of Array.from(snapshotListeners)) {
        listener(currentSnapshot);
      }
    },
    emitEvent(projection) {
      for (const listener of Array.from(eventListeners)) {
        listener(projection);
      }
    },
    emitTransition(transition) {
      for (const listener of Array.from(transitionListeners)) {
        listener(transition);
      }
    },
    setStatus(status) {
      currentStatus = status;
      for (const listener of Array.from(statusListeners)) {
        listener(status);
      }
    },
    sentMessages,
    askMessages,
    async send(message) {
      sentMessages.push(message);
    },
    async ask<TResponse = unknown>(message: Message): Promise<TResponse> {
      askMessages.push(message);
      return { ok: true, messageType: message.type } as TResponse;
    },
    listenerCounts() {
      return {
        snapshots: snapshotListeners.size,
        events: eventListeners.size,
        statuses: statusListeners.size,
        transitions: transitionListeners.size,
      };
    },
  };
}

describe('runtime gateway source', () => {
  it('maps actor refs to snapshot, event, transport, and transition projections', async () => {
    const actor = createActorRef<CheckoutContext, CheckoutCommand>(checkoutMachine, {
      id: 'gateway-checkout',
    }) as ReturnType<typeof createActorRef<CheckoutContext, CheckoutCommand>> & { start(): void };
    actor.start();

    const source = createRuntimeGatewaySource(actor, {
      workflowId: 'workflow-checkout',
      taskId: 'task-checkout',
      taskTitle: 'Checkout gateway stream',
      now: fixedNow,
    });

    const snapshots: RuntimeGatewaySnapshotProjection[] = [];
    const events: RuntimeGatewayEventProjection[] = [];
    const transitions: Array<{ fromPhase: string; toPhase: string }> = [];
    const statuses: string[] = [];

    const unsubscribeSnapshot = source.subscribeSnapshot((projection) => {
      snapshots.push(projection);
    });
    const unsubscribeEvent = source.subscribeEvent((projection) => {
      events.push(projection);
    });
    const unsubscribeTransition = source.subscribeTransition?.((transition) => {
      transitions.push({
        fromPhase: transition.fromPhase,
        toPhase: transition.toPhase,
      });
    });
    const unsubscribeStatus = source.subscribeTransportStatus((status) => {
      statuses.push(status.state);
    });

    await actor.send({ type: 'SUBMIT', orderId: 'order-3003' });

    unsubscribeSnapshot();
    unsubscribeEvent();
    unsubscribeTransition?.();
    unsubscribeStatus();
    await actor.stop();

    expect(source.snapshot().workflowSnapshot).toMatchObject({
      workflowId: 'workflow-checkout',
      taskId: 'task-checkout',
      taskTitle: 'Checkout gateway stream',
      phase: 'submitted',
      status: 'stopped',
    });
    expect(source.transportStatus().state).toBe('local');
    expect(statuses).toEqual(['local']);
    expect(snapshots.map((projection) => projection.workflowSnapshot.phase)).toEqual([
      'ready',
      'submitted',
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.envelope).toMatchObject({
      kind: 'fact',
      type: 'CHECKOUT_SUBMITTED',
      sourceActor: '/actors/gateway-checkout',
      workflowId: 'workflow-checkout',
      taskId: 'task-checkout',
    });
    expect(transitions).toEqual([{ fromPhase: 'ready', toPhase: 'submitted' }]);
  });

  it('separates read-model gateway sources from explicit command sources', async () => {
    const actor = createActorRef<CheckoutContext, CheckoutCommand>(checkoutMachine, {
      id: 'gateway-read-model',
    }) as ReturnType<typeof createActorRef<CheckoutContext, CheckoutCommand>> & { start(): void };
    actor.start();

    const readModel = createRuntimeGatewayReadModelSource(actor, { now: fixedNow });
    const commandSource = createRuntimeGatewayCommandSource(actor, { now: fixedNow });

    expect('send' in readModel).toBe(false);
    expect('ask' in readModel).toBe(false);

    await commandSource.send?.({ type: 'SUBMIT', orderId: 'order-explicit-command' });
    await actor.stop();

    expect(readModel.snapshot().workflowSnapshot.phase).toBe('submitted');
  });
});

describe('runtime gateway hub', () => {
  it('accepts authenticated gateway hello frames and passes auth context to scope resolution', async () => {
    const source = createFakeSource('ready');
    const seenAuthContexts: unknown[] = [];
    const hub = createRuntimeGatewayHub({
      auth: {
        verifyToken: ({ token }) =>
          token === 'gateway-secret'
            ? { ok: true, authContext: { authorityId: 'auth-from-token' } }
            : { ok: false, reason: 'Gateway authentication rejected.' },
      },
      resolveScope: async (_scope, authContext) => {
        seenAuthContexts.push(authContext);
        return source;
      },
    });
    const connection = createFakeConnection({ authorityId: 'connection-default' });

    const detach = hub.attach(connection);
    connection.push({
      type: 'hello',
      auth: { scheme: 'token', token: 'gateway-secret' },
    });
    connection.push({
      type: 'subscribe',
      streamId: 'fleet-main',
      scope: { kind: 'fleet-view' },
    });
    await flushGatewayFrames();

    expect(connection.closed).toBe(false);
    expect(connection.frames[0]).toMatchObject({ type: 'ready' });
    expect(seenAuthContexts).toEqual([{ authorityId: 'auth-from-token' }]);

    detach();
  });

  it('rejects unauthenticated gateway clients before stream attachment', async () => {
    const source = createFakeSource('ready');
    const hub = createRuntimeGatewayHub({
      auth: {
        verifyToken: ({ token }) => token === 'gateway-secret',
      },
      resolveScope: async () => source,
    });
    const connection = createFakeConnection({ authorityId: 'auth-1' });

    const detach = hub.attach(connection);
    connection.push({
      type: 'hello',
      auth: { scheme: 'token', token: 'wrong-gateway-secret' },
    });
    connection.push({
      type: 'subscribe',
      streamId: 'fleet-main',
      scope: { kind: 'fleet-view' },
    });
    await flushGatewayFrames();

    expect(connection.closed).toBe(true);
    expect(source.listenerCounts()).toEqual({
      snapshots: 0,
      events: 0,
      statuses: 0,
      transitions: 0,
    });
    expect(connection.frames).toContainEqual({
      type: 'error',
      code: 'unauthorized',
      message: 'Authentication rejected.',
      recoverable: false,
    });
    expect(JSON.stringify(connection.frames)).not.toContain('wrong-gateway-secret');

    detach();
  });

  it('rejects frames before hello', async () => {
    const hub = createRuntimeGatewayHub({
      resolveScope: async () => createFakeSource(),
    });
    const connection = createFakeConnection({ authorityId: 'auth-1' });

    const detach = hub.attach(connection);
    connection.push({
      type: 'subscribe',
      streamId: 'fleet-main',
      scope: { kind: 'fleet-view', params: { authorityId: 'auth-1' } },
    });

    await flushGatewayFrames();

    expect(connection.frames).toContainEqual({
      type: 'error',
      code: 'invalid_frame',
      message: 'Send hello before subscribing to runtime streams.',
      recoverable: true,
    });

    detach();
  });

  it('evicts idle connections server-side and refreshes liveness on ping activity', async () => {
    vi.useFakeTimers();
    try {
      const source = createFakeSource('ready');
      const hub = createRuntimeGatewayHub({
        heartbeatMs: 50,
        resolveScope: async () => source,
      });
      const connection = createFakeConnection({ authorityId: 'auth-1' });

      const detach = hub.attach(connection);
      connection.push({ type: 'hello' });
      connection.push({
        type: 'subscribe',
        streamId: 'fleet-main',
        scope: { kind: 'fleet-view' },
      });
      await flushGatewayMicrotasks();

      await vi.advanceTimersByTimeAsync(40);
      connection.push({ type: 'ping', sentAt: '2026-04-23T15:00:01.000Z' });
      await flushGatewayMicrotasks();

      await vi.advanceTimersByTimeAsync(40);
      expect(connection.closed).toBe(false);
      expect(source.listenerCounts()).toEqual({
        snapshots: 1,
        events: 1,
        statuses: 1,
        transitions: 1,
      });

      await vi.advanceTimersByTimeAsync(11);
      expect(connection.closed).toBe(true);
      expect(source.listenerCounts()).toEqual({
        snapshots: 0,
        events: 0,
        statuses: 0,
        transitions: 0,
      });

      detach();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the armed idle timer when the adapter reports an external close', async () => {
    vi.useFakeTimers();
    try {
      const source = createFakeSource('ready');
      const closeBehavior = vi.fn();
      const hub = createRuntimeGatewayHub({
        heartbeatMs: 50,
        resolveScope: async () => source,
      });
      const connection = createFakeConnection(
        { authorityId: 'auth-1' },
        {
          closeBehavior,
        }
      );

      const detach = hub.attach(connection);
      connection.push({ type: 'hello' });
      connection.push({
        type: 'subscribe',
        streamId: 'fleet-main',
        scope: { kind: 'fleet-view' },
      });
      await flushGatewayMicrotasks();

      expect(vi.getTimerCount()).toBe(1);
      connection.close();

      expect(closeBehavior).toHaveBeenCalledTimes(1);
      expect(source.listenerCounts()).toEqual({
        snapshots: 0,
        events: 0,
        statuses: 0,
        transitions: 0,
      });
      expect(vi.getTimerCount()).toBe(0);

      await vi.advanceTimersByTimeAsync(51);

      expect(closeBehavior).toHaveBeenCalledTimes(1);
      expect(connection.closed).toBe(true);

      detach();
    } finally {
      vi.useRealTimers();
    }
  });

  it('converts adapter-level malformed frames into invalid_frame errors and observer events', async () => {
    const observer = vi.fn<(event: RuntimeGatewayObserverEvent) => void>();
    const hub = createRuntimeGatewayHub({
      observer,
      resolveScope: async () => createFakeSource(),
    });
    const connection = createFakeConnection({ authorityId: 'auth-1' });

    const detach = hub.attach(connection);
    connection.pushInvalidFrame({
      reason: 'Gateway frame must be valid JSON.',
      detail: 'Unexpected token } in JSON at position 1',
    });

    await flushGatewayFrames();

    expect(connection.closed).toBe(true);
    expect(connection.frames).toContainEqual({
      type: 'error',
      code: 'invalid_frame',
      message: 'Gateway frame must be valid JSON.',
      recoverable: false,
    });
    expect(observer).toHaveBeenCalledWith({
      type: 'invalid_frame',
      connectionId: expect.any(String),
      timestamp: expect.any(String),
      message: 'Gateway frame must be valid JSON.',
      detail: 'Unexpected token } in JSON at position 1',
    });

    detach();
  });

  it('terminates the connection after consecutive outbound send failures from sync throws and rejected promises', async () => {
    const source = createFakeSource('ready');
    const hub = createRuntimeGatewayHub({
      resolveScope: async () => source,
    });
    const connection = createFakeConnection(
      { authorityId: 'auth-1' },
      {
        sendBehavior(_frame, attempt) {
          if (attempt === 1 || attempt === 3) {
            throw new Error(`sync send failure ${attempt}`);
          }

          if (attempt === 2) {
            return Promise.reject(new Error('async send failure'));
          }
        },
      }
    );

    const detach = hub.attach(connection);
    connection.push({ type: 'hello' });
    connection.push({
      type: 'subscribe',
      streamId: 'fleet-main',
      scope: { kind: 'fleet-view' },
    });
    await flushGatewayFrames();

    expect(connection.sendAttempts).toBe(3);
    expect(connection.closed).toBe(true);
    expect(source.listenerCounts()).toEqual({
      snapshots: 0,
      events: 0,
      statuses: 0,
      transitions: 0,
    });

    detach();
  });

  it('subscribes, fans out frames by stream, supports resync, and cleans up on close', async () => {
    const source = createFakeSource('ready');
    const hub = createRuntimeGatewayHub({
      resolveScope: async (scope: RuntimeGatewayScopeDescriptor) => {
        if (scope.kind !== 'fleet-view') {
          throw new RuntimeGatewayScopeError('invalid_scope', 'Unknown scope kind.');
        }

        return source;
      },
    });
    const connection = createFakeConnection({ authorityId: 'auth-1' });

    const detach = hub.attach(connection);
    connection.push({
      type: 'hello',
      clientVersion: 'web-1',
    });
    connection.push({
      type: 'subscribe',
      streamId: 'fleet-main',
      scope: { kind: 'fleet-view', params: { authorityId: 'auth-1' } },
    });

    await flushGatewayFrames();

    expect(connection.frames[0]).toMatchObject({
      type: 'ready',
      heartbeatMs: 15000,
    });
    expect(connection.frames[1]).toMatchObject({
      type: 'status',
      streamId: 'fleet-main',
      status: {
        state: 'connected',
      },
    });
    expect(connection.frames[2]).toMatchObject({
      type: 'snapshot',
      streamId: 'fleet-main',
      sequence: 1,
      projection: {
        workflowSnapshot: {
          phase: 'ready',
        },
      },
    });

    source.emitEvent(createGatewayEvent(source, 'InspectionProgressRecorded'));
    source.emitTransition({
      fromPhase: 'ready',
      toPhase: 'submitted',
      fromStatus: 'running',
      toStatus: 'running',
    });

    const statusFrameCountBeforeResync = connection.frames.length;
    connection.push({
      type: 'resync',
      streamId: 'fleet-main',
      fromSequence: 2,
    });

    await flushGatewayFrames();

    expect(connection.frames[3]).toMatchObject({
      type: 'event',
      streamId: 'fleet-main',
      sequence: 2,
    });
    expect(connection.frames[4]).toMatchObject({
      type: 'transition',
      streamId: 'fleet-main',
      sequence: 3,
      transition: {
        fromPhase: 'ready',
        toPhase: 'submitted',
      },
    });
    expect(connection.frames.slice(statusFrameCountBeforeResync)).toMatchObject([
      {
        type: 'status',
        streamId: 'fleet-main',
        status: {
          state: 'replaying',
        },
      },
      {
        type: 'event',
        streamId: 'fleet-main',
        sequence: 2,
      },
      {
        type: 'transition',
        streamId: 'fleet-main',
        sequence: 3,
        transition: {
          fromPhase: 'ready',
          toPhase: 'submitted',
        },
      },
      {
        type: 'status',
        streamId: 'fleet-main',
        status: {
          state: 'connected',
        },
      },
    ]);

    expect(source.listenerCounts()).toEqual({
      snapshots: 1,
      events: 1,
      statuses: 1,
      transitions: 1,
    });

    connection.close();
    expect(source.listenerCounts()).toEqual({
      snapshots: 0,
      events: 0,
      statuses: 0,
      transitions: 0,
    });

    source.emitSnapshot(createGatewaySnapshot('submitted', { phase: 'submitted' }, 'ready'));
    expect(connection.frames).toHaveLength(9);

    detach();
  });

  it('falls back to latest snapshot when requested replay range is unavailable', async () => {
    const source = createFakeSource('ready');
    const hub = createRuntimeGatewayHub({
      replayBufferSize: 1,
      resolveScope: async () => source,
    });
    const connection = createFakeConnection({ authorityId: 'auth-1' });

    const detach = hub.attach(connection);
    connection.push({ type: 'hello' });
    connection.push({
      type: 'subscribe',
      streamId: 'fleet-main',
      scope: { kind: 'fleet-view' },
    });
    await flushGatewayFrames();

    source.emitEvent(createGatewayEvent(source, 'InspectionProgressRecorded'));
    source.emitTransition({
      fromPhase: 'ready',
      toPhase: 'submitted',
      fromStatus: 'running',
      toStatus: 'running',
    });

    const frameCountBeforeResync = connection.frames.length;
    connection.push({
      type: 'resync',
      streamId: 'fleet-main',
      fromSequence: 2,
    });
    await flushGatewayFrames();

    expect(connection.frames.slice(frameCountBeforeResync)).toMatchObject([
      {
        type: 'status',
        streamId: 'fleet-main',
        status: { state: 'replaying' },
      },
      {
        type: 'snapshot',
        streamId: 'fleet-main',
        sequence: 4,
        projection: createGatewaySnapshot('ready', { phase: 'ready' }),
      },
      {
        type: 'status',
        streamId: 'fleet-main',
        status: { state: 'connected' },
      },
    ]);

    detach();
  });

  it('hydrates stored replay before source listeners attach and seeds live sequence from restored frames', async () => {
    const replayStorage = createMapBackedReplayStorageFixture();
    const attachmentOrder: string[] = [];
    const replaySessionId = 'resume-connection';
    const streamId = 'fleet-main';
    const scope: RuntimeGatewayScopeDescriptor = { kind: 'fleet-view' };
    const storageKey = scopedReplayStorageKey(
      replaySessionIdForAuth({ authorityId: 'auth-1' }, replaySessionId),
      streamId,
      scope
    );
    const baseSource = createFakeSource('submitted', 'fleet-main');
    const source: RuntimeGatewaySource = {
      ...baseSource,
      subscribeSnapshot(listener) {
        attachmentOrder.push('subscribeSnapshot');
        return baseSource.subscribeSnapshot(listener);
      },
    };
    replayStorage.storage.set(storageKey, [
      {
        type: 'snapshot',
        streamId,
        sequence: 1,
        projection: createGatewaySnapshot('ready', { phase: 'ready' }, 'fleet-main'),
      },
      {
        type: 'event',
        streamId,
        sequence: 2,
        projection: createGatewayEvent(baseSource, 'InspectionProgressRecorded'),
      },
    ]);

    const loadFramesSpy = vi.spyOn(replayStorage.provider, 'loadFrames');
    const hub = createRuntimeGatewayHub({
      replayStorage: replayStorage.provider,
      resolveScope: async () => source,
    });
    const connection = createFakeConnection({ authorityId: 'auth-1' });

    const detach = hub.attach(connection);
    loadFramesSpy.mockImplementation((loadedReplaySessionId, loadedStreamId) => {
      attachmentOrder.push('loadFrames');
      return (
        replayStorage.storage.get(replayStorageKey(loadedReplaySessionId, loadedStreamId)) ?? []
      );
    });

    connection.push({
      type: 'hello',
      lastConnectionId: replaySessionId,
    });
    connection.push({
      type: 'subscribe',
      streamId,
      scope,
    });
    await flushGatewayFrames();

    expect(attachmentOrder).toEqual(['loadFrames', 'subscribeSnapshot']);
    expect(connection.frames[2]).toMatchObject({
      type: 'snapshot',
      streamId,
      sequence: 3,
      projection: {
        workflowSnapshot: {
          phase: 'submitted',
        },
      },
    });

    detach();
    loadFramesSpy.mockRestore();
  });

  it('persists bounded live replay frames and restores them across hub restart with the same replay session id', async () => {
    const replayStorage = createMapBackedReplayStorageFixture();
    const scope: RuntimeGatewayScopeDescriptor = { kind: 'fleet-view' };
    const firstSource = createFakeSource('ready', 'fleet-main');
    const firstHub = createRuntimeGatewayHub({
      replayStorage: replayStorage.provider,
      resolveScope: async () => firstSource,
    });
    const firstConnection = createFakeConnection({ authorityId: 'auth-1' });

    const firstDetach = firstHub.attach(firstConnection);
    firstConnection.push({ type: 'hello' });
    firstConnection.push({
      type: 'subscribe',
      streamId: 'fleet-main',
      scope,
    });
    await flushGatewayFrames();

    const firstConnectionId = (firstConnection.frames[0] as { connectionId: string }).connectionId;
    const storageKey = scopedReplayStorageKey(
      replaySessionIdForAuth({ authorityId: 'auth-1' }, firstConnectionId),
      'fleet-main',
      scope
    );

    firstSource.emitEvent(createGatewayEvent(firstSource, 'InspectionProgressRecorded'));
    firstSource.emitTransition({
      fromPhase: 'ready',
      toPhase: 'submitted',
      fromStatus: 'running',
      toStatus: 'running',
    });
    await flushGatewayFrames();

    expect(replayStorage.storage.get(storageKey)?.map((frame) => frame.sequence)).toEqual([
      1, 2, 3,
    ]);

    firstDetach();

    const secondSource = createFakeSource('submitted', 'fleet-main');
    const secondHub = createRuntimeGatewayHub({
      replayStorage: replayStorage.provider,
      resolveScope: async () => secondSource,
    });
    const secondConnection = createFakeConnection({ authorityId: 'auth-1' });

    const secondDetach = secondHub.attach(secondConnection);
    secondConnection.push({
      type: 'hello',
      lastConnectionId: firstConnectionId,
    });
    secondConnection.push({
      type: 'subscribe',
      streamId: 'fleet-main',
      scope,
    });
    await flushGatewayFrames();

    expect(secondConnection.frames[2]).toMatchObject({
      type: 'snapshot',
      streamId: 'fleet-main',
      sequence: 4,
      projection: {
        workflowSnapshot: {
          phase: 'submitted',
        },
      },
    });

    const frameCountBeforeResync = secondConnection.frames.length;
    secondConnection.push({
      type: 'resync',
      streamId: 'fleet-main',
      fromSequence: 2,
    });
    await flushGatewayFrames();

    expect(secondConnection.frames.slice(frameCountBeforeResync)).toMatchObject([
      {
        type: 'status',
        streamId: 'fleet-main',
        status: { state: 'replaying' },
      },
      {
        type: 'event',
        streamId: 'fleet-main',
        sequence: 2,
      },
      {
        type: 'transition',
        streamId: 'fleet-main',
        sequence: 3,
      },
      {
        type: 'snapshot',
        streamId: 'fleet-main',
        sequence: 4,
      },
      {
        type: 'status',
        streamId: 'fleet-main',
        status: { state: 'connected' },
      },
    ]);
    expect(
      replayStorage.calls.some((call) => call.type === 'load' && call.key === storageKey)
    ).toBe(true);

    secondDetach();
  });

  it('prevents a different authenticated owner from reusing a prior connection replay session', async () => {
    const replayStorage = createMapBackedReplayStorageFixture();
    const scope: RuntimeGatewayScopeDescriptor = { kind: 'fleet-view' };
    const firstSource = createFakeSource('ready', 'fleet-main');
    const secondSource = createFakeSource('submitted', 'fleet-main');
    let resolveScopeCalls = 0;
    const hub = createRuntimeGatewayHub({
      replayStorage: replayStorage.provider,
      resolveScope: async () => {
        resolveScopeCalls += 1;
        return resolveScopeCalls === 1 ? firstSource : secondSource;
      },
    });
    const firstConnection = createFakeConnection({ authorityId: 'auth-1' });

    const firstDetach = hub.attach(firstConnection);
    firstConnection.push({ type: 'hello' });
    firstConnection.push({
      type: 'subscribe',
      streamId: 'fleet-main',
      scope,
    });
    await flushGatewayFrames();

    const firstConnectionId = (firstConnection.frames[0] as { connectionId: string }).connectionId;
    const authOneStorageKey = scopedReplayStorageKey(
      replaySessionIdForAuth({ authorityId: 'auth-1' }, firstConnectionId),
      'fleet-main',
      scope
    );

    firstSource.emitEvent(createGatewayEvent(firstSource, 'InspectionProgressRecorded'));
    await flushGatewayFrames();
    expect(replayStorage.storage.get(authOneStorageKey)?.map((frame) => frame.sequence)).toEqual([
      1, 2,
    ]);

    const secondConnection = createFakeConnection({ authorityId: 'auth-2' });
    const secondDetach = hub.attach(secondConnection);
    secondConnection.push({
      type: 'hello',
      lastConnectionId: firstConnectionId,
    });
    secondConnection.push({
      type: 'subscribe',
      streamId: 'fleet-main',
      scope,
    });
    await flushGatewayFrames();

    expect(secondConnection.frames[2]).toMatchObject({
      type: 'snapshot',
      streamId: 'fleet-main',
      sequence: 1,
      projection: {
        workflowSnapshot: {
          phase: 'submitted',
        },
      },
    });

    const frameCountBeforeResync = secondConnection.frames.length;
    secondConnection.push({
      type: 'resync',
      streamId: 'fleet-main',
      fromSequence: 1,
    });
    await flushGatewayFrames();

    expect(secondConnection.frames.slice(frameCountBeforeResync)).toMatchObject([
      {
        type: 'status',
        streamId: 'fleet-main',
        status: { state: 'replaying' },
      },
      {
        type: 'snapshot',
        streamId: 'fleet-main',
        sequence: 1,
      },
      {
        type: 'status',
        streamId: 'fleet-main',
        status: { state: 'connected' },
      },
    ]);
    expect(secondConnection.frames.slice(frameCountBeforeResync)).not.toContainEqual(
      expect.objectContaining({
        type: 'event',
        projection: expect.objectContaining({
          envelope: expect.objectContaining({
            type: 'InspectionProgressRecorded',
          }),
        }),
      })
    );

    secondDetach();
    firstDetach();
  });

  it('falls back to a fresh replay session when no stable owner key is available', async () => {
    const replayStorage = createMapBackedReplayStorageFixture();
    const scope: RuntimeGatewayScopeDescriptor = { kind: 'fleet-view' };
    const firstSource = createFakeSource('ready', 'fleet-main');
    const secondSource = createFakeSource('submitted', 'fleet-main');
    let resolveScopeCalls = 0;
    const hub = createRuntimeGatewayHub({
      replayStorage: replayStorage.provider,
      resolveScope: async () => {
        resolveScopeCalls += 1;
        return resolveScopeCalls === 1 ? firstSource : secondSource;
      },
    });
    const firstConnection = createFakeConnection(undefined);

    const firstDetach = hub.attach(firstConnection);
    firstConnection.push({ type: 'hello' });
    firstConnection.push({
      type: 'subscribe',
      streamId: 'fleet-main',
      scope,
    });
    await flushGatewayFrames();

    const firstConnectionId = (firstConnection.frames[0] as { connectionId: string }).connectionId;
    const firstStorageKey = scopedReplayStorageKey(firstConnectionId, 'fleet-main', scope);

    firstSource.emitEvent(createGatewayEvent(firstSource, 'InspectionProgressRecorded'));
    await flushGatewayFrames();
    expect(replayStorage.storage.get(firstStorageKey)?.map((frame) => frame.sequence)).toEqual([
      1, 2,
    ]);

    const secondConnection = createFakeConnection(undefined);
    const secondDetach = hub.attach(secondConnection);
    secondConnection.push({
      type: 'hello',
      lastConnectionId: firstConnectionId,
    });
    secondConnection.push({
      type: 'subscribe',
      streamId: 'fleet-main',
      scope,
    });
    await flushGatewayFrames();

    const secondConnectionId = (secondConnection.frames[0] as { connectionId: string })
      .connectionId;
    const secondStorageKey = scopedReplayStorageKey(secondConnectionId, 'fleet-main', scope);

    expect(secondConnection.frames[2]).toMatchObject({
      type: 'snapshot',
      streamId: 'fleet-main',
      sequence: 1,
      projection: {
        workflowSnapshot: {
          phase: 'submitted',
        },
      },
    });
    expect(secondStorageKey).not.toBe(firstStorageKey);

    const frameCountBeforeResync = secondConnection.frames.length;
    secondConnection.push({
      type: 'resync',
      streamId: 'fleet-main',
      fromSequence: 1,
    });
    await flushGatewayFrames();

    expect(secondConnection.frames.slice(frameCountBeforeResync)).toMatchObject([
      {
        type: 'status',
        streamId: 'fleet-main',
        status: { state: 'replaying' },
      },
      {
        type: 'snapshot',
        streamId: 'fleet-main',
        sequence: 1,
      },
      {
        type: 'status',
        streamId: 'fleet-main',
        status: { state: 'connected' },
      },
    ]);
    expect(secondConnection.frames.slice(frameCountBeforeResync)).not.toContainEqual(
      expect.objectContaining({
        type: 'event',
        projection: expect.objectContaining({
          envelope: expect.objectContaining({
            type: 'InspectionProgressRecorded',
          }),
        }),
      })
    );

    secondDetach();
    firstDetach();
  });

  it('serializes async replay persistence so stale store completions cannot overwrite newer tails', async () => {
    const replayStorage = createAsyncMapBackedReplayStorageFixture();
    const scope: RuntimeGatewayScopeDescriptor = { kind: 'fleet-view' };
    const source = createFakeSource('ready');
    const hub = createRuntimeGatewayHub({
      replayStorage: replayStorage.provider,
      resolveScope: async () => source,
    });
    const connection = createFakeConnection({ authorityId: 'auth-1' });

    const detach = hub.attach(connection);
    connection.push({ type: 'hello' });
    connection.push({
      type: 'subscribe',
      streamId: 'fleet-main',
      scope,
    });
    await flushGatewayFrames();

    const connectionId = (connection.frames[0] as { connectionId: string }).connectionId;
    const storageKey = scopedReplayStorageKey(
      replaySessionIdForAuth({ authorityId: 'auth-1' }, connectionId),
      'fleet-main',
      scope
    );

    source.emitEvent(createGatewayEvent(source, 'InspectionProgressRecorded'));
    source.emitTransition({
      fromPhase: 'ready',
      toPhase: 'submitted',
      fromStatus: 'running',
      toStatus: 'running',
    });
    await flushGatewayFrames();

    expect(replayStorage.startedStores).toEqual([{ key: storageKey, sequences: [1] }]);
    expect(replayStorage.storage.has(storageKey)).toBe(false);

    replayStorage.resolveNextStore(storageKey);
    await flushGatewayFrames();
    expect(replayStorage.startedStores).toEqual([
      { key: storageKey, sequences: [1] },
      { key: storageKey, sequences: [1, 2] },
    ]);
    expect(replayStorage.storage.get(storageKey)?.map((frame) => frame.sequence)).toEqual([1]);

    replayStorage.resolveNextStore(storageKey);
    await flushGatewayFrames();
    expect(replayStorage.startedStores).toEqual([
      { key: storageKey, sequences: [1] },
      { key: storageKey, sequences: [1, 2] },
      { key: storageKey, sequences: [1, 2, 3] },
    ]);
    expect(replayStorage.storage.get(storageKey)?.map((frame) => frame.sequence)).toEqual([1, 2]);

    replayStorage.resolveNextStore(storageKey);
    await flushGatewayFrames();
    expect(replayStorage.storage.get(storageKey)?.map((frame) => frame.sequence)).toEqual([
      1, 2, 3,
    ]);

    detach();
  });

  it('serializes replay persistence across overlapping attachments that share a replay session and stream id', async () => {
    const replayStorage = createAsyncMapBackedReplayStorageFixture();
    const scope: RuntimeGatewayScopeDescriptor = { kind: 'fleet-view' };
    const firstSource = createFakeSource('ready', 'fleet-main');
    const secondSource = createFakeSource('submitted', 'fleet-main');
    let resolveScopeCalls = 0;
    const hub = createRuntimeGatewayHub({
      replayStorage: replayStorage.provider,
      resolveScope: async () => {
        resolveScopeCalls += 1;
        return resolveScopeCalls === 1 ? firstSource : secondSource;
      },
    });
    const firstConnection = createFakeConnection({ authorityId: 'auth-1' });
    const secondConnection = createFakeConnection({ authorityId: 'auth-1' });

    const firstDetach = hub.attach(firstConnection);
    firstConnection.push({ type: 'hello' });
    firstConnection.push({
      type: 'subscribe',
      streamId: 'fleet-main',
      scope,
    });
    await flushGatewayFrames();

    const replaySessionId = (firstConnection.frames[0] as { connectionId: string }).connectionId;
    const storageKey = scopedReplayStorageKey(
      replaySessionIdForAuth({ authorityId: 'auth-1' }, replaySessionId),
      'fleet-main',
      scope
    );

    expect(replayStorage.startedStores).toEqual([{ key: storageKey, sequences: [1] }]);

    const secondDetach = hub.attach(secondConnection);
    secondConnection.push({
      type: 'hello',
      lastConnectionId: replaySessionId,
    });
    secondConnection.push({
      type: 'subscribe',
      streamId: 'fleet-main',
      scope,
    });
    await flushGatewayFrames();

    secondSource.emitEvent(createGatewayEvent(secondSource, 'InspectionProgressRecorded'));
    await flushGatewayFrames();

    expect(replayStorage.startedStores).toEqual([{ key: storageKey, sequences: [1] }]);
    expect(replayStorage.storage.has(storageKey)).toBe(false);

    replayStorage.resolveNextStore(storageKey);
    await flushGatewayFrames();
    expect(replayStorage.startedStores).toEqual([
      { key: storageKey, sequences: [1] },
      { key: storageKey, sequences: [1] },
    ]);
    expect(replayStorage.storage.get(storageKey)?.map((frame) => frame.sequence)).toEqual([1]);

    replayStorage.resolveNextStore(storageKey);
    await flushGatewayFrames();
    expect(replayStorage.startedStores).toEqual([
      { key: storageKey, sequences: [1] },
      { key: storageKey, sequences: [1] },
      { key: storageKey, sequences: [1, 2] },
    ]);
    expect(replayStorage.storage.get(storageKey)?.map((frame) => frame.sequence)).toEqual([1]);

    replayStorage.resolveNextStore(storageKey);
    await flushGatewayFrames();
    expect(replayStorage.storage.get(storageKey)?.map((frame) => frame.sequence)).toEqual([1, 2]);

    secondDetach();
    firstDetach();
  });

  it('discards restored durable replay when the reused stream id resolves to a different source', async () => {
    const replayStorage = createMapBackedReplayStorageFixture();
    const replaySessionId = 'resume-connection';
    const streamId = 'fleet-main';
    const scope: RuntimeGatewayScopeDescriptor = { kind: 'fleet-view' };
    const storageKey = scopedReplayStorageKey(
      replaySessionIdForAuth({ authorityId: 'auth-1' }, replaySessionId),
      streamId,
      scope
    );
    const previousSource = createFakeSource('ready', 'old-scope');

    replayStorage.storage.set(storageKey, [
      {
        type: 'snapshot',
        streamId,
        sequence: 1,
        projection: createGatewaySnapshot('ready', { phase: 'ready' }, 'old-scope'),
      },
      {
        type: 'event',
        streamId,
        sequence: 2,
        projection: createGatewayEvent(previousSource, 'InspectionProgressRecorded'),
      },
    ]);

    const newSource = createFakeSource('submitted', 'new-scope');
    const hub = createRuntimeGatewayHub({
      replayStorage: replayStorage.provider,
      resolveScope: async () => newSource,
    });
    const connection = createFakeConnection({ authorityId: 'auth-1' });

    const detach = hub.attach(connection);
    connection.push({
      type: 'hello',
      lastConnectionId: replaySessionId,
    });
    connection.push({
      type: 'subscribe',
      streamId,
      scope,
    });
    await flushGatewayFrames();

    expect(connection.frames[2]).toMatchObject({
      type: 'snapshot',
      streamId,
      sequence: 1,
      projection: {
        address: createGatewayAddress('new-scope'),
        workflowSnapshot: {
          phase: 'submitted',
        },
      },
    });

    newSource.emitEvent(createGatewayEvent(newSource, 'InspectionProgressRecorded'));
    await flushGatewayFrames();

    const frameCountBeforeResync = connection.frames.length;
    connection.push({
      type: 'resync',
      streamId,
      fromSequence: 1,
    });
    await flushGatewayFrames();

    expect(connection.frames.slice(frameCountBeforeResync)).toMatchObject([
      {
        type: 'status',
        streamId,
        status: { state: 'replaying' },
      },
      {
        type: 'snapshot',
        streamId,
        sequence: 1,
        projection: {
          address: createGatewayAddress('new-scope'),
        },
      },
      {
        type: 'event',
        streamId,
        sequence: 2,
        projection: {
          address: createGatewayAddress('new-scope'),
        },
      },
      {
        type: 'status',
        streamId,
        status: { state: 'connected' },
      },
    ]);

    expect(connection.frames.slice(frameCountBeforeResync)).not.toContainEqual(
      expect.objectContaining({
        type: 'event',
        projection: expect.objectContaining({
          address: createGatewayAddress('old-scope'),
        }),
      })
    );
    expect(replayStorage.storage.get(storageKey)?.map((frame) => frame.sequence)).toEqual([1, 2]);
    expect(
      replayStorage.storage
        .get(storageKey)
        ?.map((frame) => (frame.type === 'transition' ? null : frame.projection.address.path))
    ).toEqual(['/actors/new-scope', '/actors/new-scope']);

    detach();
  });

  it('discards transition-only durable replay tails when the source identity cannot be verified', async () => {
    const replayStorage = createMapBackedReplayStorageFixture();
    const replaySessionId = 'resume-connection';
    const streamId = 'fleet-main';
    const scope: RuntimeGatewayScopeDescriptor = { kind: 'fleet-view' };
    const storageKey = scopedReplayStorageKey(
      replaySessionIdForAuth({ authorityId: 'auth-1' }, replaySessionId),
      streamId,
      scope
    );

    replayStorage.storage.set(storageKey, [
      {
        type: 'transition',
        streamId,
        sequence: 9,
        transition: {
          fromPhase: 'ready',
          toPhase: 'submitted',
          fromStatus: 'running',
          toStatus: 'running',
        },
      },
    ]);

    const newSource = createFakeSource('submitted', 'new-scope');
    const hub = createRuntimeGatewayHub({
      replayStorage: replayStorage.provider,
      resolveScope: async () => newSource,
    });
    const connection = createFakeConnection({ authorityId: 'auth-1' });

    const detach = hub.attach(connection);
    connection.push({
      type: 'hello',
      lastConnectionId: replaySessionId,
    });
    connection.push({
      type: 'subscribe',
      streamId,
      scope,
    });
    await flushGatewayFrames();

    expect(connection.frames[2]).toMatchObject({
      type: 'snapshot',
      streamId,
      sequence: 1,
      projection: {
        address: createGatewayAddress('new-scope'),
        workflowSnapshot: {
          phase: 'submitted',
        },
      },
    });
    expect(connection.frames).not.toContainEqual(
      expect.objectContaining({
        type: 'transition',
        streamId,
        sequence: 10,
      })
    );

    const frameCountBeforeResync = connection.frames.length;
    connection.push({
      type: 'resync',
      streamId,
      fromSequence: 1,
    });
    await flushGatewayFrames();

    expect(connection.frames.slice(frameCountBeforeResync)).toMatchObject([
      {
        type: 'status',
        streamId,
        status: { state: 'replaying' },
      },
      {
        type: 'snapshot',
        streamId,
        sequence: 1,
        projection: {
          address: createGatewayAddress('new-scope'),
        },
      },
      {
        type: 'status',
        streamId,
        status: { state: 'connected' },
      },
    ]);
    expect(connection.frames.slice(frameCountBeforeResync)).not.toContainEqual(
      expect.objectContaining({
        type: 'transition',
      })
    );
    expect(replayStorage.storage.get(storageKey)?.map((frame) => frame.sequence)).toEqual([1]);
    expect(replayStorage.storage.get(storageKey)?.[0]).toMatchObject({
      type: 'snapshot',
      sequence: 1,
      projection: {
        address: createGatewayAddress('new-scope'),
      },
    });

    detach();
  });

  it('isolates durable replay storage for the same actor address when scope params change', async () => {
    const replayStorage = createMapBackedReplayStorageFixture();
    const replaySessionId = 'resume-connection';
    const streamId = 'fleet-main';
    const firstScope: RuntimeGatewayScopeDescriptor = {
      kind: 'fleet-view',
      params: { authorityId: 'auth-1', vehicleId: 'vehicle-1' },
    };
    const secondScope: RuntimeGatewayScopeDescriptor = {
      kind: 'fleet-view',
      params: { authorityId: 'auth-1', vehicleId: 'vehicle-2' },
    };
    const firstStorageKey = scopedReplayStorageKey(
      replaySessionIdForAuth({ authorityId: 'auth-1' }, replaySessionId),
      streamId,
      firstScope
    );
    const secondStorageKey = scopedReplayStorageKey(
      replaySessionIdForAuth({ authorityId: 'auth-1' }, replaySessionId),
      streamId,
      secondScope
    );
    const sharedActorKey = 'shared-fleet-actor';
    const firstSource = createFakeSource('ready', sharedActorKey);
    const secondSource = createFakeSource('submitted', sharedActorKey);
    let resolveScopeCalls = 0;
    const hub = createRuntimeGatewayHub({
      replayStorage: replayStorage.provider,
      resolveScope: async () => {
        resolveScopeCalls += 1;
        return resolveScopeCalls === 1 ? firstSource : secondSource;
      },
    });
    const firstConnection = createFakeConnection({ authorityId: 'auth-1' });
    const secondConnection = createFakeConnection({ authorityId: 'auth-1' });

    const firstDetach = hub.attach(firstConnection);
    firstConnection.push({
      type: 'hello',
      lastConnectionId: replaySessionId,
    });
    firstConnection.push({
      type: 'subscribe',
      streamId,
      scope: firstScope,
    });
    await flushGatewayFrames();

    firstSource.emitEvent(createGatewayEvent(firstSource, 'VehicleOneReplayRecorded'));
    await flushGatewayFrames();

    expect(replayStorage.storage.get(firstStorageKey)?.map((frame) => frame.sequence)).toEqual([
      1, 2,
    ]);
    expect(replayStorage.storage.has(secondStorageKey)).toBe(false);

    const secondDetach = hub.attach(secondConnection);
    secondConnection.push({
      type: 'hello',
      lastConnectionId: replaySessionId,
    });
    secondConnection.push({
      type: 'subscribe',
      streamId,
      scope: secondScope,
    });
    await flushGatewayFrames();

    expect(secondConnection.frames[2]).toMatchObject({
      type: 'snapshot',
      streamId,
      sequence: 1,
      projection: {
        address: createGatewayAddress(sharedActorKey),
        workflowSnapshot: {
          phase: 'submitted',
        },
      },
    });

    secondSource.emitEvent(createGatewayEvent(secondSource, 'VehicleTwoReplayRecorded'));
    await flushGatewayFrames();

    const frameCountBeforeResync = secondConnection.frames.length;
    secondConnection.push({
      type: 'resync',
      streamId,
      fromSequence: 1,
    });
    await flushGatewayFrames();

    expect(secondConnection.frames.slice(frameCountBeforeResync)).toMatchObject([
      {
        type: 'status',
        streamId,
        status: { state: 'replaying' },
      },
      {
        type: 'snapshot',
        streamId,
        sequence: 1,
        projection: {
          address: createGatewayAddress(sharedActorKey),
        },
      },
      {
        type: 'event',
        streamId,
        sequence: 2,
        projection: {
          address: createGatewayAddress(sharedActorKey),
          envelope: {
            type: 'VehicleTwoReplayRecorded',
          },
        },
      },
      {
        type: 'status',
        streamId,
        status: { state: 'connected' },
      },
    ]);
    expect(secondConnection.frames.slice(frameCountBeforeResync)).not.toContainEqual(
      expect.objectContaining({
        type: 'event',
        projection: expect.objectContaining({
          envelope: expect.objectContaining({
            type: 'VehicleOneReplayRecorded',
          }),
        }),
      })
    );
    expect(replayStorage.storage.get(firstStorageKey)?.map((frame) => frame.sequence)).toEqual([
      1, 2,
    ]);
    expect(replayStorage.storage.get(secondStorageKey)?.map((frame) => frame.sequence)).toEqual([
      1, 2,
    ]);
    expect(firstStorageKey).not.toBe(secondStorageKey);

    secondDetach();
    firstDetach();
  });

  it('reports replay storage load failures and keeps the gateway live', async () => {
    const replayStorage = createMapBackedReplayStorageFixture();
    const onReplayStorageError = vi.fn<(event: RuntimeGatewayReplayStorageErrorEvent) => void>();
    const replaySessionId = 'faulty-connection';
    const expectedReplaySessionId = replaySessionIdForAuth(
      { authorityId: 'auth-1' },
      replaySessionId
    );
    const streamId = 'fleet-main';
    const scope: RuntimeGatewayScopeDescriptor = { kind: 'fleet-view' };
    const storageKey = scopedReplayStorageKey(
      replaySessionIdForAuth({ authorityId: 'auth-1' }, replaySessionId),
      streamId,
      scope
    );
    replayStorage.failLoadFor(storageKey);

    const source = createFakeSource('ready');
    const hub = createRuntimeGatewayHub({
      replayStorage: replayStorage.provider,
      onReplayStorageError,
      resolveScope: async () => source,
    });
    const connection = createFakeConnection({ authorityId: 'auth-1' });

    const detach = hub.attach(connection);
    connection.push({
      type: 'hello',
      lastConnectionId: replaySessionId,
    });
    connection.push({
      type: 'subscribe',
      streamId,
      scope,
    });
    await flushGatewayFrames();

    source.emitEvent(createGatewayEvent(source, 'InspectionProgressRecorded'));
    await flushGatewayFrames();

    expect(onReplayStorageError).toHaveBeenCalledTimes(1);
    expect(onReplayStorageError).toHaveBeenCalledWith({
      operation: 'load',
      replaySessionId: expectedReplaySessionId,
      streamId,
      error: expect.any(Error),
    });
    expect(connection.closed).toBe(false);
    expect(source.listenerCounts()).toEqual({
      snapshots: 1,
      events: 1,
      statuses: 1,
      transitions: 1,
    });
    expect(connection.frames).toContainEqual({
      type: 'snapshot',
      streamId,
      sequence: 1,
      projection: createGatewaySnapshot('ready', { phase: 'ready' }),
    });
    expect(connection.frames).toContainEqual({
      type: 'event',
      streamId,
      sequence: 2,
      projection: createGatewayEvent(source, 'InspectionProgressRecorded'),
    });
    expect(replayStorage.storage.get(storageKey)?.map((frame) => frame.sequence)).toEqual([1, 2]);

    detach();
  });

  it('reports replay storage store failures and keeps the gateway live', async () => {
    const replayStorage = createMapBackedReplayStorageFixture();
    const onReplayStorageError = vi.fn<(event: RuntimeGatewayReplayStorageErrorEvent) => void>();
    const replaySessionId = 'faulty-connection';
    const expectedReplaySessionId = replaySessionIdForAuth(
      { authorityId: 'auth-1' },
      replaySessionId
    );
    const streamId = 'fleet-main';
    const scope: RuntimeGatewayScopeDescriptor = { kind: 'fleet-view' };
    const storageKey = scopedReplayStorageKey(
      replaySessionIdForAuth({ authorityId: 'auth-1' }, replaySessionId),
      streamId,
      scope
    );
    replayStorage.failStoreFor(storageKey);

    const source = createFakeSource('ready');
    const hub = createRuntimeGatewayHub({
      replayStorage: replayStorage.provider,
      onReplayStorageError,
      resolveScope: async () => source,
    });
    const connection = createFakeConnection({ authorityId: 'auth-1' });

    const detach = hub.attach(connection);
    connection.push({
      type: 'hello',
      lastConnectionId: replaySessionId,
    });
    connection.push({
      type: 'subscribe',
      streamId,
      scope,
    });
    await flushGatewayFrames();

    source.emitEvent(createGatewayEvent(source, 'InspectionProgressRecorded'));
    await flushGatewayFrames();

    expect(onReplayStorageError).toHaveBeenCalled();
    expect(onReplayStorageError).toHaveBeenNthCalledWith(1, {
      operation: 'store',
      replaySessionId: expectedReplaySessionId,
      streamId,
      error: expect.any(Error),
      frameCount: 1,
    });
    expect(connection.closed).toBe(false);
    expect(connection.frames).toContainEqual({
      type: 'snapshot',
      streamId,
      sequence: 1,
      projection: createGatewaySnapshot('ready', { phase: 'ready' }),
    });
    expect(connection.frames).toContainEqual({
      type: 'event',
      streamId,
      sequence: 2,
      projection: createGatewayEvent(source, 'InspectionProgressRecorded'),
    });
    expect(replayStorage.storage.has(storageKey)).toBe(false);

    detach();
  });

  it('fails closed when the inbound queue limit is exceeded and reports observer evidence', async () => {
    let releaseScope: (() => void) | undefined;
    const scopeReady = new Promise<void>((resolve) => {
      releaseScope = resolve;
    });
    const observer = vi.fn<(event: RuntimeGatewayObserverEvent) => void>();
    const hub = createRuntimeGatewayHub({
      inboundQueueLimit: 1,
      observer,
      resolveScope: async () => {
        await scopeReady;
        return createFakeSource();
      },
    });
    const connection = createFakeConnection({ authorityId: 'auth-1' });

    const detach = hub.attach(connection);
    connection.push({ type: 'hello' });
    await flushGatewayFrames();

    connection.push({
      type: 'subscribe',
      streamId: 'fleet-main',
      scope: { kind: 'fleet-view' },
    });
    connection.push({
      type: 'ping',
      sentAt: '2026-04-23T15:00:01.000Z',
    });
    connection.push({
      type: 'ping',
      sentAt: '2026-04-23T15:00:02.000Z',
    });

    await flushGatewayFrames();

    expect(connection.closed).toBe(true);
    expect(connection.frames).toContainEqual({
      type: 'error',
      code: 'invalid_frame',
      message: 'Gateway inbound queue limit exceeded.',
      recoverable: false,
    });
    expect(observer).toHaveBeenCalledWith({
      type: 'inbound_queue_overflow',
      connectionId: expect.any(String),
      timestamp: expect.any(String),
      message: 'Gateway inbound queue limit exceeded.',
      queueDepth: 1,
      queueLimit: 1,
    });

    releaseScope?.();
    await flushGatewayFrames();

    detach();
  });

  it('swallows replay storage error hook failures and keeps the gateway live', async () => {
    const replayStorage = createMapBackedReplayStorageFixture();
    const replaySessionId = 'faulty-connection';
    const streamId = 'fleet-main';
    const scope: RuntimeGatewayScopeDescriptor = { kind: 'fleet-view' };
    const storageKey = scopedReplayStorageKey(
      replaySessionIdForAuth({ authorityId: 'auth-1' }, replaySessionId),
      streamId,
      scope
    );
    replayStorage.failStoreFor(storageKey);

    const source = createFakeSource('ready');
    const onReplayStorageError = vi.fn(() => {
      throw new Error('observer failed');
    });
    const hub = createRuntimeGatewayHub({
      replayStorage: replayStorage.provider,
      onReplayStorageError,
      resolveScope: async () => source,
    });
    const connection = createFakeConnection({ authorityId: 'auth-1' });

    const detach = hub.attach(connection);
    connection.push({
      type: 'hello',
      lastConnectionId: replaySessionId,
    });
    connection.push({
      type: 'subscribe',
      streamId,
      scope,
    });
    await flushGatewayFrames();

    source.emitEvent(createGatewayEvent(source, 'InspectionProgressRecorded'));
    await flushGatewayFrames();

    expect(onReplayStorageError).toHaveBeenCalled();
    expect(connection.closed).toBe(false);
    expect(connection.frames).toContainEqual({
      type: 'event',
      streamId,
      sequence: 2,
      projection: createGatewayEvent(source, 'InspectionProgressRecorded'),
    });
    expect(replayStorage.storage.has(storageKey)).toBe(false);

    detach();
  });

  it('routes send and ask commands through subscribed runtime sources', async () => {
    const source = createFakeSource('ready');
    const hub = createRuntimeGatewayHub({
      resolveScope: async () => source,
    });
    const connection = createFakeConnection({ authorityId: 'auth-1' });

    const detach = hub.attach(connection);
    connection.push({ type: 'hello' });
    connection.push({
      type: 'subscribe',
      streamId: 'checkout-main',
      scope: { kind: 'checkout' },
    });
    await flushGatewayFrames();

    connection.push({
      type: 'send',
      streamId: 'checkout-main',
      message: { type: 'SUBMIT', orderId: 'order-gateway' },
    });
    connection.push({
      type: 'ask',
      streamId: 'checkout-main',
      requestId: 'request-1',
      message: { type: 'GET_COUNT' },
      timeoutMs: 1000,
    });
    await flushGatewayFrames();
    await flushGatewayFrames();

    expect(source.sentMessages).toEqual([{ type: 'SUBMIT', orderId: 'order-gateway' }]);
    expect(source.askMessages).toEqual([{ type: 'GET_COUNT' }]);
    expect(connection.frames).toContainEqual({
      type: 'ack',
      streamId: 'checkout-main',
    });
    expect(
      connection.frames.find((frame) => (frame as { type?: string }).type === 'reply')
    ).toMatchObject({
      type: 'reply',
      streamId: 'checkout-main',
      requestId: 'request-1',
      value: { ok: true, messageType: 'GET_COUNT' },
    });

    detach();
  });

  it('rejects command frames for invalid and unsubscribed streams', async () => {
    const source = createFakeSource('ready');
    const hub = createRuntimeGatewayHub({
      resolveScope: async () => source,
    });
    const connection = createFakeConnection({ authorityId: 'auth-1' });

    const detach = hub.attach(connection);
    connection.push({ type: 'hello' });
    connection.push({
      type: 'send',
      streamId: 'missing',
      message: { type: 'SUBMIT', orderId: 'order-gateway' },
    });
    connection.push({
      type: 'ask',
      streamId: '',
      requestId: 'request-1',
      message: { type: 'GET_COUNT' },
    });
    await flushGatewayFrames();

    expect(source.sentMessages).toEqual([]);
    expect(connection.frames).toContainEqual({
      type: 'error',
      streamId: 'missing',
      code: 'not_found',
      message: 'Cannot send command to an unsubscribed stream.',
      recoverable: true,
    });
    expect(connection.frames).toContainEqual({
      type: 'error',
      code: 'invalid_frame',
      message: 'command requires a non-empty streamId.',
      recoverable: true,
    });

    detach();
  });
});
