/**
 * @module actor-core/runtime/unit/cross-node-subscription-integration
 * @description Multi-node acceptance for cross-node subscription delivery over
 * the deterministic in-memory transport network: end-to-end forwarding plus the
 * two restart/recovery paths (subscriber-node restart re-derives the edge;
 * publisher-node reconnect replays the subscribe handshake). The in-memory
 * network drives the same `handleRuntimeProtocolMessage` path a real WebSocket
 * node does, with deterministic connect/disconnect — no ports, no wall-clock
 * flake (the CI risk flagged for real-socket multi-node tests).
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { ActorRef } from '../actor-ref.js';
import type { MessageTransport } from '../actor-system.js';
import { ActorSystemImpl } from '../actor-system-impl.js';
import {
  createInMemoryMessageTransportNetwork,
  type InMemoryMessageTransportNetwork,
} from '../testing/in-memory-message-transport.js';
import { defineBehavior } from '../unified-actor-builder.js';

type PublisherMessage = { type: 'GO'; n: number };
type PublisherEvent = { type: 'TICK'; n: number };
type CollectorMessage = { type: string } | { type: 'GET' };

function createPublisherBehavior() {
  return defineBehavior<PublisherMessage, PublisherEvent>()
    .withContext({})
    .onMessage(({ message }) =>
      message.type === 'GO' ? { emit: [{ type: 'TICK' as const, n: message.n }] } : {}
    )
    .build();
}

function createCollectorBehavior() {
  return defineBehavior<CollectorMessage>()
    .withContext({ received: [] as string[] })
    .onMessage(({ message, actor }) => {
      const { received } = actor.getSnapshot().context as { received: string[] };
      if (message.type === 'GET') {
        return { reply: [...received] };
      }
      return { context: { received: [...received, message.type] } };
    })
    .build();
}

async function pollUntil(
  getReceived: () => Promise<string[]>,
  done: (received: string[]) => boolean
): Promise<string[]> {
  let received: string[] = [];
  for (let attempt = 0; attempt < 50; attempt += 1) {
    received = await getReceived();
    if (done(received)) {
      return received;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return received;
}

const PUB_PATH = 'actor://node-a/pub';
const SUB_PATH = 'actor://node-b/sub';

describe('cross-node subscription delivery (multi-node)', () => {
  let nodeA: ActorSystemImpl | undefined;
  let nodeB: ActorSystemImpl | undefined;

  afterEach(async () => {
    await Promise.allSettled([nodeA?.stop(), nodeB?.stop()]);
    nodeA = undefined;
    nodeB = undefined;
  });

  /** Boot both nodes over a fresh network, spawn publisher on A + collector on B. */
  async function bootBoth(network: InMemoryMessageTransportNetwork): Promise<{
    transportA: MessageTransport;
    transportB: MessageTransport;
    publisher: ActorRef<unknown, PublisherMessage>;
    collector: ActorRef<unknown, CollectorMessage>;
  }> {
    const transportA = network.createTransport('node-a');
    const transportB = network.createTransport('node-b');
    nodeA = new ActorSystemImpl({ nodeAddress: 'node-a', transport: transportA });
    nodeB = new ActorSystemImpl({ nodeAddress: 'node-b', transport: transportB });
    await Promise.all([nodeA.start(), nodeB.start()]);
    await nodeB.join(['node-a']);
    await nodeA.join(['node-b']);
    const publisher = await nodeA.spawn(createPublisherBehavior(), { id: 'pub' });
    const collector = await nodeB.spawn(createCollectorBehavior(), { id: 'sub' });
    return { transportA, transportB, publisher, collector };
  }

  async function subscribe(): Promise<void> {
    if (!nodeB || !nodeA) throw new Error('nodes not booted');
    await nodeB.sendTopologySubscribe({
      publisherNode: 'node-a',
      publisherPath: PUB_PATH,
      subscriberPath: SUB_PATH,
    });
    await nodeA.flush();
  }

  it('delivers publisher-node events to a subscriber actor on the peer node', async () => {
    const network = createInMemoryMessageTransportNetwork();
    const { publisher, collector } = await bootBoth(network);
    if (!nodeA || !nodeB) throw new Error('nodes not booted');
    await subscribe();

    await publisher.send({ type: 'GO', n: 1 });
    await nodeA.flush();
    await nodeB.flush();

    const received = await pollUntil(
      () => collector.ask<string[]>({ type: 'GET' }),
      (r) => r.includes('TICK')
    );
    expect(received).toContain('TICK');
  });

  it('re-wires after a subscriber-node restart (topology is the durable source)', async () => {
    const network = createInMemoryMessageTransportNetwork();
    const { transportB, publisher } = await bootBoth(network);
    if (!nodeA || !nodeB) throw new Error('nodes not booted');
    await subscribe();
    await publisher.send({ type: 'GO', n: 1 });
    await nodeA.flush();
    await nodeB.flush();

    // Restart node B: stop, recreate on the same address + transport, re-spawn
    // the subscriber, re-derive the subscription edge from topology.
    await nodeB.stop();
    nodeB = new ActorSystemImpl({ nodeAddress: 'node-b', transport: transportB });
    await nodeB.start();
    await nodeB.join(['node-a']);
    const collector = await nodeB.spawn(createCollectorBehavior(), { id: 'sub' });
    await subscribe();

    await publisher.send({ type: 'GO', n: 2 });
    await nodeA.flush();
    await nodeB.flush();

    const received = await pollUntil(
      () => collector.ask<string[]>({ type: 'GET' }),
      (r) => r.includes('TICK')
    );
    expect(received).toContain('TICK');
  });

  it('re-handshakes and resumes forwarding after the publisher peer reconnects', async () => {
    const network = createInMemoryMessageTransportNetwork();
    const { transportA, publisher, collector } = await bootBoth(network);
    if (!nodeA || !nodeB) throw new Error('nodes not booted');
    await subscribe();

    // The publisher node drops the peer (losing its in-memory edge), then it
    // reconnects: node B must replay the subscribe handshake so forwarding
    // resumes without re-running topology wiring.
    await transportA.disconnect('node-b');
    await transportA.connect('node-b');
    await nodeA.flush();
    await nodeB.flush();

    await publisher.send({ type: 'GO', n: 9 });
    await nodeA.flush();
    await nodeB.flush();

    const received = await pollUntil(
      () => collector.ask<string[]>({ type: 'GET' }),
      (r) => r.includes('TICK')
    );
    expect(received).toContain('TICK');
  });
});
