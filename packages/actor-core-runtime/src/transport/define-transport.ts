// Imperative shell (composition root, behaviorBoundaries.shell). The public authoring
// surface: wires an author medium -> fromDuplex/PeerLink -> TransportCore into a
// MessageTransport factory. No reliability logic of its own — every concern lives in
// TransportCore.
//
// PR-1 scope guard (engineering brief §1.4 / §6): this module + its unit tests land here,
// but it is NOT yet re-exported from index.ts/browser.ts/node.ts. The public re-export
// ships in a later PR alongside the websocket-alias re-authoring, keeping PR 1 strictly
// additive/internal. TransportCore/TransportChannel/PeerLink are never publicly exported.

import type { MessageTransport } from '../actor-system.js';
import type { RuntimeTransportAuthProvider } from '../runtime-auth.js';
import {
  createRuntimeNodeIdentity,
  createRuntimeTransportHandshakeHello,
  type RuntimeNodeIdentity,
  type RuntimeTransportHandshake,
  validateRuntimeTransportHandshake,
} from '../runtime-transport-contract.js';
import type { RuntimeTransportIdempotencyProvider } from '../runtime-transport-idempotency.js';
import type {
  RuntimeTransportPeerStats,
  RuntimeTransportStats,
  RuntimeTransportTelemetryObserver,
} from '../runtime-transport-telemetry.js';
import type {
  DialResult,
  PeerLink,
  PeerLinkSink,
  TransportChannel,
  TransportListenHandle,
} from './transport-channel.js';
import { TransportCore, type TransportTimers } from './transport-core.js';

/**
 * What a defineTransport factory returns: the MessageTransport surface plus the
 * lifecycle/observability methods the runtime host drives. TransportCore (internal) is the
 * concrete implementation; it is never exported as a named type.
 */
export interface TransportInstance extends MessageTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStats(): RuntimeTransportStats;
  getPeerStats(nodeAddress: string): RuntimeTransportPeerStats | undefined;
}

/** The single field of an inbound message a duplex surfaces that the core cares about. */
export interface DuplexMessageEvent {
  readonly data: unknown;
}

/**
 * A duplex any author can hand to fromDuplex: postMessage out, message in, close.
 *
 * The `addEventListener`/`removeEventListener` members use the standard `EventTarget`
 * signatures so a real EventTarget medium (a Node worker_threads `MessagePort`, a DOM
 * `WebSocket`, a `BroadcastChannel`) is structurally assignable WITHOUT a wrapper — that is
 * what lets `defineTransport(({ port }) => port)` be one line. Media that only expose the
 * `onmessage` setter (the simplest in-memory pairs) satisfy the duplex through that field.
 * fromDuplex prefers `addEventListener` when present and reads `event.data` off the inbound
 * MessageEvent.
 */
export interface TransportDuplex {
  postMessage(data: unknown): void;
  onmessage?: ((event: DuplexMessageEvent) => void) | null;
  addEventListener?: EventTarget['addEventListener'];
  removeEventListener?: EventTarget['removeEventListener'];
  close?(): void;
}

/** The required identity + optional reliability knobs an author's factory accepts. */
export interface TransportFactoryOptions {
  /**
   * REQUIRED node identity for cross-node transports (directory-collision guard, per the
   * locked decision). `node` is the human node name; `nodeAddress` defaults to it.
   */
  readonly node: string;
  readonly nodeAddress?: string;
  readonly nodeId?: string;
  readonly incarnation?: string;
  readonly capabilities?: readonly string[];
  readonly connectTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
  readonly idempotencyWindowSize?: number;
  readonly ackTimeoutMs?: number;
  readonly maxAckRetries?: number;
  readonly outboundQueueLimit?: number;
  readonly idempotencyProvider?: RuntimeTransportIdempotencyProvider;
  readonly telemetry?: RuntimeTransportTelemetryObserver;
  readonly auth?: RuntimeTransportAuthProvider<{
    readonly source: RuntimeNodeIdentity;
    readonly local: RuntimeNodeIdentity;
  }>;
  readonly clock?: () => Date;
  readonly timers?: TransportTimers;
  readonly onListenerError?: (error: unknown) => void;
}

/**
 * Module-internal observer hook attached to a fromDuplex link so the dial-time hello
 * exchange can read the SAME buffered inbound stream the core later subscribes to —
 * WITHOUT consuming the core's single authoritative `receive` sink. The symbol keeps this
 * off the public PeerLink surface (it is never exported); only this module's `dial` closure
 * uses it. Each parsed inbound payload is offered to the observer; returning true means the
 * observer claimed the frame (the hello), so it is NOT also buffered/delivered to the core.
 */
const OBSERVE_INBOUND = Symbol('fromDuplex.observeInbound');
const SET_IDENTITY = Symbol('fromDuplex.setIdentity');

interface ObservableLink extends PeerLink {
  /** Register a one-shot-style inbound observer. Returns an unobserve function. */
  readonly [OBSERVE_INBOUND]: (observer: (payload: unknown) => boolean) => () => void;
  /**
   * Set the handshaked peer identity on THIS link after the hello resolves, without
   * cloning the object (which would detach the closure-captured open/sink/buffer state).
   * The link's `identity` getter then reflects it so the core takes the handshaked path.
   */
  readonly [SET_IDENTITY]: (identity: RuntimeNodeIdentity) => void;
}

/**
 * Normalize any postMessage/onmessage/close duplex into a PeerLink the core can drive.
 * This is what lets `defineTransport(({ channel }) => new BroadcastChannel(channel))` be
 * one line. The core serializes frames to a string before send (byte-identical wire); the
 * duplex transmits the payload verbatim and surfaces inbound payloads as facts.
 *
 * Two seams make the public one-liner round-trip end to end:
 *  1. Parse-if-string: the core serializes outbound frames to JSON strings, but
 *     handleInboundPayload expects PARSED frame objects. `deliver` JSON-parses inbound
 *     strings (dropping unparseable ones as a fact — no throw, no disconnect) and passes
 *     objects through verbatim.
 *  2. Eager listener + pending buffer (the receive-handoff race): the native `message`
 *     listener is installed immediately here, not lazily in `receive`. Payloads that arrive
 *     before the core subscribes (e.g. the dial-time hello consumer reads first) are pushed
 *     onto a FIFO `pendingInbound` buffer and drained when `receive(sink)` is called, so no
 *     inbound frame is lost between dial and the core's authoritative subscription. The
 *     buffer is unbounded in memory (bounded backpressure is deferred to the follow-up).
 *
 * @param identity Optional fully-handshaked peer identity. When supplied (the dial path sets
 *   it once the peer's hello is validated) the core takes the handshaked path — real
 *   identity, skips the placeholder + auth re-check — so inbound source-matching passes.
 */
export function fromDuplex(
  duplex: TransportDuplex,
  remoteAddress: string,
  identity?: RuntimeNodeIdentity
): PeerLink {
  let open = true;
  let sink: PeerLinkSink | null = null;
  const pendingInbound: unknown[] = [];
  let observer: ((payload: unknown) => boolean) | null = null;
  let peerIdentity: RuntimeNodeIdentity | undefined = identity;

  const deliver = (event: DuplexMessageEvent): void => {
    let parsed: unknown = event.data;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        // Unparseable inbound bytes are a fact, not an error: drop the frame without
        // calling the sink or disconnecting (errors-as-values).
        return;
      }
    }
    // Offer the parsed frame to the dial-time hello observer first. If it claims the frame
    // (the hello it was waiting for), do NOT also buffer/deliver it to the core's sink.
    if (observer?.(parsed)) {
      return;
    }
    if (sink) {
      sink.onPayload(parsed);
    } else {
      pendingInbound.push(parsed);
    }
  };

  // Attach the native listener ONCE, eagerly, so pre-subscribe payloads are captured. The
  // EventTarget addEventListener types the listener as (event: Event) => void, but every
  // 'message' event a duplex emits is a MessageEvent carrying `.data` — cast at this single
  // boundary so deliver stays typed against the duplex contract (DuplexMessageEvent).
  let removeNativeListener: () => void;
  if (duplex.addEventListener) {
    const nativeListener = deliver as unknown as EventListener;
    duplex.addEventListener('message', nativeListener);
    removeNativeListener = () => duplex.removeEventListener?.('message', nativeListener);
  } else {
    duplex.onmessage = deliver;
    removeNativeListener = () => {
      if (duplex.onmessage === deliver) {
        duplex.onmessage = null;
      }
    };
  }

  // CRITICAL: build the single returned object literal so the closure-captured mutable state
  // (open / sink / pendingInbound / observer / peerIdentity) stays attached. Spreading or
  // cloning to add identity would detach this state and break the link; instead `identity`
  // is a getter over the closure variable, settable post-construction via SET_IDENTITY once
  // the dial-time hello resolves.
  const link: ObservableLink = {
    remoteAddress,
    get identity(): RuntimeNodeIdentity | undefined {
      return peerIdentity;
    },
    get isOpen(): boolean {
      return open;
    },
    send(payload: unknown): Promise<void> {
      duplex.postMessage(payload);
      return Promise.resolve();
    },
    receive(nextSink: PeerLinkSink): () => void {
      sink = nextSink;
      // Drain anything buffered before the core subscribed, in FIFO order.
      while (pendingInbound.length > 0) {
        const next = pendingInbound.shift();
        sink.onPayload(next);
      }
      return () => {
        sink = null;
      };
    },
    [OBSERVE_INBOUND](nextObserver: (payload: unknown) => boolean): () => void {
      observer = nextObserver;
      return () => {
        if (observer === nextObserver) {
          observer = null;
        }
      };
    },
    [SET_IDENTITY](nextIdentity: RuntimeNodeIdentity): void {
      peerIdentity = nextIdentity;
    },
    close(): void {
      // Idempotent; never throws (errors-as-values).
      if (!open) {
        return;
      }
      open = false;
      removeNativeListener();
      removeNativeListener = () => undefined;
      sink = null;
      observer = null;
      pendingInbound.length = 0;
      try {
        duplex.close?.();
      } catch {
        // A medium that throws on close is treated as already-closed — we report the fact
        // (open = false) rather than propagating an expected teardown error.
      }
    },
  };

  return link;
}

function buildIdentity(options: TransportFactoryOptions): RuntimeNodeIdentity {
  if (!options.node) {
    throw new Error(
      'defineTransport requires a `node` identity for cross-node transports (directory-collision guard).'
    );
  }
  const nodeAddress = options.nodeAddress ?? options.node;
  return createRuntimeNodeIdentity({
    nodeAddress,
    nodeId: options.nodeId ?? options.node,
    incarnation: options.incarnation ?? `${Date.now()}`,
    ...(options.capabilities ? { capabilities: options.capabilities } : {}),
  });
}

function buildCore(
  identity: RuntimeNodeIdentity,
  channel: TransportChannel,
  options: TransportFactoryOptions
): TransportCore {
  return new TransportCore({
    identity,
    channel,
    ...(options.connectTimeoutMs !== undefined
      ? { connectTimeoutMs: options.connectTimeoutMs }
      : {}),
    ...(options.heartbeatIntervalMs !== undefined
      ? { heartbeatIntervalMs: options.heartbeatIntervalMs }
      : {}),
    ...(options.heartbeatTimeoutMs !== undefined
      ? { heartbeatTimeoutMs: options.heartbeatTimeoutMs }
      : {}),
    ...(options.idempotencyWindowSize !== undefined
      ? { idempotencyWindowSize: options.idempotencyWindowSize }
      : {}),
    ...(options.ackTimeoutMs !== undefined ? { ackTimeoutMs: options.ackTimeoutMs } : {}),
    ...(options.maxAckRetries !== undefined ? { maxAckRetries: options.maxAckRetries } : {}),
    ...(options.outboundQueueLimit !== undefined
      ? { outboundQueueLimit: options.outboundQueueLimit }
      : {}),
    ...(options.idempotencyProvider ? { idempotencyProvider: options.idempotencyProvider } : {}),
    ...(options.telemetry ? { telemetry: options.telemetry } : {}),
    ...(options.auth ? { auth: options.auth } : {}),
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.timers ? { timers: options.timers } : {}),
    ...(options.onListenerError ? { onListenerError: options.onListenerError } : {}),
  });
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 3000;

/**
 * Default timers for the dial-time hello when the author injects none. This is the
 * composition-root (shell) layer, so binding the real globals here is allowed — and it
 * mirrors the core's own DEFAULT_TIMERS so an author who injects a fake `timers` gets the
 * SAME deterministic port driving both the handshake and the core.
 */
const DEFAULT_DIAL_TIMERS: TransportTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms) as unknown as number,
  clearTimeout: (handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
  setInterval: (callback, ms) => setInterval(callback, ms) as unknown as number,
  clearInterval: (handle) => clearInterval(handle as unknown as ReturnType<typeof setInterval>),
};

function isHandshakeHello(value: unknown): value is RuntimeTransportHandshake & {
  type: 'runtime.handshake.hello';
} {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'runtime.handshake.hello'
  );
}

/**
 * Run the symmetric hello handshake over a fromDuplex link: send our hello, then await the
 * peer's hello off the link's buffered inbound stream (observed WITHOUT claiming the core's
 * single `receive` sink). Returns the validated peer identity as a fact — never throws for
 * an expected failure (timeout / validation reject), so the core surfaces it as the normal
 * connect() rejection. On any failure the link is closed.
 *
 * Failure mode (fact): if the peer never connects/sends hello, this blocks until
 * `connectTimeoutMs` elapses on the INJECTED timers port, then resolves to a reason.
 */
function exchangeHello(
  link: ObservableLink,
  localIdentity: RuntimeNodeIdentity,
  options: { now: () => Date; timers: TransportTimers; timeoutMs: number }
): Promise<{ ok: true; identity: RuntimeNodeIdentity } | { ok: false; reason: string }> {
  return new Promise((resolve) => {
    // A single mutable cleanup bag: `finish` reads its fields at call time (always after each
    // resource is armed below), so the fields are assigned once each but the bag is `const`.
    const cleanup: { timeoutHandle: number | undefined; unobserve: (() => void) | null } = {
      timeoutHandle: undefined,
      unobserve: null,
    };
    let settled = false;

    const finish = (
      result: { ok: true; identity: RuntimeNodeIdentity } | { ok: false; reason: string }
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      options.timers.clearTimeout(cleanup.timeoutHandle);
      cleanup.unobserve?.();
      if (!result.ok) {
        link.close();
      }
      resolve(result);
    };

    // Observe the buffered inbound stream for the FIRST handshake hello. Returning true
    // claims the hello so it is not also delivered to the core's later sink. Non-hello
    // frames are left unclaimed (they fall through to the buffer / core).
    cleanup.unobserve = link[OBSERVE_INBOUND]((payload) => {
      if (!isHandshakeHello(payload)) {
        return false;
      }
      const validation = validateRuntimeTransportHandshake(payload, localIdentity);
      if (!validation.ok) {
        finish({ ok: false, reason: validation.message });
        return true;
      }
      finish({
        ok: true,
        identity: createRuntimeNodeIdentity({
          nodeAddress: payload.source.nodeAddress,
          nodeId: payload.source.nodeId,
          incarnation: payload.source.incarnation,
          ...(payload.source.capabilities ? { capabilities: payload.source.capabilities } : {}),
        }),
      });
      return true;
    });

    // Arm the bounded wait on the INJECTED timers port (never global setTimeout) so an
    // unresponsive peer surfaces as the normal connect() rejection rather than a hang.
    cleanup.timeoutHandle = options.timers.setTimeout(() => {
      finish({ ok: false, reason: 'Runtime handshake hello timeout.' });
    }, options.timeoutMs);

    // Send our hello LAST so the observer/timeout are armed before any synchronous peer
    // reply can land. Match how the core serializes frames (a JSON string on the wire).
    link
      .send(
        JSON.stringify(createRuntimeTransportHandshakeHello(localIdentity, { now: options.now }))
      )
      .catch((error: unknown) => {
        finish({ ok: false, reason: `Runtime handshake hello send failed: ${String(error)}` });
      });
  });
}

/**
 * Public authoring API. The author returns the raw medium (a duplex or a PeerLink);
 * defineTransport wires it through fromDuplex + TransportCore into a MessageTransport
 * factory. The single channel dials the one peer the author's medium describes.
 *
 * SYMMETRIC model: both ends construct the transport and call connect(). Each dial sends a
 * hello and consumes the peer's hello, so the core registers the peer with its REAL
 * identity (not a placeholder) and inbound source-matching passes — with NO core change.
 */
export function defineTransport<TArgs>(
  author: (args: TArgs) => TransportDuplex | PeerLink
): (args: TArgs & TransportFactoryOptions) => TransportInstance {
  return (args: TArgs & TransportFactoryOptions): TransportInstance => {
    const identity = buildIdentity(args);
    const now = args.clock ?? (() => new Date());
    const timers = args.timers ?? DEFAULT_DIAL_TIMERS;
    const timeoutMs = args.connectTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    const channel: TransportChannel = {
      async dial(remoteAddress: string): Promise<DialResult> {
        const medium = author(args);
        // A raw author-supplied PeerLink is returned as-is: it owns its own handshake (e.g.
        // a node ws link surfaces link.identity itself). The hello exchange below applies to
        // the fromDuplex path, where the duplex carries no identity of its own.
        if (isPeerLink(medium)) {
          return { ok: true, link: medium };
        }
        const link = fromDuplex(medium, remoteAddress) as ObservableLink;
        const hello = await exchangeHello(link, identity, { now, timers, timeoutMs });
        if (!hello.ok) {
          return { ok: false, reason: hello.reason };
        }
        // Set the now-known peer identity on the SAME buffered link (no clone, preserving the
        // closure-captured listener/buffer state) so the core takes the handshaked path: real
        // identity, skips the placeholder + auth re-check, and inbound source-matching passes.
        link[SET_IDENTITY](hello.identity);
        return { ok: true, link };
      },
    };
    return buildCore(identity, channel, args);
  };
}

export namespace defineTransport {
  /** Multi-peer servers opt into the richer form (mirrors node listen()). */
  export function server<TArgs>(
    author: (args: TArgs) => {
      listen: (onPeer: (link: PeerLink) => void) => void | Promise<void>;
    }
  ): (args: TArgs & TransportFactoryOptions) => TransportInstance {
    return (args: TArgs & TransportFactoryOptions): TransportInstance => {
      const identity = buildIdentity(args);
      const channel: TransportChannel = {
        dial(remoteAddress: string): Promise<DialResult> {
          return Promise.resolve({
            ok: false,
            reason: `Server transport ${identity.nodeAddress} does not dial ${remoteAddress}; peers connect inbound.`,
          });
        },
        async listen(onPeer: (link: PeerLink) => void): Promise<TransportListenHandle> {
          await author(args).listen(onPeer);
          return {
            close(): Promise<void> {
              return Promise.resolve();
            },
          };
        },
      };
      return buildCore(identity, channel, args);
    };
  }
}

function isPeerLink(value: TransportDuplex | PeerLink): value is PeerLink {
  return (
    typeof (value as PeerLink).send === 'function' &&
    typeof (value as PeerLink).receive === 'function' &&
    typeof (value as PeerLink).remoteAddress === 'string'
  );
}
