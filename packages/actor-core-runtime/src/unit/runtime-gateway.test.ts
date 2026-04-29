import { describe, expect, it } from 'vitest';
import { emit, setup } from 'xstate';
import { createActorRef } from '../create-actor-ref.js';
import {
  createProjectionTransportStatus,
  type ProjectionTransportStatus,
} from '../projection-transport.js';
import {
  createRuntimeGatewayHub,
  createRuntimeGatewaySource,
  type RuntimeGatewayClientFrame,
  type RuntimeGatewayConnectionAdapter,
  type RuntimeGatewayEventProjection,
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
  push(frame: RuntimeGatewayClientFrame): void;
  close(): void;
}

function createFakeConnection<TAuthContext = unknown>(
  authContext: TAuthContext
): FakeConnection<TAuthContext> {
  const receiveListeners = new Set<(frame: RuntimeGatewayClientFrame) => void>();
  const closeListeners = new Set<() => void>();
  const frames: unknown[] = [];

  return {
    authContext,
    frames,
    closed: false,
    receive(listener) {
      receiveListeners.add(listener);
      return () => {
        receiveListeners.delete(listener);
      };
    },
    onClose(listener) {
      closeListeners.add(listener);
      return () => {
        closeListeners.delete(listener);
      };
    },
    send(frame) {
      frames.push(frame);
    },
    push(frame) {
      for (const listener of Array.from(receiveListeners)) {
        listener(frame);
      }
    },
    close() {
      this.closed = true;
      for (const listener of Array.from(closeListeners)) {
        listener();
      }
    },
  };
}

function createGatewaySnapshot(
  phase: string,
  context: Record<string, unknown>
): RuntimeGatewaySnapshotProjection {
  return {
    address: {
      id: `actor-${phase}`,
      type: 'actor',
      path: `/actors/${phase}`,
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

function createFakeSource(initialPhase = 'ready'): RuntimeGatewaySource & {
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
  let currentSnapshot = createGatewaySnapshot(initialPhase, { phase: initialPhase });
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
    address: currentSnapshot.address,
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
      currentSnapshot = snapshot;
      for (const listener of Array.from(snapshotListeners)) {
        listener(snapshot);
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

    source.emitEvent({
      address: source.address,
      envelope: {
        id: 'event-1',
        kind: 'fact',
        type: 'InspectionProgressRecorded',
        schemaVersion: 1,
        occurredAt: '2026-04-23T15:00:01.000Z',
        sourceActor: '/actors/ready',
        payload: {},
      },
    });
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
        type: 'snapshot',
        streamId: 'fleet-main',
        sequence: 4,
        projection: createGatewaySnapshot('ready', { phase: 'ready' }),
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

    source.emitSnapshot(createGatewaySnapshot('submitted', { phase: 'submitted' }));
    expect(connection.frames).toHaveLength(8);

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
