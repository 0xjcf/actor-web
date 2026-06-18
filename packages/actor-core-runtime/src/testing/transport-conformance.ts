/**
 * @module actor-core/runtime/testing/transport-conformance
 * @description Parametrized conformance suite that every {@link MessageTransport}
 * implementation must pass.
 *
 * A transport declares the contract features it supports through
 * {@link TransportConformanceCapabilities}; cases for unsupported features are
 * skipped. This lets the same suite (a) characterize the current behavior of
 * each transport today and (b) become the enforcement gate for a feature once
 * it is implemented — flip the capability flag and the case starts running.
 *
 * Not a published entry point; lives under `testing/` alongside other
 * vitest-aware helpers (see `test-logger-config.ts`).
 */

import { describe, expect, it } from 'vitest';
import type { ActorMessage, MessageTransport } from '../actor-system.js';

/**
 * Observable contract features a transport claims to honor. Cases guarded by a
 * `false` flag are skipped, documenting a known gap rather than failing.
 *
 * Scope is deliberately the *black-box* contract reachable through the
 * {@link MessageTransport} interface. Internal reliability behaviors
 * (ack/retry, idempotency dedup, heartbeat timeout) require fault injection the
 * interface does not expose and are covered by each transport's own white-box
 * unit tests, not here.
 */
export interface TransportConformanceCapabilities {
  /** Messages to a single peer are delivered in send order. */
  readonly ordering: boolean;
  /** A throwing or rejecting subscriber neither escapes nor blocks others. */
  readonly safeDispatch: boolean;
}

/** Two transports connected to each other, ready to exchange messages. */
export interface TransportConformancePair {
  readonly a: MessageTransport;
  readonly b: MessageTransport;
  readonly addrA: string;
  readonly addrB: string;
  teardown(): void | Promise<void>;
}

/** A transport implementation under test plus how to stand up a connected pair. */
export interface TransportConformanceHarness {
  readonly name: string;
  readonly capabilities: TransportConformanceCapabilities;
  createPair(): Promise<TransportConformancePair>;
}

const PROBE_TYPE = 'conformance.probe';

type ProbeMessage = ActorMessage<{ type: typeof PROBE_TYPE; seq: number }>;

function probe(seq: number): ProbeMessage {
  return { type: PROBE_TYPE, seq } as ProbeMessage;
}

interface ProbeReceipt {
  readonly source: string;
  readonly seq: number;
}

function collectProbes(transport: MessageTransport): {
  readonly received: ProbeReceipt[];
  stop(): void;
} {
  const received: ProbeReceipt[] = [];
  const stop = transport.subscribe(({ source, message }) => {
    if (message.type === PROBE_TYPE) {
      received.push({ source, seq: (message as ProbeMessage).seq });
    }
  });
  return { received, stop };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('transport-conformance waitFor: condition not met within timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * Register the shared conformance cases for a single transport implementation.
 * Call once per transport from a `*.test.ts` file.
 */
export function describeTransportConformance(harness: TransportConformanceHarness): void {
  const { name, capabilities } = harness;
  const orderingCase = capabilities.ordering ? it : it.skip;
  const safeDispatchCase = capabilities.safeDispatch ? it : it.skip;

  describe(`MessageTransport conformance: ${name}`, () => {
    it('round-trips a message from a to b, tagged with the sender address', async () => {
      const pair = await harness.createPair();
      try {
        const inbox = collectProbes(pair.b);
        await pair.a.send(pair.addrB, probe(1));
        await waitFor(() => inbox.received.length >= 1);
        expect(inbox.received[0]).toEqual({ source: pair.addrA, seq: 1 });
        inbox.stop();
      } finally {
        await pair.teardown();
      }
    });

    it('stops delivering to a subscriber after it unsubscribes', async () => {
      const pair = await harness.createPair();
      try {
        const inbox = collectProbes(pair.b);
        inbox.stop();
        await pair.a.send(pair.addrB, probe(1));
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(inbox.received).toHaveLength(0);
      } finally {
        await pair.teardown();
      }
    });

    it('reflects connect/disconnect in isConnected and getConnectedNodes', async () => {
      const pair = await harness.createPair();
      try {
        expect(pair.a.isConnected(pair.addrB)).toBe(true);
        expect(pair.a.getConnectedNodes()).toContain(pair.addrB);

        await pair.a.disconnect(pair.addrB);
        expect(pair.a.isConnected(pair.addrB)).toBe(false);

        // disconnect is idempotent — a second call must not throw.
        await pair.a.disconnect(pair.addrB);
        expect(pair.a.isConnected(pair.addrB)).toBe(false);
      } finally {
        await pair.teardown();
      }
    });

    orderingCase('delivers messages to a peer in send order', async () => {
      const pair = await harness.createPair();
      try {
        const inbox = collectProbes(pair.b);
        for (let seq = 1; seq <= 5; seq += 1) {
          await pair.a.send(pair.addrB, probe(seq));
        }
        await waitFor(() => inbox.received.length >= 5);
        expect(inbox.received.map((receipt) => receipt.seq)).toEqual([1, 2, 3, 4, 5]);
        inbox.stop();
      } finally {
        await pair.teardown();
      }
    });

    safeDispatchCase('isolates a throwing subscriber from healthy subscribers', async () => {
      const pair = await harness.createPair();
      try {
        const stopThrowing = pair.b.subscribe(({ message }) => {
          if (message.type === PROBE_TYPE) {
            throw new Error('conformance: subscriber boom');
          }
        });
        const inbox = collectProbes(pair.b);

        await pair.a.send(pair.addrB, probe(1));
        await waitFor(() => inbox.received.length >= 1);
        expect(inbox.received[0]?.seq).toBe(1);

        stopThrowing();
        inbox.stop();
      } finally {
        await pair.teardown();
      }
    });

    // The PR#27 root cause at the conformance level: an async subscriber that
    // returns a rejected promise must neither escape as an unhandled rejection
    // nor starve healthy siblings. Guarded by the same safeDispatch flag, so it
    // runs for every transport whose dispatch routes through safeDispatchListener.
    safeDispatchCase(
      'isolates an async-rejecting subscriber from healthy subscribers',
      async () => {
        const unhandled: unknown[] = [];
        const onUnhandledRejection = (reason: unknown): void => {
          unhandled.push(reason);
        };
        process.on('unhandledRejection', onUnhandledRejection);

        const pair = await harness.createPair();
        try {
          const stopRejecting = pair.b.subscribe(async ({ message }) => {
            if (message.type === PROBE_TYPE) {
              throw new Error('conformance: async subscriber boom');
            }
          });
          const inbox = collectProbes(pair.b);

          await pair.a.send(pair.addrB, probe(1));
          await waitFor(() => inbox.received.length >= 1);
          expect(inbox.received[0]?.seq).toBe(1);

          // Give any escaped rejection a microtask + macrotask window to surface.
          await new Promise((resolve) => setTimeout(resolve, 20));
          expect(unhandled).toHaveLength(0);

          stopRejecting();
          inbox.stop();
        } finally {
          await pair.teardown();
          process.off('unhandledRejection', onUnhandledRejection);
        }
      }
    );
  });
}
