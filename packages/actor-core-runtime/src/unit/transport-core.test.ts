import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActorMessage } from '../actor-system.js';
import {
  createRuntimeNodeIdentity,
  createRuntimeTransportAckFrame,
  createRuntimeTransportFrame,
  measureRuntimeTransportFrameBytes,
  type RuntimeTransportFrame,
} from '../runtime-transport-contract.js';
import type {
  RuntimeTransportIdempotencyClaimInput,
  RuntimeTransportIdempotencyClaimResult,
} from '../runtime-transport-idempotency.js';
import type { RuntimeTransportTelemetryEvent } from '../runtime-transport-telemetry.js';
import type {
  DialResult,
  PeerIdentity,
  PeerLink,
  PeerLinkHeartbeat,
  PeerLinkSink,
  TransportChannel,
  TransportListenHandle,
} from '../transport/transport-channel.js';
import { TransportCore, type TransportTimers } from '../transport/transport-core.js';

// PR 1 fake-channel test design (engineering brief §3, cases 4-17). A TransportCore is
// driven with NO wall clock and NO real sockets via FakeTransportChannel / FakePeerLink /
// FakeTimers. This proves the core owns reliability (ack/retry, queue/backpressure,
// heartbeat, idempotency, stats projection, safe dispatch) deterministically.

// --- controllable fake timers + clock ----------------------------------------------------
// FakeTimers owns the single source of fake time so the shell's clock() and the deciders'
// `now` argument stay consistent: advancing time fires due timers AND moves the clock that
// the injected clock() reads. This is what makes ack-retry and heartbeat-timeout
// deterministic with no wall clock.

interface ScheduledTimer {
  id: number;
  fireAtMs: number;
  intervalMs: number | null;
  callback: () => void;
}

class FakeTimers implements TransportTimers {
  private nextId = 1;
  private readonly timers = new Map<number, ScheduledTimer>();
  private currentMs = 0;

  setTimeout(callback: () => void, ms: number): number {
    this.nextId += 1;
    const id = this.nextId;
    this.timers.set(id, { id, fireAtMs: this.currentMs + ms, intervalMs: null, callback });
    return id;
  }

  clearTimeout(handle: number | undefined): void {
    if (handle !== undefined) {
      this.timers.delete(handle);
    }
  }

  setInterval(callback: () => void, ms: number): number {
    this.nextId += 1;
    const id = this.nextId;
    this.timers.set(id, { id, fireAtMs: this.currentMs + ms, intervalMs: ms, callback });
    return id;
  }

  clearInterval(handle: number | undefined): void {
    if (handle !== undefined) {
      this.timers.delete(handle);
    }
  }

  /** The injected clock reads this — kept in lockstep with fired timers. */
  now(): Date {
    return new Date(this.currentMs);
  }

  /** Advance fake time, firing every due timer in chronological order. */
  advance(ms: number): void {
    const target = this.currentMs + ms;
    for (;;) {
      let due: ScheduledTimer | undefined;
      for (const timer of this.timers.values()) {
        if (timer.fireAtMs <= target && (!due || timer.fireAtMs < due.fireAtMs)) {
          due = timer;
        }
      }
      if (!due) {
        break;
      }
      this.currentMs = due.fireAtMs;
      if (due.intervalMs !== null) {
        due.fireAtMs = this.currentMs + due.intervalMs;
      } else {
        this.timers.delete(due.id);
      }
      due.callback();
    }
    this.currentMs = target;
  }

  /** Move the clock forward WITHOUT firing timers (e.g. to refresh lastSeen before a deadline). */
  advanceClockOnly(ms: number): void {
    this.currentMs += ms;
  }

  get registeredCount(): number {
    return this.timers.size;
  }
}

// --- fake peer link ----------------------------------------------------------------------

class FakePeerLink implements PeerLink {
  readonly sent: unknown[] = [];
  isOpen = true;
  closeCount = 0;
  private sink: PeerLinkSink | null = null;
  readonly heartbeat?: PeerLinkHeartbeat;

  constructor(
    readonly remoteAddress: string,
    options: { heartbeat?: PeerLinkHeartbeat; identity?: PeerIdentity } = {}
  ) {
    if (options.heartbeat) {
      this.heartbeat = options.heartbeat;
    }
    if (options.identity) {
      this.identity = options.identity;
    }
  }

  readonly identity?: PeerIdentity;

  send(payload: unknown): Promise<void> {
    this.sent.push(payload);
    return Promise.resolve();
  }

  receive(sink: PeerLinkSink): () => void {
    this.sink = sink;
    return () => {
      this.sink = null;
    };
  }

  close(): void {
    // Idempotent, never throws (errors-as-values).
    this.closeCount += 1;
    this.isOpen = false;
  }

  /** Test helper: deliver an already-parsed inbound payload. */
  deliver(payload: unknown): void {
    this.sink?.onPayload(payload);
  }
}

class FakeNativeHeartbeat implements PeerLinkHeartbeat {
  pingCount = 0;
  private aliveListeners = new Set<() => void>();

  ping(): void {
    this.pingCount += 1;
  }

  onAlive(listener: () => void): () => void {
    this.aliveListeners.add(listener);
    return () => {
      this.aliveListeners.delete(listener);
    };
  }

  signalAlive(): void {
    for (const listener of this.aliveListeners) {
      listener();
    }
  }
}

// --- fake transport channel --------------------------------------------------------------

class FakeTransportChannel implements TransportChannel {
  dialCount = 0;
  private onPeer: ((link: PeerLink) => void) | null = null;

  constructor(private readonly result: () => DialResult) {}

  dial(_remoteAddress: string): Promise<DialResult> {
    this.dialCount += 1;
    return Promise.resolve(this.result());
  }

  listen(onPeer: (link: PeerLink) => void): Promise<TransportListenHandle> {
    this.onPeer = onPeer;
    return Promise.resolve({
      close: async () => {
        this.onPeer = null;
      },
    });
  }

  accept(link: PeerLink): void {
    this.onPeer?.(link);
  }
}

// --- helpers -----------------------------------------------------------------------------

const LOCAL = createRuntimeNodeIdentity({ nodeAddress: 'node-a', nodeId: 'a', incarnation: '1' });
// PR 1 has no real handshake yet (that lands with the real channels in PRs 2-3): the core
// derives a peer identity from the dialed link's remoteAddress (nodeId = remoteAddress,
// incarnation = '0'). The test's REMOTE mirrors that derivation so byte-identical send and
// source-match assertions hold.
const REMOTE = createRuntimeNodeIdentity({
  nodeAddress: 'node-b',
  nodeId: 'node-b',
  incarnation: '0',
});

function userMessage(type: string): ActorMessage {
  return { type, _timestamp: 1, _version: '1.0.0' } as ActorMessage;
}

function inboundFrame(sequence: number, message: ActorMessage): RuntimeTransportFrame {
  // A frame the peer (node-b) sends to us (node-a): source = peer, destination = local.
  return createRuntimeTransportFrame({
    source: REMOTE,
    destination: LOCAL,
    sequence,
    message,
    now: () => new Date(0),
  });
}

interface Harness {
  core: TransportCore;
  link: FakePeerLink;
  channel: FakeTransportChannel;
  timers: FakeTimers;
  telemetry: RuntimeTransportTelemetryEvent[];
  onListenerError: ReturnType<typeof vi.fn>;
}

async function makeConnectedHarness(
  options: {
    link?: FakePeerLink;
    ackTimeoutMs?: number;
    maxAckRetries?: number;
    heartbeatIntervalMs?: number;
    heartbeatTimeoutMs?: number;
    outboundQueueLimit?: number;
    maxFrameBytes?: number;
    idempotencyProvider?: {
      claim: (
        input: RuntimeTransportIdempotencyClaimInput
      ) => RuntimeTransportIdempotencyClaimResult;
    };
  } = {}
): Promise<Harness> {
  const link = options.link ?? new FakePeerLink(REMOTE.nodeAddress);
  const channel = new FakeTransportChannel(() => ({ ok: true, link }));
  const timers = new FakeTimers();
  const telemetry: RuntimeTransportTelemetryEvent[] = [];
  const onListenerError = vi.fn();

  const core = new TransportCore({
    identity: LOCAL,
    channel,
    clock: () => timers.now(),
    timers,
    telemetry: (event) => telemetry.push(event),
    onListenerError,
    ...(options.ackTimeoutMs !== undefined ? { ackTimeoutMs: options.ackTimeoutMs } : {}),
    ...(options.maxAckRetries !== undefined ? { maxAckRetries: options.maxAckRetries } : {}),
    ...(options.heartbeatIntervalMs !== undefined
      ? { heartbeatIntervalMs: options.heartbeatIntervalMs }
      : { heartbeatIntervalMs: 0 }),
    ...(options.heartbeatTimeoutMs !== undefined
      ? { heartbeatTimeoutMs: options.heartbeatTimeoutMs }
      : {}),
    ...(options.outboundQueueLimit !== undefined
      ? { outboundQueueLimit: options.outboundQueueLimit }
      : {}),
    ...(options.maxFrameBytes !== undefined ? { maxFrameBytes: options.maxFrameBytes } : {}),
    ...(options.idempotencyProvider ? { idempotencyProvider: options.idempotencyProvider } : {}),
  });

  await core.start();
  await core.connect(REMOTE.nodeAddress);

  return { core, link, channel, timers, telemetry, onListenerError };
}

// =========================================================================================

describe('TransportCore — send pipeline (case 4)', () => {
  it('builds a byte-identical frame and the link receives exactly one serialized payload', async () => {
    const { core, link } = await makeConnectedHarness();

    await core.send(REMOTE.nodeAddress, userMessage('PING'));

    expect(link.sent).toHaveLength(1);
    const expectedFrame = createRuntimeTransportFrame({
      source: LOCAL,
      destination: REMOTE,
      sequence: 1,
      message: userMessage('PING'),
      now: () => new Date(0),
    });
    expect(link.sent[0]).toBe(JSON.stringify(expectedFrame));
    expect(core.getPeerStats(REMOTE.nodeAddress)?.lastSentSequence).toBe(1);
  });
});

describe('TransportCore — peer identity collisions', () => {
  it('rejects a second link for the same node address with a different node id', async () => {
    const channel = new FakeTransportChannel(() => ({ ok: false, reason: 'unused' }));
    const timers = new FakeTimers();
    const core = new TransportCore({
      identity: LOCAL,
      channel,
      clock: () => timers.now(),
      timers,
      heartbeatIntervalMs: 0,
    });

    await core.start();

    const firstLink = new FakePeerLink('node-b', {
      identity: {
        nodeAddress: 'node-b',
        nodeId: 'stable-node-b',
        incarnation: 'node-b-boot-1',
      },
    });
    channel.accept(firstLink);

    const conflictingLink = new FakePeerLink('node-b', {
      identity: {
        nodeAddress: 'node-b',
        nodeId: 'different-node-b',
        incarnation: 'node-b-boot-conflict',
      },
    });
    channel.accept(conflictingLink);

    expect(conflictingLink.closeCount).toBe(1);
    expect(firstLink.isOpen).toBe(true);
    expect(core.getPeerStats('node-b')).toMatchObject({
      state: 'connected',
      identity: { nodeId: 'stable-node-b', incarnation: 'node-b-boot-1' },
    });
  });

  it('rejects an outbound connection when the same node address has a different node id', async () => {
    const firstLink = new FakePeerLink('node-b', {
      identity: {
        nodeAddress: 'node-b',
        nodeId: 'stable-node-b',
        incarnation: 'node-b-boot-1',
      },
    });
    const conflictingLink = new FakePeerLink('node-b', {
      identity: {
        nodeAddress: 'node-b',
        nodeId: 'different-node-b',
        incarnation: 'node-b-boot-conflict',
      },
    });
    const dialedLinks = [firstLink, conflictingLink];
    const channel = new FakeTransportChannel(() => {
      const link = dialedLinks.shift();
      return link ? { ok: true, link } : { ok: false, reason: 'unexpected dial' };
    });
    const timers = new FakeTimers();
    const core = new TransportCore({
      identity: LOCAL,
      channel,
      clock: () => timers.now(),
      timers,
      heartbeatIntervalMs: 0,
    });

    await core.start();
    await core.connect('node-b');
    firstLink.close();

    await expect(core.connect('node-b')).rejects.toThrow(
      /existing nodeId=stable-node-b, incoming nodeId=different-node-b/
    );

    expect(channel.dialCount).toBe(2);
    expect(dialedLinks).toHaveLength(0);
    expect(conflictingLink.closeCount).toBe(1);
    expect(core.getPeerStats('node-b')).toMatchObject({
      state: 'rejected',
      identity: { nodeId: 'stable-node-b', incarnation: 'node-b-boot-1' },
    });
  });
});

describe('TransportCore — subscribe / unsubscribe (case 5)', () => {
  it('delivers { source, message } and stops after unsubscribe', async () => {
    const { core, link } = await makeConnectedHarness();
    const received: Array<{ source: string; message: ActorMessage }> = [];
    const unsubscribe = core.subscribe((event) => received.push(event));

    link.deliver(inboundFrame(1, userMessage('HELLO')));
    await Promise.resolve();

    expect(received).toHaveLength(1);
    expect(received[0]?.source).toBe(REMOTE.nodeAddress);
    expect(received[0]?.message.type).toBe('HELLO');

    unsubscribe();
    link.deliver(inboundFrame(2, userMessage('WORLD')));
    await Promise.resolve();
    expect(received).toHaveLength(1);
  });
});

describe('TransportCore — safeDispatch sync-throw isolation (case 6)', () => {
  it('isolates a throwing subscriber from a healthy one and records the error', async () => {
    const { core, link, onListenerError } = await makeConnectedHarness();
    const received: string[] = [];
    core.subscribe(() => {
      throw new Error('subscriber boom');
    });
    core.subscribe((event) => {
      received.push(event.message.type);
    });

    expect(() => link.deliver(inboundFrame(1, userMessage('EVENT')))).not.toThrow();
    await Promise.resolve();

    expect(received).toEqual(['EVENT']);
    expect(onListenerError).toHaveBeenCalledTimes(1);
  });
});

describe('TransportCore — safeDispatch async-reject isolation (case 7, PR#27 root cause)', () => {
  it('isolates an async-rejecting subscriber and routes the rejection to onError', async () => {
    const { core, link, onListenerError } = await makeConnectedHarness();
    const received: string[] = [];
    core.subscribe(() => Promise.reject(new Error('async subscriber boom')));
    core.subscribe((event) => {
      received.push(event.message.type);
    });

    link.deliver(inboundFrame(1, userMessage('EVENT')));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(received).toEqual(['EVENT']);
    expect(onListenerError).toHaveBeenCalledTimes(1);
  });
});

describe('TransportCore — ack retry (cases 8-9)', () => {
  it('resends a retryable frame after the ack timeout and clears on ack', async () => {
    const { core, link, timers } = await makeConnectedHarness({
      ackTimeoutMs: 1000,
      maxAckRetries: 2,
    });

    await core.send(REMOTE.nodeAddress, userMessage('__runtime.ping'));
    expect(link.sent).toHaveLength(1);

    timers.advance(1000);
    expect(link.sent).toHaveLength(2); // resent
    expect(core.getStats().framesRetried).toBe(1);

    // Deliver the ack for the frame -> no further resend, framesAcked increments.
    const sentFrame = JSON.parse(link.sent[0] as string) as RuntimeTransportFrame;
    link.deliver(
      createRuntimeTransportAckFrame(
        REMOTE,
        LOCAL,
        sentFrame.messageId,
        sentFrame.sequence,
        () => new Date(0)
      )
    );
    await Promise.resolve();

    expect(core.getStats().framesAcked).toBe(1);
    timers.advance(5000);
    expect(link.sent).toHaveLength(2); // no more resends
  });

  it('gives up after maxAckRetries (exhaustion)', async () => {
    const { core, link, timers } = await makeConnectedHarness({
      ackTimeoutMs: 1000,
      maxAckRetries: 2,
    });

    await core.send(REMOTE.nodeAddress, userMessage('__runtime.ping'));
    timers.advance(1000); // retry 1
    timers.advance(1000); // retry 2
    timers.advance(1000); // exhausted

    expect(core.getStats().retryExhaustedCount).toBe(1);
    const sentBefore = link.sent.length;
    timers.advance(5000);
    expect(link.sent).toHaveLength(sentBefore); // no further resend
  });
});

describe('TransportCore — backpressure drop (case 10)', () => {
  it('rejects the send and records the drop once the queue is full', async () => {
    const link = new FakePeerLink(REMOTE.nodeAddress);
    const { core, telemetry } = await makeConnectedHarness({ link, outboundQueueLimit: 1 });
    link.isOpen = false; // stall the flush so the queue accumulates

    // First send fills the queue to the limit; its promise stays pending (flush stalled)
    // until cleanup rejects it — do not await it here.
    const first = core.send(REMOTE.nodeAddress, userMessage('A'));
    first.catch(() => undefined);
    await expect(core.send(REMOTE.nodeAddress, userMessage('B'))).rejects.toThrow();

    expect(core.getStats().outboundFramesDropped).toBe(1);
    expect(core.getStats().backpressureDropCount).toBe(1);
    expect(telemetry.some((event) => event.type === 'backpressure.applied')).toBe(true);
  });

  it('rejects an oversized runtime frame before enqueueing or sending it', async () => {
    const largeMessage = userMessage('LARGE_CONTEXT');
    const frame = createRuntimeTransportFrame({
      source: LOCAL,
      destination: REMOTE,
      sequence: 1,
      message: largeMessage,
      now: () => new Date(0),
    });
    const frameBytes = measureRuntimeTransportFrameBytes(frame);
    const { core, link, telemetry } = await makeConnectedHarness({
      maxFrameBytes: frameBytes - 1,
    });

    await expect(core.send(REMOTE.nodeAddress, largeMessage)).rejects.toThrow(
      `Runtime transport frame is ${frameBytes} bytes, exceeding the configured maxFrameBytes of ${
        frameBytes - 1
      }. Externalize large blobs and send artifact references instead.`
    );

    expect(link.sent).toHaveLength(0);
    expect(core.getStats()).toMatchObject({
      outboundQueueDepth: 0,
      outboundFramesDropped: 1,
      validationFramesDropped: 1,
    });
    expect(telemetry).toContainEqual(
      expect.objectContaining({
        type: 'frame.dropped',
        peerNodeAddress: REMOTE.nodeAddress,
        messageType: largeMessage.type,
        dropCode: 'payload_too_large',
        frameBytes,
        maxFrameBytes: frameBytes - 1,
      })
    );
  });
});

describe('TransportCore — queue drain / ordering (case 11)', () => {
  it('flushes queued frames in FIFO order when the link opens', async () => {
    const link = new FakePeerLink(REMOTE.nodeAddress);
    const { core } = await makeConnectedHarness({ link, outboundQueueLimit: 10 });
    link.isOpen = false;

    const p1 = core.send(REMOTE.nodeAddress, userMessage('M1'));
    const p2 = core.send(REMOTE.nodeAddress, userMessage('M2'));
    expect(link.sent).toHaveLength(0);

    link.isOpen = true;
    core.flushPeer(REMOTE.nodeAddress);
    await Promise.all([p1, p2]);

    expect(link.sent).toHaveLength(2);
    const f1 = JSON.parse(link.sent[0] as string) as RuntimeTransportFrame;
    const f2 = JSON.parse(link.sent[1] as string) as RuntimeTransportFrame;
    expect(f1.message.type).toBe('M1');
    expect(f2.message.type).toBe('M2');
  });
});

describe('TransportCore — heartbeat (case 12)', () => {
  it('pings on the interval then closes the peer on timeout (JSON fallback)', async () => {
    const { core, link, timers } = await makeConnectedHarness({
      heartbeatIntervalMs: 1000,
      heartbeatTimeoutMs: 2000,
    });

    const sentBefore = link.sent.length;
    timers.advance(1000); // interval fires -> ping sent then timeout armed
    expect(link.sent.length).toBe(sentBefore + 1);
    const ping = JSON.parse(link.sent[link.sent.length - 1] as string);
    expect(ping.type).toBe('runtime.transport.ping');

    timers.advance(2000); // no alive signal -> timeout fires
    expect(core.getStats().heartbeatTimeoutCount).toBe(1);
    expect(core.isConnected(REMOTE.nodeAddress)).toBe(false);
  });

  it('uses the native heartbeat hook when present and stays alive on a pong', async () => {
    const heartbeat = new FakeNativeHeartbeat();
    const link = new FakePeerLink(REMOTE.nodeAddress, { heartbeat });
    const { core, timers } = await makeConnectedHarness({
      link,
      heartbeatIntervalMs: 1000,
      heartbeatTimeoutMs: 2000,
    });

    timers.advance(1000); // native ping at t=1000, deadline armed for t=3000
    expect(heartbeat.pingCount).toBe(1);

    timers.advanceClockOnly(500); // t=1500, still before the deadline
    heartbeat.signalAlive(); // peer proves alive -> lastSeen=1500, deadline cleared
    timers.advance(500); // t=2000, before the next deadline -> stays alive

    expect(core.getStats().heartbeatTimeoutCount).toBe(0);
    expect(core.isConnected(REMOTE.nodeAddress)).toBe(true);
  });
});

describe('TransportCore — idempotency dedup (case 13)', () => {
  it('accepts the first frame, dedups the second, acks both', async () => {
    const { core, link } = await makeConnectedHarness();
    const received: string[] = [];
    core.subscribe((event) => received.push(event.message.type));

    const frame = inboundFrame(1, userMessage('ONCE'));
    link.deliver(frame);
    await Promise.resolve();
    link.deliver(frame);
    await Promise.resolve();

    expect(received).toEqual(['ONCE']);
    expect(core.getStats().duplicateFramesDropped).toBe(1);
    // Both deliveries send an ack back to the peer.
    const acks = link.sent.filter((p) => {
      const parsed = JSON.parse(p as string);
      return parsed.type === 'runtime.transport.ack';
    });
    expect(acks).toHaveLength(2);
  });
});

describe('TransportCore — stats projection immutability (case 14)', () => {
  it('returns a clone that cannot mutate internal state', async () => {
    const { core } = await makeConnectedHarness();
    await core.send(REMOTE.nodeAddress, userMessage('X'));

    const snapshot = core.getStats();
    snapshot.framesSent = 999;
    snapshot.peers[REMOTE.nodeAddress].framesSent = 999;

    expect(core.getStats().framesSent).toBe(1);
    expect(core.getPeerStats(REMOTE.nodeAddress)?.framesSent).toBe(1);
  });
});

describe('TransportCore — no leaked timers after stop (case 15)', () => {
  it('clears every interval/timeout on stop', async () => {
    const { core, timers } = await makeConnectedHarness({
      ackTimeoutMs: 1000,
      maxAckRetries: 2,
      heartbeatIntervalMs: 1000,
      heartbeatTimeoutMs: 2000,
    });
    await core.send(REMOTE.nodeAddress, userMessage('__runtime.ping'));

    expect(timers.registeredCount).toBeGreaterThan(0);
    await core.stop();
    expect(timers.registeredCount).toBe(0);
  });
});

describe('TransportCore — dial reject is a fact, not a throw (case 16)', () => {
  it('records handshake-reject telemetry and rejects connect without a thrown control-flow error', async () => {
    const channel = new FakeTransportChannel(() => ({ ok: false, reason: 'peer unreachable' }));
    const telemetry: RuntimeTransportTelemetryEvent[] = [];
    const core = new TransportCore({
      identity: LOCAL,
      channel,
      clock: () => new Date(0),
      timers: new FakeTimers(),
      telemetry: (event) => telemetry.push(event),
    });
    await core.start();

    await expect(core.connect(REMOTE.nodeAddress)).rejects.toThrow(/peer unreachable/);
    expect(telemetry.some((event) => event.type === 'handshake.rejected')).toBe(true);
    expect(core.isConnected(REMOTE.nodeAddress)).toBe(false);
  });
});

describe('TransportCore — close idempotency (case 17)', () => {
  it('disconnect twice is a no-op and the link close never throws', async () => {
    const { core, link } = await makeConnectedHarness();

    await core.disconnect(REMOTE.nodeAddress);
    await expect(core.disconnect(REMOTE.nodeAddress)).resolves.toBeUndefined();
    expect(link.closeCount).toBeGreaterThanOrEqual(1);
    expect(core.isConnected(REMOTE.nodeAddress)).toBe(false);
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
});
