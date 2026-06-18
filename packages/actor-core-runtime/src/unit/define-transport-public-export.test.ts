import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import type { ActorMessage } from '../actor-system.js';
// AC10: the one-line authoring surface must be reachable from the PUBLIC entry point,
// not the internal transport module path. Import from ../index.js on purpose.
import { defineTransport, type TransportDuplex } from '../index.js';

function userMessage(type: string): ActorMessage {
  return { type, _timestamp: 1, _version: '1.0.0' } as ActorMessage;
}

// A real postMessage/onmessage/close duplex over a Node worker_threads MessagePort,
// mirroring message-port-transport.test.ts's createPairedPorts: each MessagePort is a
// genuine EventTarget duplex. TransportCore serializes frames to JSON strings on send and
// (per the node-ws PeerLink contract, node-websocket-message-transport.ts:159) expects
// onPayload to deliver PARSED frame objects, so this author duplex JSON-parses inbound —
// the minimal, real author-side glue that keeps the round-trip honest without touching any
// transport/*.ts module.
function frameDuplex(port: MessagePort): TransportDuplex {
  return {
    postMessage(data: unknown): void {
      port.postMessage(data);
    },
    addEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
      port.on('message', (raw) => {
        listener({ data: typeof raw === 'string' ? JSON.parse(raw) : raw });
      });
    },
    removeEventListener(): void {
      // Single-use duplex in the test; teardown happens via close().
    },
    close(): void {
      port.close();
    },
  };
}

describe('public transport authoring surface (AC10)', () => {
  it('authors a transport in one line from the public entry and round-trips a message', async () => {
    const { port1, port2 } = new MessageChannel();
    try {
      // The one-liner under test: the author returns the raw medium; defineTransport wires it
      // through fromDuplex + TransportCore into a MessageTransport factory.
      const transportFactory = defineTransport<{ port: MessagePort }>(({ port }) =>
        frameDuplex(port)
      );

      // heartbeatIntervalMs: 0 keeps the test deterministic (no background timers).
      // incarnation: '0' pins a stable identity so the dial-only (non-handshaking) duplex
      // path's placeholder peer identity (the core derives incarnation '0' for placeholder
      // peers) matches the real frame source on the far end for inbound source-matching.
      const a = transportFactory({
        node: 'a',
        port: port1,
        incarnation: '0',
        heartbeatIntervalMs: 0,
      });
      const b = transportFactory({
        node: 'b',
        port: port2,
        incarnation: '0',
        heartbeatIntervalMs: 0,
      });

      const received: Array<{ source: string; message: ActorMessage }> = [];
      b.subscribe((event) => {
        received.push(event);
      });

      await a.start?.();
      await b.start?.();
      // Each side dials the peer at the far end of its own duplex port, so both cores attach
      // a receive sink to their MessagePort (the dial-only channel wires inbound delivery on
      // dial). This is the genuine one-line-author topology over a real duplex pair.
      await b.connect('a');
      await a.connect('b');
      await a.send('b', userMessage('GREET'));

      // Allow the async dispatch cycle through TransportCore's inbound pipeline
      // (validate -> source-match -> idempotency -> record -> ack -> emit) to settle.
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The user message round-tripped end-to-end through TransportCore reliability.
      expect(received.map((event) => event.message.type)).toContain('GREET');
      expect(b.getStats().framesReceived).toBeGreaterThanOrEqual(1);

      await a.stop?.();
      await b.stop?.();
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
