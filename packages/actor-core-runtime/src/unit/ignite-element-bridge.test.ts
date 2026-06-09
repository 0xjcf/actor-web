import { describe, expect, it } from 'vitest';
import { assign, setup } from 'xstate';
import type { ActorInstance } from '../actor-instance.js';
import { type ActorRef, createTypedActorRef } from '../actor-ref.js';
import type { ActorMessage } from '../actor-system.js';
import { ActorSystemImpl } from '../actor-system-impl.js';
import { createActorRef } from '../create-actor-ref.js';
import {
  actorSnapshotToIgniteSourceSnapshot,
  createIgniteActorSource,
  createIgniteCommandSource,
  createIgniteReadModelSource,
} from '../integration/ignite-element-bridge.js';
import { createRuntimeGatewaySourceHandle } from '../runtime-gateway.js';
import { createInMemoryMessageTransportNetwork } from '../testing/in-memory-message-transport.js';
import type { ActorSnapshot } from '../types.js';
import { defineBehavior } from '../unified-actor-builder.js';

type CounterMessage = ActorMessage<{ type: 'INCREMENT' } | { type: 'RESET' }>;
type CheckoutMessage = ActorMessage<{ type: 'SUBMIT'; orderId: string } | { type: 'GET_COUNT' }>;
type CheckoutEvent = ActorMessage<{ type: 'CHECKOUT_SUBMITTED'; orderId: string }>;

const counterMachine = setup({
  types: {
    context: {} as { count: number },
    events: {} as CounterMessage,
  },
}).createMachine({
  id: 'counter',
  initial: 'active',
  context: { count: 0 },
  states: {
    active: {
      on: {
        INCREMENT: {
          actions: assign({
            count: ({ context }) => context.count + 1,
          }),
        },
        RESET: {
          actions: assign({
            count: 0,
          }),
        },
      },
    },
  },
});

function createSnapshot<TContext>(
  value: unknown,
  context: TContext,
  status: ActorSnapshot<TContext>['status'] = 'running'
): ActorSnapshot<TContext> {
  return {
    context,
    value,
    status,
    matches: (state: string) => state === value,
    can: () => true,
    hasTag: () => false,
    toJSON: () => ({ value, context, status }),
  };
}

describe('ignite-element bridge', () => {
  it('projects Actor-Web snapshots into host-ready snapshots with address and phase', () => {
    const address = {
      id: 'checkout',
      type: 'unified',
      path: '/actors/checkout',
    };

    const projection = actorSnapshotToIgniteSourceSnapshot(
      address,
      createSnapshot('active', { count: 1 })
    );

    expect(projection.address).toEqual(address);
    expect(projection.phase).toBe('active');
    expect(projection.context).toEqual({ count: 1 });
    expect(projection.toJSON()).toEqual({
      value: 'active',
      context: { count: 1 },
      status: 'running',
      address,
      phase: 'active',
    });
  });

  it('reports local transport state for typed actor refs without a remote hop', () => {
    const ref = createTypedActorRef(
      {
        status: 'running',
        getSnapshot: () => createSnapshot('active', { count: 1 }),
        send: () => {},
        ask: async () => 1,
        stop: async () => {},
      } as unknown as ActorInstance,
      {
        id: 'typed-counter',
        type: 'actor',
        path: '/actors/typed-counter',
      }
    );

    const observedStates: string[] = [];
    const unsubscribe = ref.subscribeTransportStatus?.((status) => {
      observedStates.push(status.state);
    });

    expect(ref.getTransportStatus?.().state).toBe('local');
    expect(observedStates).toEqual(['local']);

    unsubscribe?.();
  });

  it('creates an actor source with current snapshots and live updates for createActorRef refs', async () => {
    const actor = createActorRef<{ count: number }, CounterMessage>(counterMachine, {
      id: 'checkout',
    }) as ActorRef<{ count: number }, CounterMessage> & { start(): void };

    actor.start();

    const source = createIgniteActorSource(actor);
    const snapshots: Array<{ count: number; phase: string }> = [];
    const unsubscribe = source.subscribe((snapshot) => {
      snapshots.push({
        count: snapshot.context.count,
        phase: snapshot.phase,
      });
    });

    await source.send({ type: 'INCREMENT' });
    unsubscribe();
    await actor.stop();

    expect(source.address.id).toBe('checkout');
    expect(source.snapshot().context.count).toBe(1);
    expect(source.transportStatus().state).toBe('local');
    expect(snapshots).toEqual([
      { count: 0, phase: 'active' },
      { count: 1, phase: 'active' },
    ]);
  });

  it('exposes a read-model bridge by default and requires an explicit command helper', async () => {
    const actor = createActorRef<{ count: number }, CounterMessage>(counterMachine, {
      id: 'checkout-read-model',
    }) as ActorRef<{ count: number }, CounterMessage> & { start(): void };

    actor.start();

    const source = createIgniteReadModelSource(actor);
    const commandSource = createIgniteCommandSource(actor);

    expect('send' in source).toBe(false);
    expect('ask' in source).toBe(false);

    await commandSource.send({ type: 'INCREMENT' });
    await actor.stop();

    expect(source.snapshot().context.count).toBe(1);
  });

  it('packages projection reads and command access into one Ignite source handle', async () => {
    const actor = createActorRef<{ count: number }, CounterMessage>(counterMachine, {
      id: 'checkout-source-handle',
    }) as ActorRef<{ count: number }, CounterMessage> & { start(): void };

    actor.start();

    const sourceHandle = createRuntimeGatewaySourceHandle(
      createIgniteReadModelSource(actor),
      createIgniteCommandSource(actor)
    );

    expect('send' in sourceHandle.source).toBe(false);
    expect(typeof sourceHandle.commandSource.send).toBe('function');

    await sourceHandle.commandSource.send({ type: 'INCREMENT' });
    await actor.stop();
    await sourceHandle.stop();

    expect(sourceHandle.source.snapshot().context.count).toBe(1);
  });

  it('creates an actor source for system.spawn refs with live and stopped snapshots', async () => {
    const system = new ActorSystemImpl({ nodeAddress: 'test-node' });
    await system.start();

    try {
      const behavior = defineBehavior<CounterMessage>()
        .withMachine(counterMachine)
        .onMessage(({ message, actor }) => {
          const snapshot = actor.getSnapshot();
          const currentCount = (snapshot.context as { count?: number }).count ?? 0;

          if (message.type === 'INCREMENT') {
            return {
              context: { count: currentCount + 1 },
            };
          }

          if (message.type === 'RESET') {
            return {
              context: { count: 0 },
            };
          }

          return {};
        })
        .build();

      const actor = (await system.spawn(behavior, {
        id: 'checkout-system',
      })) as ActorRef<{ count: number }, CounterMessage>;
      const source = createIgniteActorSource(actor);
      const snapshots: Array<{ count: number; phase: string; status: string }> = [];
      const unsubscribe = source.subscribe((snapshot) => {
        snapshots.push({
          count: snapshot.context.count,
          phase: snapshot.phase,
          status: snapshot.status,
        });
      });

      await source.send({ type: 'INCREMENT' });
      await system.flush();
      await actor.stop();
      unsubscribe();

      expect(source.address.id).toBe('checkout-system');
      expect(source.snapshot().context.count).toBe(1);
      expect(source.snapshot().status).toBe('stopped');
      expect(source.transportStatus().state).toBe('local');
      expect(snapshots).toEqual([
        { count: 0, phase: 'active', status: 'running' },
        { count: 1, phase: 'active', status: 'running' },
        { count: 1, phase: 'active', status: 'stopped' },
      ]);
    } finally {
      await system.stop();
    }
  });

  it('supports explicit remote snapshot and event transport for foreign sources', async () => {
    let remoteSnapshot = createSnapshot('active', { count: 2 });
    const snapshotListeners = new Set<(snapshot: ActorSnapshot<{ count: number }>) => void>();
    const eventListeners = new Set<(event: CheckoutEvent) => void>();

    const remoteActor = {
      address: {
        id: 'checkout-remote',
        type: 'actor',
        path: 'actor://remote-node/actor/checkout-remote',
      },
      getSnapshot: () => createSnapshot(undefined, { count: -1 }),
      send: async () => {},
      ask: async () => ({ ok: true }),
      stop: async () => {},
      isAlive: async () => true,
      getStats: async () => ({
        messagesReceived: 0,
        messagesProcessed: 0,
        errors: 0,
        uptime: 0,
      }),
    } as ActorRef<{ count: number }, CounterMessage>;

    const source = createIgniteActorSource<{ count: number }, CounterMessage, CheckoutEvent>(
      remoteActor,
      {
        getSnapshot: () => remoteSnapshot,
        subscribeSnapshot: (listener) => {
          snapshotListeners.add(listener);
          return () => {
            snapshotListeners.delete(listener);
          };
        },
        subscribeEvent: (listener, options = {}) => {
          const filteredListener = (event: CheckoutEvent) => {
            if (options.types && options.types.length > 0 && !options.types.includes(event.type)) {
              return;
            }

            listener(event);
          };

          eventListeners.add(filteredListener);
          return () => {
            eventListeners.delete(filteredListener);
          };
        },
      }
    );

    const snapshots: number[] = [];
    const events: Array<{ type: string; orderId: string; addressId: string }> = [];
    const unsubscribeSnapshot = source.subscribe((snapshot) => {
      snapshots.push(snapshot.context.count);
    });
    const unsubscribeEvent = source.subscribeEvent(
      (event) => {
        events.push({
          type: event.type,
          orderId: event.orderId,
          addressId: event.address.id,
        });
      },
      { types: ['CHECKOUT_SUBMITTED'] }
    );

    remoteSnapshot = createSnapshot('active', { count: 3 });
    for (const listener of Array.from(snapshotListeners)) {
      listener(remoteSnapshot);
    }
    for (const listener of Array.from(eventListeners)) {
      listener({ type: 'CHECKOUT_SUBMITTED', orderId: 'remote-123' });
    }

    unsubscribeEvent();
    unsubscribeSnapshot();

    expect(source.snapshot().context.count).toBe(3);
    expect(source.transportStatus().state).toBe('local');
    expect(snapshots).toEqual([2, 3]);
    expect(events).toEqual([
      {
        type: 'CHECKOUT_SUBMITTED',
        orderId: 'remote-123',
        addressId: 'checkout-remote',
      },
    ]);
  });

  it('projects remote ActorSystem refs without manual snapshot or event overrides', async () => {
    const network = createInMemoryMessageTransportNetwork();
    const localSystem = new ActorSystemImpl({
      nodeAddress: 'node-a',
      transport: network.createTransport('node-a'),
    });
    const remoteSystem = new ActorSystemImpl({
      nodeAddress: 'node-b',
      transport: network.createTransport('node-b'),
    });
    await Promise.all([localSystem.start(), remoteSystem.start()]);

    try {
      const behavior = defineBehavior<CheckoutMessage>()
        .withContext({ submittedOrders: [] as string[] })
        .onMessage(({ message, actor }) => {
          const context = actor.getSnapshot().context as { submittedOrders: string[] };

          if (message.type === 'GET_COUNT') {
            return { reply: context.submittedOrders.length };
          }

          return {
            context: {
              submittedOrders: [...context.submittedOrders, message.orderId],
            },
            emit: [{ type: 'CHECKOUT_SUBMITTED', orderId: message.orderId }],
          };
        })
        .build();

      const spawnedRemoteActor = await remoteSystem.spawn(behavior, {
        id: 'remote-checkout',
      });
      await localSystem.join(['node-b']);
      const remoteRef = await localSystem.lookup<{ submittedOrders: string[] }, CheckoutMessage>(
        spawnedRemoteActor.address.path
      );

      expect(remoteRef).toBeDefined();
      if (!remoteRef) {
        throw new Error('Expected remote ref from distributed lookup');
      }

      const source = createIgniteActorSource<
        { submittedOrders: string[] },
        CheckoutMessage,
        CheckoutEvent
      >(remoteRef);
      const snapshots: Array<{ count: number; status: string }> = [];
      const events: string[] = [];
      const statuses: string[] = [];
      const unsubscribeSnapshot = source.subscribe((snapshot) => {
        snapshots.push({
          count: snapshot.context.submittedOrders.length,
          status: snapshot.status,
        });
      });
      const unsubscribeEvent = source.subscribeEvent((event) => {
        events.push(`${event.address.id}:${event.type}:${event.orderId}`);
      });
      const unsubscribeStatus = source.subscribeTransportStatus((status) => {
        statuses.push(status.state);
      });

      await source.send({ type: 'SUBMIT', orderId: 'remote-9000' });
      await remoteSystem.flush();
      await localSystem.flush();

      const count = await source.ask<number>({ type: 'GET_COUNT' });
      await remoteRef.stop();
      await remoteSystem.flush();
      await localSystem.flush();

      unsubscribeStatus();
      unsubscribeEvent();
      unsubscribeSnapshot();

      expect(count).toBe(1);
      expect(source.snapshot().status).toBe('stopped');
      expect(snapshots).toEqual([
        { count: 0, status: 'running' },
        { count: 1, status: 'running' },
        { count: 1, status: 'running' },
        { count: 1, status: 'stopped' },
      ]);
      expect(events).toEqual(['remote-checkout:CHECKOUT_SUBMITTED:remote-9000']);
      expect(statuses).toContain('connected');
    } finally {
      await Promise.all([localSystem.stop(), remoteSystem.stop()]);
    }
  });

  it('feeds a headless host from spawned actor snapshots and emitted events', async () => {
    const system = new ActorSystemImpl({ nodeAddress: 'test-node' });
    await system.start();

    try {
      const behavior = defineBehavior<CheckoutMessage>()
        .withContext({ submittedOrders: [] as string[] })
        .onMessage(({ message, actor }) => {
          const context = actor.getSnapshot().context as { submittedOrders: string[] };

          if (message.type === 'SUBMIT') {
            return {
              context: {
                submittedOrders: [...context.submittedOrders, message.orderId],
              },
              emit: [{ type: 'CHECKOUT_SUBMITTED', orderId: message.orderId }],
            };
          }

          return { context };
        })
        .build();

      const actor = (await system.spawn(behavior, {
        id: 'headless-checkout',
      })) as ActorRef<{ submittedOrders: string[] }, CheckoutMessage>;
      const source = createIgniteActorSource<
        { submittedOrders: string[] },
        CheckoutMessage,
        CheckoutEvent
      >(actor);
      const host = {
        phase: '',
        submittedOrders: [] as string[],
        eventLog: [] as string[],
      };

      const unsubscribeSnapshot = source.subscribe((snapshot) => {
        host.phase = snapshot.phase;
        host.submittedOrders = [...snapshot.context.submittedOrders];
      });
      const unsubscribeEvent = source.subscribeEvent(
        (event) => {
          host.eventLog.push(`${event.address.id}:${event.type}:${event.orderId}`);
        },
        { types: ['CHECKOUT_SUBMITTED'] }
      );

      await source.send({ type: 'SUBMIT', orderId: 'order-123' });
      await system.flush();

      unsubscribeEvent();
      unsubscribeSnapshot();

      expect(host).toEqual({
        phase: 'active',
        submittedOrders: ['order-123'],
        eventLog: ['headless-checkout:CHECKOUT_SUBMITTED:order-123'],
      });
    } finally {
      await system.stop();
    }
  });
});
