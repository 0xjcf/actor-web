import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import type { ActorMessage } from '../actor-system.js';
// AC10: the one-line authoring surface must be reachable from the PUBLIC entry point,
// not the internal transport module path. Import from ../index.js on purpose.
import { defineTransport } from '../index.js';

function userMessage(type: string): ActorMessage {
  return { type, _timestamp: 1, _version: '1.0.0' } as ActorMessage;
}

describe('public transport authoring surface (AC10)', () => {
  it('authors a transport in ONE line from the public entry and round-trips BOTH directions with default identities', async () => {
    const { port1, port2 } = new MessageChannel();
    try {
      // The headline acceptance bar: the author returns the raw MessagePort DIRECTLY.
      // No fromDuplex call, no JSON.parse glue — defineTransport + fromDuplex own the
      // parse seam (string -> object) and the symmetric hello handshake internally. A Node
      // worker_threads MessagePort is a genuine postMessage/onmessage/close duplex.
      const make = defineTransport<{ port: MessagePort }>(({ port }) => port);

      // Default identities: only `node`/`nodeAddress` differ ('a' / 'b'). NO pinned
      // incarnation, NO pinned nodeId. The hello handshake exchanges each side's real
      // identity so inbound source-matching passes despite the Date.now() incarnations.
      // heartbeatIntervalMs: 0 keeps the test deterministic (no background timers).
      const a = make({ node: 'a', port: port1, heartbeatIntervalMs: 0 });
      const b = make({ node: 'b', port: port2, heartbeatIntervalMs: 0 });

      const receivedByB: Array<{ source: string; message: ActorMessage }> = [];
      const receivedByA: Array<{ source: string; message: ActorMessage }> = [];
      b.subscribe((event) => receivedByB.push(event));
      a.subscribe((event) => receivedByA.push(event));

      await a.start();
      await b.start();
      // SYMMETRIC: both ends dial. Each connect sends its hello and AWAITS the peer's, so the
      // two connects must be in flight together — serializing them would deadlock (the first
      // would wait for a hello the second has not sent yet). This is the documented model:
      // both ends construct the transport and call connect().
      await Promise.all([a.connect('b'), b.connect('a')]);

      await a.send('b', userMessage('GREET_FROM_A'));
      await b.send('a', userMessage('GREET_FROM_B'));

      // Allow the async inbound pipeline (validate -> source-match -> idempotency ->
      // record -> ack -> emit) to settle on both cores.
      await new Promise((resolve) => setTimeout(resolve, 50));

      // BOTH directions round-trip end-to-end through TransportCore reliability.
      expect(receivedByB.map((e) => e.message.type)).toContain('GREET_FROM_A');
      expect(receivedByB.find((e) => e.message.type === 'GREET_FROM_A')?.source).toBe('a');
      expect(receivedByA.map((e) => e.message.type)).toContain('GREET_FROM_B');
      expect(receivedByA.find((e) => e.message.type === 'GREET_FROM_B')?.source).toBe('b');

      // No spurious disconnect during the happy path.
      expect(a.isConnected('b')).toBe(true);
      expect(b.isConnected('a')).toBe(true);

      // Disconnect cleanup + idempotency.
      await a.disconnect('b');
      expect(a.isConnected('b')).toBe(false);
      await expect(a.disconnect('b')).resolves.toBeUndefined();

      await a.stop();
      await b.stop();
    } finally {
      port1.close();
      port2.close();
    }
  });

  it('delivers an app frame the peer sends immediately after its dial resolves (pre-subscribe race / Q4b buffer)', async () => {
    const { port1, port2 } = new MessageChannel();
    try {
      const make = defineTransport<{ port: MessagePort }>(({ port }) => port);
      const a = make({ node: 'a', port: port1, heartbeatIntervalMs: 0 });
      const b = make({ node: 'b', port: port2, heartbeatIntervalMs: 0 });

      const receivedByB: ActorMessage[] = [];
      b.subscribe((event) => receivedByB.push(event.message));

      await a.start();
      await b.start();
      // Dial both ends together so the helloes are in flight. The instant a's dial resolves,
      // fire an app frame in the same microtask. b's core may not yet have called receive()
      // on its link (its dial-time hello read consumed the buffered stream WITHOUT claiming
      // the authoritative sink), so this frame would be lost WITHOUT the pending buffer.
      await Promise.all([
        b.connect('a'),
        a.connect('b').then(() => a.send('b', userMessage('EARLY'))),
      ]);

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Proven delivered — drained from the pending buffer, not dropped.
      expect(receivedByB.map((m) => m.type)).toContain('EARLY');

      await a.stop();
      await b.stop();
    } finally {
      port1.close();
      port2.close();
    }
  });

  it('does not leak the internal TransportCore contract through the public entry', async () => {
    // Type-level guarantee: only the sanctioned surface is public. TransportCore /
    // TransportChannel / PeerLink are NOT importable from ../index.js — referencing
    // TransportCore off the public namespace must be a type error (@ts-expect-error proves
    // it is absent from the public surface) and absent at runtime.
    const publicSurface = await import('../index.js');
    // @ts-expect-error — TransportCore is internal and must not be on the public surface.
    const leaked = publicSurface.TransportCore;
    expect(leaked).toBeUndefined();
  });
});
