// Functional core (no I/O, no clock, no timers, no shell imports — machine-enforced via
// .fas-config.json behaviorBoundaries.functionalCore). This module owns the adapter
// CONTRACT a new transport implements (TransportChannel / PeerLink) plus the pure
// safeDispatchListener isolation helper. Types are contracts, not implementations; the
// only runtime export is a pure function whose sole effect is the injected onError.

import type { RuntimeNodeIdentity } from '../runtime-transport-contract.js';

/**
 * One live raw bidirectional byte/JSON channel to a single peer. The core owns all
 * reliability; a PeerLink only moves opaque payloads and reports raw liveness.
 */
export interface PeerLink {
  /** Stable address of the remote endpoint (the peer's nodeAddress once known). */
  readonly remoteAddress: string;
  /**
   * Send one already-serialized frame. Resolves when handed to the wire (or rejects on
   * a hard channel error). The core decides JSON vs binary by constructing the frame;
   * the link transmits it verbatim — wire format stays byte-identical to today.
   */
  send(payload: unknown): Promise<void>;
  /**
   * Begin delivering inbound payloads and lifecycle facts to the core. Idempotent.
   * Returns an unlisten function. The core subscribes exactly once per link.
   */
  receive(sink: PeerLinkSink): () => void;
  /** Close the underlying medium. Idempotent; must never throw (return a fact, not an error). */
  close(): void;
  /** True while the medium can accept sends right now (e.g. ws.readyState === OPEN). */
  readonly isOpen: boolean;
  /**
   * Optional native liveness hook. If present, the core uses it instead of JSON ping/pong
   * (node ws native ping). If absent, the core falls back to JSON heartbeat frames (browser).
   */
  readonly heartbeat?: PeerLinkHeartbeat;
  /**
   * The fully-handshaked peer identity, when the channel completed the handshake before
   * surfacing the link (node ws dial/listen exchange the hello/accept identities). When
   * present the core registers the peer with this exact identity so inbound frame
   * source-matching and getPeerStats() reflect the real nodeId/incarnation. When absent
   * the core derives a placeholder identity from {@link remoteAddress} (the address-only
   * media path).
   */
  readonly identity?: RuntimeNodeIdentity;
}

/** Facts a PeerLink reports up to the core. Adapters return facts; they never throw at the core. */
export interface PeerLinkSink {
  /** A raw inbound payload arrived (already parsed from the wire, or raw for the core to parse). */
  onPayload(payload: unknown): void;
  /** The medium closed for any reason (remote close, error, transport-level failure). */
  onClosed(reason?: string): void;
}

/** Native medium-level heartbeat, when the medium provides one (node ws ping/pong). */
export interface PeerLinkHeartbeat {
  /** Send a native ping. The core arms its own timeout and calls this on its interval. */
  ping(): void;
  /** Register for native pong / liveness signals; calls back when the peer proves alive. */
  onAlive(listener: () => void): () => void;
}

/**
 * A TransportChannel knows how to dial a peer (client side) and, optionally, how to
 * accept inbound peers (server side). This is the entire surface a new transport supplies.
 */
export interface TransportChannel {
  /**
   * Dial a peer by address, returning a not-yet-handshaked raw link. Used by connect().
   * Returns a fact-shaped result so the core records handshake-reject telemetry instead
   * of catching thrown control-flow.
   */
  dial(remoteAddress: string): Promise<DialResult>;
  /**
   * Optional: accept inbound connections (multi-peer servers). Wires onPeer for each raw
   * link; the core then runs the inbound handshake. Mirrors node listen() today.
   */
  listen?(onPeer: (link: PeerLink) => void): Promise<TransportListenHandle>;
  /** Optional teardown of medium-wide resources (close the WebSocketServer). */
  closeServer?(): Promise<void>;
}

export type DialResult =
  | { readonly ok: true; readonly link: PeerLink }
  | { readonly ok: false; readonly reason: string };

export interface TransportListenHandle {
  /** The bound URL/address, when the medium exposes one (node getListeningUrl). */
  readonly url?: string;
  close(): Promise<void>;
}

/**
 * Invoke one listener so neither a synchronous throw nor a rejected promise escapes or
 * blocks sibling listeners. Pure isolation wrapper: no I/O of its own, deterministic —
 * the only effect is the caller-supplied onError. It must NOT re-throw.
 *
 * This is the permanent PR#27-class fix (architecture §3): the four unguarded dispatch
 * loops (browser/node ws transports, in-memory transport, message-port transport) route
 * every listener call through here so one async-rejecting or throwing subscriber can no
 * longer starve later subscribers or leak an unhandled rejection.
 */
export function safeDispatchListener<E>(
  listener: (event: E) => unknown,
  event: E,
  onError: (error: unknown) => void
): void {
  let result: unknown;
  try {
    result = listener(event); // contain synchronous throws
  } catch (error) {
    onError(error);
    return;
  }

  if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
    Promise.resolve(result).catch(onError); // contain async rejections
  }
}
