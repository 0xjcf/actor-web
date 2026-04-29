import { describe, expect, it } from 'vitest';
import { type ActorWebGatewaySocket, createActorWebSource } from '../actor-web-source.js';
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

    expect(socket.sentFrames).toEqual([
      { type: 'hello', clientVersion: 'actor-web-source' },
      { type: 'subscribe', streamId: 'shipment-stream', scope: { kind: 'shipment' } },
      { type: 'send', streamId: 'shipment-stream', message: { type: 'RESET' } },
      {
        type: 'ask',
        streamId: 'shipment-stream',
        requestId: askFrame.requestId,
        message: { type: 'GET_COUNT' },
      },
    ]);
    expect(source.snapshot().context).toEqual({ shipmentId: 'shipment-1', status: 'created' });
    expect(snapshots).toContainEqual({ shipmentId: 'shipment-1', status: 'created' });
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'SHIPMENT_CREATED', shipmentId: 'shipment-1' })
    );
    expect(statuses).toContain('connected');

    source.close();
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
});
