import { describe, expect, it } from 'vitest';
import {
  type ActorWebGatewaySocket,
  createActorWebCommandSource,
  createActorWebReadModelSource,
  createActorWebSource,
} from '../actor-web-source.js';
import type { RuntimeGatewayClientFrame, RuntimeGatewayServerFrame } from '../runtime-gateway.js';

class FakeGatewaySocket implements ActorWebGatewaySocket {
  readonly readyState = 1;
  readonly sentFrames: RuntimeGatewayClientFrame[] = [];
  private readonly listeners = new Map<string, Set<(event?: unknown) => void>>();

  send(data: string): void {
    this.sentFrames.push(JSON.parse(data) as RuntimeGatewayClientFrame);
  }

  close(): void {
    this.emit('close');
  }

  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  addEventListener(type: 'error', listener: (event: Event) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<string>) => void): void;
  addEventListener(
    type: 'open' | 'close' | 'error' | 'message',
    listener: ((event?: unknown) => void) | (() => void)
  ): void {
    const listeners = this.listeners.get(type) ?? new Set<(event?: unknown) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  open(): void {
    this.emit('open');
  }

  receive(frame: RuntimeGatewayServerFrame): void {
    this.emit('message', { data: JSON.stringify(frame) });
  }

  private emit(type: string, event?: unknown): void {
    for (const listener of Array.from(this.listeners.get(type) ?? [])) {
      listener(event);
    }
  }
}

describe('createActorWebSource', () => {
  it('subscribes to a runtime gateway and exposes snapshots, events, send, and ask', async () => {
    const socket = new FakeGatewaySocket();
    const source = createActorWebSource(
      {
        address: 'actor://server-node/actor/shipment',
        gateway: {
          url: 'ws://gateway.local/runtime',
          scope: { kind: 'shipment' },
        },
      },
      {
        createSocket: () => socket,
        streamId: 'shipment-stream',
      }
    );
    const snapshots: unknown[] = [];
    const events: unknown[] = [];
    const statuses: string[] = [];

    source.subscribe((snapshot) => {
      snapshots.push(snapshot.context);
    });
    source.subscribeEvent((event) => {
      events.push(event);
    });
    source.subscribeTransportStatus((status) => {
      statuses.push(status.state);
    });

    socket.open();
    socket.receive({
      type: 'ready',
      connectionId: 'connection-1',
      heartbeatMs: 15000,
      serverTime: '2026-04-25T18:00:00.000Z',
    });
    socket.receive({
      type: 'status',
      streamId: 'shipment-stream',
      status: {
        state: 'connected',
        updatedAt: Date.parse('2026-04-25T18:00:01.000Z'),
      },
    });
    socket.receive({
      type: 'snapshot',
      streamId: 'shipment-stream',
      sequence: 1,
      projection: {
        address: source.address,
        workflowSnapshot: {
          workflowId: 'shipment',
          actorId: 'shipment',
          taskId: 'shipment',
          taskTitle: 'Shipment',
          phase: 'created',
          status: 'running',
          createdAt: '2026-04-25T18:00:00.000Z',
          updatedAt: '2026-04-25T18:00:01.000Z',
          branchName: null,
          baseBranch: null,
          correlationId: 'shipment',
          lastEventType: null,
          notes: [],
          artifacts: {},
        },
        value: 'created',
        context: {
          shipmentId: 'shipment-1',
          status: 'created',
        },
      },
    });
    socket.receive({
      type: 'event',
      streamId: 'shipment-stream',
      sequence: 2,
      projection: {
        address: source.address,
        envelope: {
          id: 'event-1',
          kind: 'fact',
          type: 'SHIPMENT_CREATED',
          schemaVersion: 1,
          occurredAt: '2026-04-25T18:00:01.000Z',
          sourceActor: source.address.path,
          payload: {
            shipmentId: 'shipment-1',
          },
        },
      },
    });

    const sendPromise = source.send({ type: 'RESET' });
    await Promise.resolve();
    socket.receive({ type: 'ack', streamId: 'shipment-stream' });
    await sendPromise;

    const askPromise = source.ask<number>({ type: 'GET_COUNT' });
    await Promise.resolve();
    const askFrame = socket.sentFrames.find((frame) => frame.type === 'ask');
    if (!askFrame || askFrame.type !== 'ask') {
      throw new Error('Expected ask frame');
    }
    socket.receive({
      type: 'reply',
      streamId: 'shipment-stream',
      requestId: askFrame.requestId,
      value: 1,
    });
    await expect(askPromise).resolves.toBe(1);

    expect(socket.sentFrames[0]).toEqual({ type: 'hello', clientVersion: 'actor-web-source' });
    expect(socket.sentFrames[1]).toEqual({
      type: 'subscribe',
      streamId: 'shipment-stream',
      scope: { kind: 'shipment' },
    });
    expect(socket.sentFrames[2]).toEqual({
      type: 'send',
      streamId: 'shipment-stream',
      requestId: 'actor-web-source-send-1',
      message: { type: 'RESET' },
    });
    expect(socket.sentFrames[3]).toEqual({
      type: 'ask',
      streamId: 'shipment-stream',
      requestId: askFrame.requestId,
      message: { type: 'GET_COUNT' },
    });
    expect(source.snapshot().context).toEqual({ shipmentId: 'shipment-1', status: 'created' });
    expect(snapshots).toContainEqual({ shipmentId: 'shipment-1', status: 'created' });
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'SHIPMENT_CREATED', shipmentId: 'shipment-1' })
    );
    expect(statuses).toContain('connected');

    source.close();
  });

  it('keeps browser read-model sources command-free unless the host opts in', async () => {
    const socket = new FakeGatewaySocket();
    const source = createActorWebReadModelSource(
      {
        address: 'actor://server-node/actor/shipment',
        gateway: {
          url: 'ws://gateway.local/runtime',
          scope: { kind: 'shipment' },
        },
      },
      {
        createSocket: () => socket,
        streamId: 'shipment-stream',
      }
    );
    const commandSource = createActorWebCommandSource(
      {
        address: 'actor://server-node/actor/shipment',
        gateway: {
          url: 'ws://gateway.local/runtime',
          scope: { kind: 'shipment' },
        },
      },
      {
        createSocket: () => socket,
        streamId: 'shipment-command-stream',
      }
    );

    expect('send' in source).toBe(false);
    expect('ask' in source).toBe(false);
    expect(typeof commandSource.send).toBe('function');
    expect(typeof commandSource.ask).toBe('function');

    source.close();
    commandSource.close();
  });

  it('keeps read-model subscriptions full while explicit command sources opt into command-only', async () => {
    const readModelSocket = new FakeGatewaySocket();
    const commandSocket = new FakeGatewaySocket();
    const readModel = createActorWebReadModelSource(
      {
        address: 'actor://server-node/actor/shipment',
        gateway: {
          url: 'ws://gateway.local/runtime',
          scope: { kind: 'shipment' },
        },
      },
      {
        createSocket: () => readModelSocket,
        streamId: 'shipment-read-model',
      }
    );
    const commandSource = createActorWebCommandSource(
      {
        address: 'actor://server-node/actor/shipment',
        gateway: {
          url: 'ws://gateway.local/runtime',
          scope: { kind: 'shipment' },
        },
      },
      {
        createSocket: () => commandSocket,
        streamId: 'shipment-command',
      }
    );

    readModelSocket.open();
    readModelSocket.receive({
      type: 'ready',
      connectionId: 'read-model-connection',
      heartbeatMs: 15000,
      serverTime: '2026-04-25T18:00:00.000Z',
    });
    commandSocket.open();
    commandSocket.receive({
      type: 'ready',
      connectionId: 'command-connection',
      heartbeatMs: 15000,
      serverTime: '2026-04-25T18:00:00.000Z',
    });
    commandSocket.receive({
      type: 'status',
      streamId: 'shipment-command',
      status: {
        state: 'connected',
        updatedAt: Date.parse('2026-04-25T18:00:01.000Z'),
      },
    });

    const sendPromise = commandSource.send({ type: 'RESET' });
    await Promise.resolve();
    commandSocket.receive({ type: 'ack', streamId: 'shipment-command' });
    await sendPromise;

    expect(readModelSocket.sentFrames).toContainEqual({
      type: 'subscribe',
      streamId: 'shipment-read-model',
      scope: { kind: 'shipment' },
    });
    expect(commandSocket.sentFrames).toContainEqual({
      type: 'subscribe',
      streamId: 'shipment-command',
      scope: { kind: 'shipment' },
      mode: 'command-only',
    });

    readModel.close();
    commandSource.close();
  });

  it('sends gateway auth on the hello frame without requiring custom source glue', async () => {
    const socket = new FakeGatewaySocket();
    createActorWebSource(
      {
        address: 'actor://server-node/actor/shipment',
        gateway: {
          url: 'ws://gateway.local/runtime',
          auth: {
            token: () => 'gateway-secret',
          },
        },
      },
      {
        createSocket: () => socket,
      }
    );

    socket.open();
    await Promise.resolve();
    await Promise.resolve();

    expect(socket.sentFrames[0]).toEqual({
      type: 'hello',
      clientVersion: 'actor-web-source',
      auth: {
        scheme: 'token',
        token: 'gateway-secret',
      },
    });
  });

  it('merges address-based source params into the gateway scope', () => {
    const socket = new FakeGatewaySocket();
    createActorWebSource(
      {
        address: 'actor://server-node/actor/vehicle-inspections',
        gateway: {
          url: 'ws://gateway.local/runtime',
          scope: {
            params: {
              tenantId: 'acme',
              vehicleId: 'truck-17',
            },
          },
        },
      },
      {
        createSocket: () => socket,
        streamId: 'vehicle-inspections-stream',
      }
    );

    socket.open();
    socket.receive({
      type: 'ready',
      connectionId: 'connection-1',
      heartbeatMs: 15000,
      serverTime: '2026-04-25T18:00:00.000Z',
    });

    expect(socket.sentFrames).toContainEqual({
      type: 'subscribe',
      streamId: 'vehicle-inspections-stream',
      scope: {
        kind: 'vehicle-inspections',
        params: {
          tenantId: 'acme',
          vehicleId: 'truck-17',
        },
      },
    });
  });

  it('defaults address-based source scope kind from the actor id', () => {
    const socket = new FakeGatewaySocket();
    createActorWebSource(
      {
        address: 'actor://server-node/actor/vehicle-inspections',
        gateway: {
          url: 'ws://gateway.local/runtime',
        },
      },
      {
        createSocket: () => socket,
        streamId: 'vehicle-inspections-stream',
      }
    );

    socket.open();
    socket.receive({
      type: 'ready',
      connectionId: 'connection-1',
      heartbeatMs: 15000,
      serverTime: '2026-04-25T18:00:00.000Z',
    });

    expect(socket.sentFrames).toContainEqual({
      type: 'subscribe',
      streamId: 'vehicle-inspections-stream',
      scope: {
        kind: 'vehicle-inspections',
      },
    });
  });

  it('requests resync when gateway stream sequence gaps are detected', async () => {
    const socket = new FakeGatewaySocket();
    const source = createActorWebSource(
      {
        address: 'actor://server-node/actor/shipment',
        gateway: {
          url: 'ws://gateway.local/runtime',
          scope: { kind: 'shipment' },
        },
      },
      {
        createSocket: () => socket,
        streamId: 'shipment-stream',
      }
    );
    const statuses: string[] = [];
    source.subscribeTransportStatus((status) => {
      statuses.push(status.state);
    });

    socket.open();
    socket.receive({
      type: 'ready',
      connectionId: 'connection-1',
      heartbeatMs: 15000,
      serverTime: '2026-04-25T18:00:00.000Z',
    });
    socket.receive({
      type: 'snapshot',
      streamId: 'shipment-stream',
      sequence: 1,
      projection: {
        address: source.address,
        workflowSnapshot: {
          workflowId: 'shipment',
          actorId: 'shipment',
          taskId: 'shipment',
          taskTitle: 'Shipment',
          phase: 'created',
          status: 'running',
          createdAt: '2026-04-25T18:00:00.000Z',
          updatedAt: '2026-04-25T18:00:01.000Z',
          branchName: null,
          baseBranch: null,
          correlationId: 'shipment',
          lastEventType: null,
          notes: [],
          artifacts: {},
        },
        value: 'created',
        context: { shipmentId: 'shipment-1', status: 'created' },
      },
    });
    socket.receive({
      type: 'event',
      streamId: 'shipment-stream',
      sequence: 3,
      projection: {
        address: source.address,
        envelope: {
          id: 'event-2',
          kind: 'fact',
          type: 'SHIPMENT_UPDATED',
          schemaVersion: 1,
          occurredAt: '2026-04-25T18:00:02.000Z',
          sourceActor: source.address.path,
          payload: {},
        },
      },
    });

    expect(socket.sentFrames).toContainEqual({
      type: 'resync',
      streamId: 'shipment-stream',
      fromSequence: 2,
    });
    expect(statuses).toContain('degraded');

    socket.receive({
      type: 'status',
      streamId: 'shipment-stream',
      status: {
        state: 'replaying',
        updatedAt: Date.parse('2026-04-25T18:00:02.000Z'),
      },
    });
    socket.receive({
      type: 'snapshot',
      streamId: 'shipment-stream',
      sequence: 4,
      projection: {
        address: source.address,
        workflowSnapshot: {
          workflowId: 'shipment',
          actorId: 'shipment',
          taskId: 'shipment',
          taskTitle: 'Shipment',
          phase: 'updated',
          status: 'running',
          createdAt: '2026-04-25T18:00:00.000Z',
          updatedAt: '2026-04-25T18:00:03.000Z',
          branchName: null,
          baseBranch: null,
          correlationId: 'shipment',
          lastEventType: 'SHIPMENT_UPDATED',
          notes: [],
          artifacts: {},
        },
        value: 'updated',
        context: { shipmentId: 'shipment-1', status: 'updated' },
      },
    });

    expect(source.snapshot().context).toEqual({
      shipmentId: 'shipment-1',
      status: 'updated',
    });

    source.close();
  });

  it('contains snapshot listener failures so later listeners still receive updates', () => {
    const socket = new FakeGatewaySocket();
    const source = createActorWebSource(
      {
        address: 'actor://server-node/actor/shipment',
        gateway: {
          url: 'ws://gateway.local/runtime',
          scope: { kind: 'shipment' },
        },
      },
      {
        createSocket: () => socket,
        streamId: 'shipment-stream',
      }
    );
    const snapshots: unknown[] = [];

    source.subscribe(() => {
      throw new Error('snapshot listener failed');
    });
    source.subscribe((snapshot) => {
      snapshots.push(snapshot.context);
    });

    socket.open();
    socket.receive({
      type: 'ready',
      connectionId: 'connection-1',
      heartbeatMs: 15000,
      serverTime: '2026-04-25T18:00:00.000Z',
    });
    socket.receive({
      type: 'snapshot',
      streamId: 'shipment-stream',
      sequence: 1,
      projection: {
        address: source.address,
        workflowSnapshot: {
          workflowId: 'shipment',
          actorId: 'shipment',
          taskId: 'shipment',
          taskTitle: 'Shipment',
          phase: 'created',
          status: 'running',
          createdAt: '2026-04-25T18:00:00.000Z',
          updatedAt: '2026-04-25T18:00:01.000Z',
          branchName: null,
          baseBranch: null,
          correlationId: 'shipment',
          lastEventType: null,
          notes: [],
          artifacts: {},
        },
        value: 'created',
        context: {
          shipmentId: 'shipment-1',
          status: 'created',
        },
      },
    });

    expect(snapshots).toContainEqual({ shipmentId: 'shipment-1', status: 'created' });

    source.close();
  });

  it('contains event listener failures so later listeners still receive updates', () => {
    const socket = new FakeGatewaySocket();
    const source = createActorWebSource(
      {
        address: 'actor://server-node/actor/shipment',
        gateway: {
          url: 'ws://gateway.local/runtime',
          scope: { kind: 'shipment' },
        },
      },
      {
        createSocket: () => socket,
        streamId: 'shipment-stream',
      }
    );
    const events: unknown[] = [];

    source.subscribeEvent(() => {
      throw new Error('event listener failed');
    });
    source.subscribeEvent((event) => {
      events.push(event);
    });

    socket.open();
    socket.receive({
      type: 'ready',
      connectionId: 'connection-1',
      heartbeatMs: 15000,
      serverTime: '2026-04-25T18:00:00.000Z',
    });
    socket.receive({
      type: 'snapshot',
      streamId: 'shipment-stream',
      sequence: 1,
      projection: {
        address: source.address,
        workflowSnapshot: {
          workflowId: 'shipment',
          actorId: 'shipment',
          taskId: 'shipment',
          taskTitle: 'Shipment',
          phase: 'created',
          status: 'running',
          createdAt: '2026-04-25T18:00:00.000Z',
          updatedAt: '2026-04-25T18:00:01.000Z',
          branchName: null,
          baseBranch: null,
          correlationId: 'shipment',
          lastEventType: null,
          notes: [],
          artifacts: {},
        },
        value: 'created',
        context: {
          shipmentId: 'shipment-1',
          status: 'created',
        },
      },
    });
    socket.receive({
      type: 'event',
      streamId: 'shipment-stream',
      sequence: 2,
      projection: {
        address: source.address,
        envelope: {
          id: 'event-1',
          kind: 'fact',
          type: 'SHIPMENT_CREATED',
          schemaVersion: 1,
          occurredAt: '2026-04-25T18:00:01.000Z',
          sourceActor: source.address.path,
          payload: {
            shipmentId: 'shipment-1',
          },
        },
      },
    });

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'SHIPMENT_CREATED', shipmentId: 'shipment-1' })
    );

    source.close();
  });

  it('contains transport status listener failures so later listeners still receive updates', () => {
    const socket = new FakeGatewaySocket();
    const source = createActorWebCommandSource(
      {
        address: 'actor://server-node/actor/shipment',
        gateway: {
          url: 'ws://gateway.local/runtime',
          scope: { kind: 'shipment' },
        },
      },
      {
        createSocket: () => socket,
        streamId: 'shipment-command',
      }
    );
    const statuses: string[] = [];

    source.subscribeTransportStatus(() => {
      throw new Error('status listener failed');
    });
    source.subscribeTransportStatus((status) => {
      statuses.push(status.state);
    });

    socket.open();
    socket.receive({
      type: 'ready',
      connectionId: 'command-connection',
      heartbeatMs: 15000,
      serverTime: '2026-04-25T18:00:00.000Z',
    });
    socket.receive({
      type: 'status',
      streamId: 'shipment-command',
      status: {
        state: 'connected',
        updatedAt: Date.parse('2026-04-25T18:00:01.000Z'),
      },
    });

    expect(statuses).toContain('connected');

    source.close();
  });

  it('correlates concurrent sends by request id and falls back for legacy ack/error frames', async () => {
    const socket = new FakeGatewaySocket();
    const source = createActorWebCommandSource(
      {
        address: 'actor://server-node/actor/shipment',
        gateway: {
          url: 'ws://gateway.local/runtime',
          scope: { kind: 'shipment' },
        },
      },
      {
        createSocket: () => socket,
        streamId: 'shipment-command',
      }
    );

    socket.open();
    socket.receive({
      type: 'ready',
      connectionId: 'command-connection',
      heartbeatMs: 15000,
      serverTime: '2026-04-25T18:00:00.000Z',
    });
    socket.receive({
      type: 'status',
      streamId: 'shipment-command',
      status: {
        state: 'connected',
        updatedAt: Date.parse('2026-04-25T18:00:01.000Z'),
      },
    });

    let firstResolved = false;
    const firstSend = source.send({ type: 'FIRST' }).then(() => {
      firstResolved = true;
    });
    const secondSend = source.send({ type: 'SECOND' });
    await Promise.resolve();

    const sendFrames = socket.sentFrames.filter(
      (frame): frame is Extract<RuntimeGatewayClientFrame, { type: 'send' }> =>
        frame.type === 'send'
    );
    expect(sendFrames).toHaveLength(2);

    socket.receive({
      type: 'ack',
      streamId: 'shipment-command',
      requestId: sendFrames[1]?.requestId,
    });
    await secondSend;

    expect(firstResolved).toBe(false);

    socket.receive({
      type: 'ack',
      streamId: 'shipment-command',
    });
    await firstSend;
    await secondSend;

    expect(firstResolved).toBe(true);

    const legacyError = source.send({ type: 'LEGACY_ERROR' }).then(
      () => 'resolved',
      (error: Error) => error.message
    );
    const targetedError = source.send({ type: 'TARGETED_ERROR' }).then(
      () => 'resolved',
      (error: Error) => error.message
    );
    await Promise.resolve();

    const nextSendFrames = socket.sentFrames.filter(
      (frame): frame is Extract<RuntimeGatewayClientFrame, { type: 'send' }> =>
        frame.type === 'send'
    );
    const legacyFrame = nextSendFrames[2];
    const targetedFrame = nextSendFrames[3];
    if (!legacyFrame || !targetedFrame) {
      throw new Error('Expected correlated send frames');
    }

    socket.receive({
      type: 'error',
      streamId: 'shipment-command',
      code: 'internal_error',
      message: 'legacy send failed',
      recoverable: false,
    });
    socket.receive({
      type: 'error',
      streamId: 'shipment-command',
      requestId: targetedFrame.requestId,
      code: 'internal_error',
      message: 'targeted send failed',
      recoverable: false,
    });

    await expect(legacyError).resolves.toBe('legacy send failed');
    await expect(targetedError).resolves.toBe('targeted send failed');

    source.close();
  });
});
