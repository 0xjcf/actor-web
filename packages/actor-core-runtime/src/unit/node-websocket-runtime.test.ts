import { afterEach, describe, expect, it } from 'vitest';
import { setup } from 'xstate';
import { ActorSystemImpl } from '../actor-system-impl.js';
import { createIgniteActorSource } from '../integration/ignite-element-bridge.js';
import {
  createNodeWebSocketMessageTransport,
  type NodeWebSocketMessageTransport,
} from '../node-websocket-message-transport.js';
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
  id: 'websocket-checkout',
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
        return { reply: context.submittedOrders.length };
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

async function nextTick(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) {
      return;
    }
    await nextTick();
  }

  throw new Error(message);
}

describe('Node WebSocket runtime transport', () => {
  let localSystem: ActorSystemImpl | undefined;
  let remoteSystem: ActorSystemImpl | undefined;
  let localTransport: NodeWebSocketMessageTransport | undefined;
  let remoteTransport: NodeWebSocketMessageTransport | undefined;

  afterEach(async () => {
    await Promise.allSettled([localSystem?.stop(), remoteSystem?.stop()]);
    await Promise.allSettled([localTransport?.stop(), remoteTransport?.stop()]);
    localSystem = undefined;
    remoteSystem = undefined;
    localTransport = undefined;
    remoteTransport = undefined;
  });

  it('supports directory sync, remote send/ask, and Ignite projections over localhost WebSockets', async () => {
    remoteTransport = createNodeWebSocketMessageTransport({
      nodeAddress: 'node-b',
      incarnation: 'node-b-boot',
      listen: { port: 0 },
    });
    await remoteTransport.start();
    const remoteUrl = remoteTransport.getListeningUrl();
    if (!remoteUrl) {
      throw new Error('Expected remote listening URL');
    }

    localTransport = createNodeWebSocketMessageTransport({
      nodeAddress: 'node-a',
      incarnation: 'node-a-boot',
      heartbeatIntervalMs: 0,
      listen: { port: 0 },
      peers: { 'node-b': remoteUrl },
    });
    await localTransport.start();

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
      id: 'websocket-checkout',
    });

    await localSystem.join(['node-b']);
    const remoteRef = await localSystem.lookup<CheckoutContext, CheckoutMessage>(
      remoteActor.address.path
    );
    if (!remoteRef) {
      throw new Error('Expected remote ref after WebSocket directory sync');
    }

    const source = createIgniteActorSource<CheckoutContext, CheckoutMessage, CheckoutEvent>(
      remoteRef
    );
    const snapshots: number[] = [];
    const events: string[] = [];
    const unsubscribeSnapshot = source.subscribe((snapshot) => {
      snapshots.push(snapshot.context.submittedOrders.length);
    });
    const unsubscribeEvent = source.subscribeEvent((event) => {
      events.push(event.type);
    });

    await source.send({ type: 'SUBMIT', orderId: 'order-ws' });
    await remoteSystem.flush();
    await localSystem.flush();

    await waitFor(() => snapshots.includes(1), 'Expected WebSocket snapshot update');
    await waitFor(() => events.includes('CHECKOUT_SUBMITTED'), 'Expected WebSocket event update');
    await expect(source.ask<number>({ type: 'GET_COUNT' })).resolves.toBe(1);

    unsubscribeEvent();
    unsubscribeSnapshot();
  });

  it('reconnects after a remote transport restart with a new incarnation', async () => {
    let remoteUrl = '';
    remoteTransport = createNodeWebSocketMessageTransport({
      nodeAddress: 'node-b',
      nodeId: 'stable-node-b',
      incarnation: 'node-b-boot-1',
      heartbeatIntervalMs: 0,
      listen: { port: 0 },
    });
    await remoteTransport.start();
    remoteUrl = remoteTransport.getListeningUrl() ?? '';
    if (!remoteUrl) {
      throw new Error('Expected remote listening URL');
    }

    localTransport = createNodeWebSocketMessageTransport({
      nodeAddress: 'node-a',
      incarnation: 'node-a-boot',
      heartbeatIntervalMs: 0,
      listen: { port: 0 },
      peerUrlResolver: (nodeAddress) => (nodeAddress === 'node-b' ? remoteUrl : undefined),
    });
    await localTransport.start();

    localSystem = new ActorSystemImpl({
      nodeAddress: 'node-a',
      transport: localTransport,
    });
    remoteSystem = new ActorSystemImpl({
      nodeAddress: 'node-b',
      transport: remoteTransport,
    });
    await Promise.all([localSystem.start(), remoteSystem.start()]);

    const firstRemoteActor = await remoteSystem.spawn(createCheckoutBehavior(), {
      id: 'websocket-checkout',
    });
    await localSystem.join(['node-b']);
    const firstRemoteRef = await localSystem.lookup<CheckoutContext, CheckoutMessage>(
      firstRemoteActor.address.path
    );
    if (!firstRemoteRef) {
      throw new Error('Expected first remote ref');
    }
    await firstRemoteRef.send({ type: 'SUBMIT', orderId: 'before-restart' });
    await remoteSystem.flush();
    await expect(firstRemoteRef.ask<number>({ type: 'GET_COUNT' })).resolves.toBe(1);

    await remoteSystem.stop();
    await remoteTransport.stop();
    await waitFor(
      () => localTransport?.getPeerState('node-b') === 'disconnected',
      'Expected local transport to observe remote restart'
    );

    remoteTransport = createNodeWebSocketMessageTransport({
      nodeAddress: 'node-b',
      nodeId: 'stable-node-b',
      incarnation: 'node-b-boot-2',
      heartbeatIntervalMs: 0,
      listen: { port: 0 },
    });
    await remoteTransport.start();
    remoteUrl = remoteTransport.getListeningUrl() ?? '';
    if (!remoteUrl) {
      throw new Error('Expected restarted remote listening URL');
    }

    remoteSystem = new ActorSystemImpl({
      nodeAddress: 'node-b',
      transport: remoteTransport,
    });
    await remoteSystem.start();
    const secondRemoteActor = await remoteSystem.spawn(createCheckoutBehavior(), {
      id: 'websocket-checkout',
    });

    await localSystem.join(['node-b']);
    await waitFor(
      () => localTransport?.getPeerSnapshot('node-b')?.identity?.incarnation === 'node-b-boot-2',
      'Expected local transport to register restarted incarnation'
    );

    const secondRemoteRef = await localSystem.lookup<CheckoutContext, CheckoutMessage>(
      secondRemoteActor.address.path
    );
    if (!secondRemoteRef) {
      throw new Error('Expected restarted remote ref');
    }

    await secondRemoteRef.send({ type: 'SUBMIT', orderId: 'after-restart' });
    await remoteSystem.flush();
    await localSystem.flush();

    await expect(secondRemoteRef.ask<number>({ type: 'GET_COUNT' })).resolves.toBe(1);
  });
});
