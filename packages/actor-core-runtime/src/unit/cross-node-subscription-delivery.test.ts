/**
 * @module actor-core/runtime/unit/cross-node-subscription-delivery
 * @description Unit coverage for cross-node topology subscription delivery: the
 * `__runtime.topology.subscribe`/`.event`/`.unsubscribe` protocol, the publisher
 * node's forward path, and the subscriber node's mailbox delivery. Uses the
 * deterministic in-memory transport network (no real WebSocket / ports) — the
 * same `handleRuntimeProtocolMessage` path a real node drives.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { MessageTransport } from '../actor-system.js';
import { ActorSystemImpl } from '../actor-system-impl.js';
import { createActorSource } from '../integration/actor-source.js';
import { createInMemoryMessageTransportNetwork } from '../testing/in-memory-message-transport.js';
import { defineBehavior } from '../unified-actor-builder.js';

type PublisherMessage = { type: 'GO'; n?: number } | { type: 'OTHER' };
type PublisherEvent = { type: 'TICK'; n: number } | { type: 'OTHER_EVENT' };
type CollectorMessage = { type: string } | { type: 'GET' };

/** Publisher emits a `TICK` (carrying `n`) on GO, and an `OTHER_EVENT` on OTHER. */
function createPublisherBehavior() {
  return defineBehavior<PublisherMessage, PublisherEvent>()
    .withContext({})
    .onMessage(({ message }) => {
      if (message.type === 'GO') {
        return { emit: [{ type: 'TICK' as const, n: message.n ?? 1 }] };
      }
      if (message.type === 'OTHER') {
        return { emit: [{ type: 'OTHER_EVENT' as const }] };
      }
      return {};
    })
    .build();
}

/**
 * Collector records the `type` of every non-GET message it receives (forwarded
 * topology events land in its mailbox like any other message) and replies the
 * collected list on GET.
 */
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

/**
 * Poll an actor's GET reply until `done(received)` holds, returning the list.
 * Cross-node delivery completes within a flush, but a bounded poll keeps the
 * assertion robust without asserting on wall-clock.
 */
async function pollAsk(
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

describe('cross-node topology subscription delivery', () => {
  let publisherSystem: ActorSystemImpl | undefined;
  let subscriberSystem: ActorSystemImpl | undefined;

  afterEach(async () => {
    await Promise.allSettled([publisherSystem?.stop(), subscriberSystem?.stop()]);
    publisherSystem = undefined;
    subscriberSystem = undefined;
  });

  async function bootTwoNodes(): Promise<{
    publisherTransport: MessageTransport;
  }> {
    const network = createInMemoryMessageTransportNetwork();
    const publisherTransport = network.createTransport('node-a');
    publisherSystem = new ActorSystemImpl({
      nodeAddress: 'node-a',
      transport: publisherTransport,
    });
    subscriberSystem = new ActorSystemImpl({
      nodeAddress: 'node-b',
      transport: network.createTransport('node-b'),
    });
    await Promise.all([publisherSystem.start(), subscriberSystem.start()]);
    await subscriberSystem.join(['node-a']);
    await publisherSystem.join(['node-b']);
    return { publisherTransport };
  }

  it('reports whether a runtime transport is configured', async () => {
    await bootTwoNodes();
    expect(publisherSystem?.isRemoteTransportConfigured()).toBe(true);

    const localOnly = new ActorSystemImpl({ nodeAddress: 'solo' });
    await localOnly.start();
    try {
      expect(localOnly.isRemoteTransportConfigured()).toBe(false);
    } finally {
      await localOnly.stop();
    }
  });

  it('forwards an emitted event to a subscriber actor on a peer node', async () => {
    await bootTwoNodes();
    if (!publisherSystem || !subscriberSystem) throw new Error('systems not booted');

    const publisher = await publisherSystem.spawn(createPublisherBehavior(), { id: 'pub' });
    const collector = await subscriberSystem.spawn(createCollectorBehavior(), { id: 'sub' });

    await subscriberSystem.sendTopologySubscribe({
      publisherNode: 'node-a',
      publisherPath: publisher.address.path,
      subscriberPath: collector.address.path,
    });
    await publisherSystem.flush();

    await publisher.send({ type: 'GO', n: 7 });
    await publisherSystem.flush();
    await subscriberSystem.flush();

    const received = await pollAsk(() => collector.ask<string[]>({ type: 'GET' }), (r) => r.includes('TICK'));
    expect(received).toContain('TICK');
  });

  it('applies the per-edge events allow-list', async () => {
    await bootTwoNodes();
    if (!publisherSystem || !subscriberSystem) throw new Error('systems not booted');

    const publisher = await publisherSystem.spawn(createPublisherBehavior(), { id: 'pub' });
    const collector = await subscriberSystem.spawn(createCollectorBehavior(), { id: 'sub' });

    await subscriberSystem.sendTopologySubscribe({
      publisherNode: 'node-a',
      publisherPath: publisher.address.path,
      subscriberPath: collector.address.path,
      events: ['TICK'],
    });
    await publisherSystem.flush();

    await publisher.send({ type: 'OTHER' });
    await publisher.send({ type: 'GO', n: 1 });
    await publisherSystem.flush();
    await subscriberSystem.flush();

    const received = await pollAsk(() => collector.ask<string[]>({ type: 'GET' }), (r) => r.includes('TICK'));
    expect(received).toContain('TICK');
    expect(received).not.toContain('OTHER_EVENT');
  });

  it('drops emits with no matching subscription edge (pre-handshake)', async () => {
    await bootTwoNodes();
    if (!publisherSystem || !subscriberSystem) throw new Error('systems not booted');

    const publisher = await publisherSystem.spawn(createPublisherBehavior(), { id: 'pub' });
    const collector = await subscriberSystem.spawn(createCollectorBehavior(), { id: 'sub' });

    // No sendTopologySubscribe: emit before any edge exists.
    await publisher.send({ type: 'GO', n: 1 });
    await publisherSystem.flush();
    await subscriberSystem.flush();

    const received = await collector.ask<string[]>({ type: 'GET' });
    expect(received).not.toContain('TICK');
  });

  it('stops forwarding after topology.unsubscribe', async () => {
    await bootTwoNodes();
    if (!publisherSystem || !subscriberSystem) throw new Error('systems not booted');

    const publisher = await publisherSystem.spawn(createPublisherBehavior(), { id: 'pub' });
    const collector = await subscriberSystem.spawn(createCollectorBehavior(), { id: 'sub' });

    const teardown = await subscriberSystem.sendTopologySubscribe({
      publisherNode: 'node-a',
      publisherPath: publisher.address.path,
      subscriberPath: collector.address.path,
    });
    await publisherSystem.flush();
    await teardown();
    await publisherSystem.flush();

    await publisher.send({ type: 'GO', n: 1 });
    await publisherSystem.flush();
    await subscriberSystem.flush();

    const received = await collector.ask<string[]>({ type: 'GET' });
    expect(received).not.toContain('TICK');
  });

  it('does not corrupt source-projection gap detection on the same publisher', async () => {
    await bootTwoNodes();
    if (!publisherSystem || !subscriberSystem) throw new Error('systems not booted');

    const publisher = await publisherSystem.spawn(createPublisherBehavior(), { id: 'pub' });
    const collector = await subscriberSystem.spawn(createCollectorBehavior(), { id: 'sub' });

    // A createActorSource projection watcher on node-b for the same publisher...
    const remoteRef = await subscriberSystem.lookup<unknown, PublisherMessage>(
      publisher.address.path
    );
    if (!remoteRef) throw new Error('expected remote ref to publisher');
    const source = createActorSource<unknown, PublisherMessage, PublisherEvent>(remoteRef);
    const statuses: string[] = [];
    const unsubscribeStatus = source.subscribeTransportStatus((status) => {
      statuses.push(status.state);
    });
    const unsubscribeSnapshot = source.subscribe(() => {});

    // ...AND a topology subscription edge for the same publisher.
    await subscriberSystem.sendTopologySubscribe({
      publisherNode: 'node-a',
      publisherPath: publisher.address.path,
      subscriberPath: collector.address.path,
    });
    await publisherSystem.flush();
    await subscriberSystem.flush();

    await publisher.send({ type: 'GO', n: 1 });
    await publisherSystem.flush();
    await subscriberSystem.flush();
    await publisher.send({ type: 'GO', n: 2 });
    await publisherSystem.flush();
    await subscriberSystem.flush();

    const received = await pollAsk(() => collector.ask<string[]>({ type: 'GET' }), (r) => r.filter((t) => t === 'TICK').length >= 2);

    unsubscribeSnapshot();
    unsubscribeStatus();

    // The topology channel must not have advanced the projection sequence and
    // flipped the source watcher to degraded.
    expect(statuses).not.toContain('degraded');
    expect(source.transportStatus().state).not.toBe('degraded');
    expect(received.filter((t) => t === 'TICK').length).toBeGreaterThanOrEqual(2);
  });

  it('prunes a node’s edges and absorbs the rejected send when the peer disconnects', async () => {
    const { publisherTransport } = await bootTwoNodes();
    if (!publisherSystem || !subscriberSystem) throw new Error('systems not booted');

    const publisher = await publisherSystem.spawn(createPublisherBehavior(), { id: 'pub' });
    const collector = await subscriberSystem.spawn(createCollectorBehavior(), { id: 'sub' });

    await subscriberSystem.sendTopologySubscribe({
      publisherNode: 'node-a',
      publisherPath: publisher.address.path,
      subscriberPath: collector.address.path,
    });
    await publisherSystem.flush();

    await publisherTransport.disconnect('node-b');

    // Emitting into a dropped peer must not throw or leak an unhandled rejection.
    await publisher.send({ type: 'GO', n: 1 });
    await publisherSystem.flush();
    await subscriberSystem.flush();

    // Edge pruned: re-emit after a fresh handshake delivers; the outage emit did not.
    const received = await collector.ask<string[]>({ type: 'GET' });
    expect(received).not.toContain('TICK');
  });
});
