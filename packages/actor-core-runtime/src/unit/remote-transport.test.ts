import { afterEach, describe, expect, it } from 'vitest';
import { setup } from 'xstate';
import type { ActorAddress, ActorMessage } from '../actor-system.js';
import { ActorSystemImpl } from '../actor-system-impl.js';
import { createActorSource } from '../integration/actor-source.js';
import { createRuntimeNodeIdentity } from '../runtime-transport-contract.js';
import {
  createInMemoryMessageTransportNetwork,
  type InMemoryTransportFrame,
} from '../testing/in-memory-message-transport.js';
import { defineBehavior } from '../unified-actor-builder.js';

type CheckoutMessage =
  | { type: 'SUBMIT'; orderId: string }
  | { type: 'RESET' }
  | { type: 'GET_COUNT' };

type CheckoutEvent = { type: 'CHECKOUT_SUBMITTED'; orderId: string } | { type: 'CHECKOUT_RESET' };

interface CheckoutContext {
  submittedOrders: string[];
  lastSubmittedOrderId: string | null;
}

const checkoutMachine = setup({
  types: {
    context: {} as CheckoutContext,
    events: {} as CheckoutMessage,
    emitted: {} as CheckoutEvent,
  },
}).createMachine({
  id: 'transport-checkout',
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
        },
      },
    },
    submitted: {
      on: {
        SUBMIT: {
          target: 'submitted',
        },
        RESET: {
          target: 'ready',
        },
      },
    },
  },
});

function createCheckoutBehavior() {
  return defineBehavior<CheckoutMessage>()
    .withMachine(checkoutMachine)
    .onMessage(({ actor, message }) => {
      const context = actor.getSnapshot().context as CheckoutContext;

      if (message.type === 'GET_COUNT') {
        return {
          reply: context.submittedOrders.length,
        };
      }

      if (message.type === 'SUBMIT') {
        return {
          context: {
            submittedOrders: [...context.submittedOrders, message.orderId],
            lastSubmittedOrderId: message.orderId,
          },
          emit: [{ type: 'CHECKOUT_SUBMITTED', orderId: message.orderId }],
        };
      }

      return {
        context: {
          submittedOrders: [],
          lastSubmittedOrderId: null,
        },
        emit: [{ type: 'CHECKOUT_RESET' }],
      };
    })
    .build();
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }

    await nextTick();
  }

  throw new Error(message);
}

describe('remote runtime transport', () => {
  let localSystem: ActorSystemImpl | undefined;
  let remoteSystem: ActorSystemImpl | undefined;

  afterEach(async () => {
    await Promise.allSettled([localSystem?.stop(), remoteSystem?.stop()]);
    localSystem = undefined;
    remoteSystem = undefined;
  });

  it('supports late-connect directory sync and remote actor parity over transport', async () => {
    const network = createInMemoryMessageTransportNetwork();
    localSystem = new ActorSystemImpl({
      nodeAddress: 'node-a',
      transport: network.createTransport('node-a'),
    });
    remoteSystem = new ActorSystemImpl({
      nodeAddress: 'node-b',
      transport: network.createTransport('node-b'),
    });
    await Promise.all([localSystem.start(), remoteSystem.start()]);

    const remoteActor = await remoteSystem.spawn(createCheckoutBehavior(), {
      id: 'remote-checkout',
    });

    await localSystem.join(['node-b']);

    const remoteRef = await localSystem.lookup<CheckoutContext, CheckoutMessage>(
      remoteActor.address
    );
    expect(remoteRef).toBeDefined();
    if (!remoteRef) {
      throw new Error('Expected remote ref after directory sync');
    }

    const source = createActorSource<CheckoutContext, CheckoutMessage, CheckoutEvent>(remoteRef);
    const snapshots: Array<{ phase: string; count: number; status: string }> = [];
    const events: string[] = [];
    const statuses: string[] = [];
    const unsubscribeSnapshot = source.subscribe((snapshot) => {
      snapshots.push({
        phase: snapshot.phase,
        count: snapshot.context.submittedOrders.length,
        status: snapshot.status,
      });
    });
    const unsubscribeEvent = source.subscribeEvent((event) => {
      events.push(`${event.type}:${'orderId' in event ? event.orderId : 'reset'}`);
    });
    const unsubscribeStatus = source.subscribeTransportStatus((status) => {
      statuses.push(status.state);
    });

    await source.send({ type: 'SUBMIT', orderId: 'order-1' });
    await remoteSystem.flush();
    await localSystem.flush();

    const count = await source.ask<number>({ type: 'GET_COUNT' });
    const stats = await remoteRef.getStats();
    await remoteRef.stop();
    await remoteSystem.flush();
    await localSystem.flush();

    unsubscribeStatus();
    unsubscribeEvent();
    unsubscribeSnapshot();

    expect(count).toBe(1);
    expect(stats.messagesProcessed).toBeGreaterThan(0);
    expect(source.snapshot().status).toBe('stopped');
    expect(source.transportStatus().state).toBe('connected');
    expect(statuses).toContain('connected');
    expect(snapshots).toEqual([
      { phase: 'active', count: 0, status: 'running' },
      { phase: 'active', count: 1, status: 'running' },
      { phase: 'active', count: 1, status: 'running' },
      { phase: 'active', count: 1, status: 'stopped' },
    ]);
    expect(events).toEqual(['CHECKOUT_SUBMITTED:order-1']);
  });

  it('supports remote actor parity over handshake-backed in-memory transport', async () => {
    const network = createInMemoryMessageTransportNetwork();
    localSystem = new ActorSystemImpl({
      nodeAddress: 'node-a',
      transport: network.createTransport('node-a', {
        handshake: true,
        identity: createRuntimeNodeIdentity({
          nodeAddress: 'node-a',
          nodeId: 'node-a-id',
          incarnation: 'boot-a',
        }),
      }),
    });
    remoteSystem = new ActorSystemImpl({
      nodeAddress: 'node-b',
      transport: network.createTransport('node-b', {
        handshake: true,
        identity: createRuntimeNodeIdentity({
          nodeAddress: 'node-b',
          nodeId: 'node-b-id',
          incarnation: 'boot-b',
        }),
      }),
    });
    await Promise.all([localSystem.start(), remoteSystem.start()]);

    const remoteActor = await remoteSystem.spawn(createCheckoutBehavior(), {
      id: 'handshake-checkout',
    });

    await localSystem.join(['node-b']);

    const remoteRef = await localSystem.lookup<CheckoutContext, CheckoutMessage>(
      remoteActor.address
    );
    if (!remoteRef) {
      throw new Error('Expected remote ref after handshake-backed directory sync');
    }

    await remoteRef.send({ type: 'SUBMIT', orderId: 'order-handshake' });
    await remoteSystem.flush();
    await localSystem.flush();

    await expect(remoteRef.ask<number>({ type: 'GET_COUNT' })).resolves.toBe(1);
  });

  it('reports disconnected, replaying, and connected during transport reconnect', async () => {
    const network = createInMemoryMessageTransportNetwork();
    const localTransport = network.createTransport('node-a');
    const remoteTransport = network.createTransport('node-b');
    localSystem = new ActorSystemImpl({
      nodeAddress: 'node-a',
      transport: localTransport,
    });
    remoteSystem = new ActorSystemImpl({
      nodeAddress: 'node-b',
      transport: remoteTransport,
    });
    await Promise.all([localSystem.start(), remoteSystem.start()]);

    const remoteActor = await remoteSystem.spawn(createCheckoutBehavior(), {
      id: 'reconnect-checkout',
    });

    await localSystem.join(['node-b']);

    const remoteRef = await localSystem.lookup<CheckoutContext, CheckoutMessage>(
      remoteActor.address
    );
    if (!remoteRef) {
      throw new Error('Expected remote ref for reconnect test');
    }

    const source = createActorSource<CheckoutContext, CheckoutMessage, CheckoutEvent>(remoteRef);
    const statuses: string[] = [];
    const events: string[] = [];
    const unsubscribeStatus = source.subscribeTransportStatus((status) => {
      statuses.push(status.state);
    });
    const unsubscribeEvent = source.subscribeEvent((event) => {
      events.push(event.type);
    });
    const unsubscribeSnapshot = source.subscribe(() => {});

    await source.send({ type: 'SUBMIT', orderId: 'order-2' });
    await remoteSystem.flush();
    await localSystem.flush();

    await localTransport.disconnect('node-b');
    await waitFor(
      () => source.transportStatus().state === 'disconnected',
      'Expected disconnected transport state'
    );

    await localTransport.connect('node-b');
    await waitFor(
      () => source.transportStatus().state === 'connected',
      'Expected reconnected transport state'
    );

    unsubscribeSnapshot();
    unsubscribeEvent();
    unsubscribeStatus();

    expect(statuses).toContain('disconnected');
    expect(statuses).toContain('replaying');
    expect(statuses[statuses.length - 1]).toBe('connected');
    expect(events).toEqual(['CHECKOUT_SUBMITTED']);
  });

  it('marks the remote projection degraded when sequence gaps are detected', async () => {
    const network = createInMemoryMessageTransportNetwork();
    localSystem = new ActorSystemImpl({
      nodeAddress: 'node-a',
      transport: network.createTransport('node-a'),
    });
    remoteSystem = new ActorSystemImpl({
      nodeAddress: 'node-b',
      transport: network.createTransport('node-b'),
    });
    await Promise.all([localSystem.start(), remoteSystem.start()]);

    const remoteActor = await remoteSystem.spawn(createCheckoutBehavior(), {
      id: 'gap-checkout',
    });

    await localSystem.join(['node-b']);

    const remoteRef = await localSystem.lookup<CheckoutContext, CheckoutMessage>(
      remoteActor.address
    );
    if (!remoteRef) {
      throw new Error('Expected remote ref for gap test');
    }

    const source = createActorSource<CheckoutContext, CheckoutMessage, CheckoutEvent>(remoteRef);
    const statuses: string[] = [];
    const unsubscribeStatus = source.subscribeTransportStatus((status) => {
      statuses.push(status.state);
    });
    const unsubscribeSnapshot = source.subscribe(() => {});

    network.dropNextMessage((frame: InMemoryTransportFrame) => {
      return (
        frame.destination === 'node-a' && frame.message.type === '__runtime.remote.snapshot.update'
      );
    });

    await source.send({ type: 'SUBMIT', orderId: 'order-gap-1' });
    await remoteSystem.flush();
    await localSystem.flush();

    await source.send({ type: 'SUBMIT', orderId: 'order-gap-2' });
    await remoteSystem.flush();
    await localSystem.flush();

    unsubscribeSnapshot();
    unsubscribeStatus();

    expect(source.transportStatus().state).toBe('degraded');
    expect(statuses).toContain('degraded');
  });

  it('contains runtime protocol failures when the error reply cannot be delivered', async () => {
    const network = createInMemoryMessageTransportNetwork();
    const remoteTransport = network.createTransport('node-b');
    remoteSystem = new ActorSystemImpl({
      nodeAddress: 'node-b',
      transport: remoteTransport,
    });
    await remoteSystem.start();

    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      // A peer that never completed a connection asks for an actor that does
      // not exist: the ask fails AND the error reply cannot be sent back, so
      // both legs of the handler reject. Neither may escape the subscription.
      const deliver = (
        remoteTransport as unknown as {
          deliver(event: { source: string; message: ActorMessage }): void;
        }
      ).deliver.bind(remoteTransport);

      deliver({
        source: 'node-ghost',
        message: {
          type: '__runtime.remote.ask.request',
          requestId: 'ghost-req-1',
          // The wire address IS the branded path string under the opaque model.
          address: 'actor://node-b/missing-actor',
          message: { type: 'PING', _timestamp: Date.now(), _version: '1.0.0' },
          timeout: 50,
          _timestamp: Date.now(),
          _version: '1.0.0',
        } as unknown as ActorMessage,
      });

      await new Promise((resolve) => {
        setTimeout(resolve, 300);
      });

      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('rejects remote delivery attempts for node-private local addresses', async () => {
    const network = createInMemoryMessageTransportNetwork();
    const localTransport = network.createTransport('node-a');
    network.createTransport('node-b');
    localSystem = new ActorSystemImpl({
      nodeAddress: 'node-a',
      transport: localTransport,
    });

    const sent: Array<{ destination: string; message: ActorMessage }> = [];
    const realSend = localTransport.send.bind(localTransport);
    localTransport.send = async (destination: string, message: ActorMessage) => {
      sent.push({ destination, message });
      return realSend(destination, message);
    };

    await localSystem.start();
    await localTransport.connect('node-b');

    const deliverRemote = (
      localSystem as unknown as {
        deliverMessageRemote(
          location: string,
          address: ActorAddress,
          message: ActorMessage
        ): Promise<void>;
      }
    ).deliverMessageRemote.bind(localSystem);

    await expect(
      deliverRemote(
        'node-b',
        'actor://local/remote-shadow' as ActorAddress,
        {
          type: 'PING',
          _timestamp: Date.now(),
          _version: '1.0.0',
        } as ActorMessage
      )
    ).rejects.toThrow(/node-private local address/i);

    expect(sent.filter((frame) => frame.message.type === '__runtime.remote.send')).toHaveLength(0);
  });

  it('uses a configured next-hop router before sending remote delivery frames', async () => {
    const network = createInMemoryMessageTransportNetwork();
    const localTransport = network.createTransport('node-a');
    network.createTransport('node-b');
    network.createTransport('node-relay');
    const routerCalls: Array<{
      location: string;
      address: ActorAddress;
      connectedNodes: readonly string[];
    }> = [];
    localSystem = new ActorSystemImpl({
      nodeAddress: 'node-a',
      transport: localTransport,
      router: {
        resolveNextHop: async (location, address, connectedNodes) => {
          routerCalls.push({ location, address, connectedNodes });
          return 'node-relay';
        },
      },
    });

    const sent: Array<{ destination: string; message: ActorMessage }> = [];
    const realSend = localTransport.send.bind(localTransport);
    localTransport.send = async (destination: string, message: ActorMessage) => {
      sent.push({ destination, message });
      return realSend(destination, message);
    };

    await localSystem.start();
    await localTransport.connect('node-relay');

    const deliverRemote = (
      localSystem as unknown as {
        deliverMessageRemote(
          location: string,
          address: ActorAddress,
          message: ActorMessage
        ): Promise<void>;
      }
    ).deliverMessageRemote.bind(localSystem);

    const targetAddress = 'actor://node-b/mesh-target' as ActorAddress;
    await deliverRemote('node-b', targetAddress, {
      type: 'PING',
      _timestamp: Date.now(),
      _version: '1.0.0',
    } as ActorMessage);

    expect(routerCalls).toEqual([
      {
        location: 'node-b',
        address: targetAddress,
        connectedNodes: ['node-relay'],
      },
    ]);
    const remoteSendFrames = sent.filter((frame) => frame.message.type === '__runtime.remote.send');
    expect(remoteSendFrames).toHaveLength(1);
    expect(remoteSendFrames[0]).toMatchObject({
      destination: 'node-relay',
      message: { address: targetAddress },
    });
  });

  it('does not broadcast a directory unregister for node-private (local) addresses', async () => {
    const network = createInMemoryMessageTransportNetwork();
    const localTransport = network.createTransport('node-a');
    network.createTransport('node-b');
    localSystem = new ActorSystemImpl({
      nodeAddress: 'node-a',
      transport: localTransport,
    });

    // Capture every outbound transport frame so we can assert exactly which
    // directory unregisters cross the wire.
    const sent: Array<{ destination: string; message: ActorMessage }> = [];
    const realSend = localTransport.send.bind(localTransport);
    localTransport.send = async (destination: string, message: ActorMessage) => {
      sent.push({ destination, message });
      return realSend(destination, message);
    };

    await localSystem.start();
    await localTransport.connect('node-b');

    const broadcastUnregister = (
      localSystem as unknown as {
        broadcastDirectoryUnregister(address: ActorAddress): Promise<void>;
      }
    ).broadcastDirectoryUnregister.bind(localSystem);

    // A `local`-node address (e.g. the guardian) is non-unique across nodes;
    // unregistering it on a peer would delete that peer's OWN local entry.
    await broadcastUnregister('actor://local/system/guardian' as ActorAddress);
    expect(
      sent.filter((frame) => frame.message.type === '__runtime.directory.unregister')
    ).toHaveLength(0);

    // A concretely-addressed remote actor must still be unregistered so peers
    // drop the stale routing entry — the guard discriminates, not suppresses.
    await broadcastUnregister('actor://node-a/remote-checkout' as ActorAddress);
    const unregisterFrames = sent.filter(
      (frame) => frame.message.type === '__runtime.directory.unregister'
    );
    expect(unregisterFrames).toHaveLength(1);
    expect(unregisterFrames[0].destination).toBe('node-b');
    expect((unregisterFrames[0].message as unknown as { address: string }).address).toBe(
      'actor://node-a/remote-checkout'
    );
  });
});
