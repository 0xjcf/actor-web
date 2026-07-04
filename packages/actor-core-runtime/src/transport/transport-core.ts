// Imperative shell / adapter (behaviorBoundaries.shell). TransportCore IS the
// MessageTransport and owns ALL reliability machinery: subscribe + guarded dispatch,
// send -> frame -> enqueue, outbound queue + backpressure, ack tracking + timeout retry,
// sendAck, heartbeat engine, inbound pipeline, idempotency, stats/telemetry, peer
// lifecycle. Every effect (wire send, timer, clock) enters through an injected port
// (PeerLink, TransportTimers, clock); every decision branch routes through the pure
// transport-reliability deciders so ack-retry and heartbeat-timeout are deterministic.
//
// PR 1 (additive): the core is landed COMPLETE but no production transport routes through
// it yet — it is exercised only by the fake-channel unit tests. The real WebSocket
// channels and the full peer-identity handshake land in PRs 2-3.

import type { ActorMessage, MessageTransport } from '../actor-system.js';
import { type RuntimeTransportAuthProvider, verifyRuntimeAuth } from '../runtime-auth.js';
import {
  createRuntimeNodeIdentity,
  createRuntimeTransportAckFrame,
  createRuntimeTransportFrame,
  createRuntimeTransportHeartbeatPing,
  createRuntimeTransportHeartbeatPong,
  createRuntimeTransportMessageId,
  DEFAULT_RUNTIME_TRANSPORT_MAX_FRAME_BYTES,
  normalizeRuntimeTransportMaxFrameBytes,
  type RuntimeNodeIdentity,
  type RuntimeTransportFrame,
  type RuntimeTransportPayloadValidationResult,
  validateRuntimeTransportAckFrame,
  validateRuntimeTransportFrame,
  validateRuntimeTransportFramePayloadSize,
  validateRuntimeTransportHeartbeatFrame,
} from '../runtime-transport-contract.js';
import {
  claimRuntimeTransportFrameIdempotency,
  createRuntimeTransportIdempotencyFrontCache,
  type RuntimeTransportIdempotencyFrontCache,
  type RuntimeTransportIdempotencyProvider,
} from '../runtime-transport-idempotency.js';
import type {
  RuntimeTransportDropCode,
  RuntimeTransportPeerStats,
  RuntimeTransportStats,
  RuntimeTransportTelemetryEvent,
  RuntimeTransportTelemetryObserver,
} from '../runtime-transport-telemetry.js';
import {
  type PeerLink,
  safeDispatchListener,
  type TransportChannel,
  type TransportListenHandle,
} from './transport-channel.js';
import { resolveAckRetry, resolveBackpressure, resolveHeartbeat } from './transport-reliability.js';

/** Injectable timer port. The shell binds the real globals by default; tests inject a fake. */
export interface TransportTimers {
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(handle: number | undefined): void;
  setInterval(callback: () => void, ms: number): number;
  clearInterval(handle: number | undefined): void;
}

export interface TransportCoreOptions {
  readonly identity: RuntimeNodeIdentity;
  readonly channel: TransportChannel;
  readonly connectTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
  readonly idempotencyWindowSize?: number;
  readonly ackTimeoutMs?: number;
  readonly maxAckRetries?: number;
  readonly outboundQueueLimit?: number;
  readonly maxFrameBytes?: number;
  readonly idempotencyProvider?: RuntimeTransportIdempotencyProvider;
  readonly telemetry?: RuntimeTransportTelemetryObserver;
  readonly auth?: RuntimeTransportAuthProvider<{
    readonly source: RuntimeNodeIdentity;
    readonly local: RuntimeNodeIdentity;
  }>;
  /** Injected for determinism/testability. Defaults bind the real clock/timers. */
  readonly clock?: () => Date;
  readonly timers?: TransportTimers;
  /** Routed every isolated listener error (telemetry/no-op). Defaults to a no-op. */
  readonly onListenerError?: (error: unknown) => void;
}

type PendingAck = {
  frame: RuntimeTransportFrame;
  attempts: number;
  lastSentAtMs: number;
  timer: number | null;
};

type OutboundQueueItem = {
  frame: RuntimeTransportFrame;
  resolve: () => void;
  reject: (error: Error) => void;
  trackAck: boolean;
};

type Peer = {
  link: PeerLink;
  identity: RuntimeNodeIdentity;
  sequence: number;
  lastReceivedSequence: number;
  idempotencyCache: RuntimeTransportIdempotencyFrontCache;
  pendingAcks: Map<string, PendingAck>;
  outboundQueue: OutboundQueueItem[];
  outboundFlushing: boolean;
  lastSeenAt: number;
  heartbeatInterval: number | null;
  heartbeatTimeout: number | null;
  unlistenReceive: (() => void) | null;
  unlistenAlive: (() => void) | null;
  state: 'connecting' | 'connected' | 'disconnecting' | 'disconnected';
};

const DEFAULT_TIMERS: TransportTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms) as unknown as number,
  clearTimeout: (handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
  setInterval: (callback, ms) => setInterval(callback, ms) as unknown as number,
  clearInterval: (handle) => clearInterval(handle as unknown as ReturnType<typeof setInterval>),
};

export class TransportCore implements MessageTransport {
  private readonly listeners = new Set<
    (event: { source: string; message: ActorMessage }) => void
  >();
  private readonly peers = new Map<string, Peer>();
  private readonly identity: RuntimeNodeIdentity;
  private readonly channel: TransportChannel;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly idempotencyWindowSize: number;
  private readonly ackTimeoutMs: number;
  private readonly maxAckRetries: number;
  private readonly outboundQueueLimit: number;
  private readonly maxFrameBytes: number;
  private readonly clock: () => Date;
  private readonly timers: TransportTimers;
  private readonly onListenerError: (error: unknown) => void;
  private readonly stats: RuntimeTransportStats;
  private listenHandle: TransportListenHandle | null = null;

  constructor(private readonly options: TransportCoreOptions) {
    this.identity = options.identity;
    this.channel = options.channel;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? this.heartbeatIntervalMs * 2;
    this.idempotencyWindowSize = options.idempotencyWindowSize ?? 1024;
    this.ackTimeoutMs = options.ackTimeoutMs ?? 1000;
    this.maxAckRetries = options.maxAckRetries ?? 2;
    this.outboundQueueLimit = options.outboundQueueLimit ?? 1024;
    this.maxFrameBytes = normalizeRuntimeTransportMaxFrameBytes(
      options.maxFrameBytes ?? DEFAULT_RUNTIME_TRANSPORT_MAX_FRAME_BYTES
    );
    this.clock = options.clock ?? (() => new Date());
    this.timers = options.timers ?? DEFAULT_TIMERS;
    this.onListenerError = options.onListenerError ?? (() => undefined);
    this.stats = this.createInitialStats();
  }

  // --- lifecycle ------------------------------------------------------------------------

  async start(): Promise<void> {
    // Server media (node ws) accept inbound peers; the channel surfaces each already-
    // handshaked inbound link via onPeer and the core registers it like a dialed peer. The
    // channel owns the raw handshake (so the wire stays byte-identical), then attaches the
    // peer identity to the link. Address-only / client-only channels omit listen entirely.
    if (this.channel.listen && !this.listenHandle) {
      this.listenHandle = await this.channel.listen((link) => {
        this.acceptInboundLink(link);
      });
    }
    if (!this.stats.startedAt) {
      this.stats.startedAt = this.clock().toISOString();
      this.emitTelemetry({ type: 'transport.started' });
    }
  }

  async stop(): Promise<void> {
    for (const [nodeAddress, peer] of Array.from(this.peers.entries())) {
      this.closePeer(nodeAddress, peer, false);
    }
    const handle = this.listenHandle;
    this.listenHandle = null;
    if (handle) {
      await handle.close();
    }
    if (this.channel.closeServer) {
      await this.channel.closeServer();
    }
    this.stats.stoppedAt = this.clock().toISOString();
    this.emitTelemetry({ type: 'transport.stopped' });
  }

  /** The bound listener URL when the channel runs a server (node ws), else null. */
  getListeningUrl(): string | null {
    return this.listenHandle?.url ?? null;
  }

  getStats(): RuntimeTransportStats {
    return this.cloneStats();
  }

  getPeerStats(nodeAddress: string): RuntimeTransportPeerStats | undefined {
    const stats = this.stats.peers[nodeAddress];
    return stats ? this.clonePeerStats(stats) : undefined;
  }

  /**
   * Record an inbound handshake rejection surfaced by a server channel (node ws listen()).
   * The channel completes the raw inbound handshake and verifies auth before calling
   * onPeer; when it rejects an inbound peer (bad/missing shared secret, malformed handshake,
   * identity conflict) it never reaches onPeer, so the core would otherwise never see the
   * rejection. This re-wires the pre-core node acceptInboundConnection -> recordAuthRejected
   * + recordHandshakeRejected path so getPeerStats()/getStats() reflect the rejection
   * (state='rejected', rejectedReason, handshakeRejectedCount) and the same auth.rejected /
   * handshake.rejected / peer.rejected telemetry is emitted on the server side.
   *
   * Errors-as-values: the channel reports the rejection as a fact through this method instead
   * of letting a rejection escape the inbound handshake promise (the PR#27-class hazard).
   * A peer that is currently connected is never clobbered to 'rejected' (mirrors the pre-core
   * inbound guard for a conflicting different-nodeId join).
   */
  recordInboundHandshakeRejection(
    nodeAddress: string,
    reason: string,
    options: { readonly auth: boolean } = { auth: false }
  ): void {
    if (this.isConnected(nodeAddress)) {
      return;
    }
    if (options.auth) {
      this.recordAuthRejected(nodeAddress, reason);
    }
    this.recordHandshakeRejected(nodeAddress, reason);
  }

  // --- MessageTransport surface ---------------------------------------------------------

  async send(destination: string, message: ActorMessage): Promise<void> {
    const peer = this.peers.get(destination);
    if (!peer) {
      throw new Error(`Transport ${this.identity.nodeAddress} is not connected to ${destination}`);
    }

    const sequence = peer.sequence + 1;
    const frame = createRuntimeTransportFrame({
      source: this.identity,
      destination: peer.identity,
      messageId: createRuntimeTransportMessageId({
        source: this.identity,
        destination: peer.identity,
        sequence,
      }),
      sequence,
      message,
      now: this.clock,
    });
    const payloadValidation = validateRuntimeTransportFramePayloadSize(frame, {
      maxFrameBytes: this.maxFrameBytes,
    });
    if (!payloadValidation.ok) {
      this.recordOutboundFramePayloadTooLarge(destination, peer, frame, payloadValidation);
      throw new Error(payloadValidation.message);
    }

    peer.sequence = sequence;
    await this.enqueueFrame(destination, peer, frame, true);
  }

  subscribe(listener: (event: { source: string; message: ActorMessage }) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async connect(address: string): Promise<void> {
    if (address === this.identity.nodeAddress) {
      throw new Error('Runtime transport cannot connect a node to itself.');
    }

    const existing = this.peers.get(address);
    if (existing?.link.isOpen) {
      return;
    }

    this.setPeerStats(address, { state: 'connecting' });
    this.emitTelemetry({ type: 'peer.connecting', peerNodeAddress: address });

    // dial returns a DialResult FACT — no thrown handshake control-flow to catch.
    const result = await this.channel.dial(address);
    if (!result.ok) {
      this.recordHandshakeRejected(address, result.reason);
      throw new Error(`Runtime handshake rejected: ${result.reason}`);
    }

    // The channel surfaces the fully-handshaked peer identity when it completed the
    // handshake before returning the link (node ws dial exchanges hello/accept identities
    // and verifies auth itself). When it does not (address-only media), the core derives a
    // placeholder identity from the dialed link's address. The auth provider, when present,
    // still gets a chance to reject the derived peer in the placeholder path.
    const handshaked = Boolean(result.link.identity);
    // The link surfaces a structural PeerIdentity (nodeAddress/nodeId/incarnation); the core
    // normalizes it into a full RuntimeNodeIdentity (filling protocolVersion) so peer
    // registration and downstream frame source-matching keep the complete handshake identity.
    const peerIdentity = result.link.identity
      ? createRuntimeNodeIdentity({
          nodeAddress: result.link.identity.nodeAddress,
          nodeId: result.link.identity.nodeId,
          incarnation: result.link.identity.incarnation,
        })
      : createRuntimeNodeIdentity({
          nodeAddress: result.link.remoteAddress,
          nodeId: result.link.remoteAddress,
          incarnation: '0',
        });

    if (!handshaked) {
      const auth = await verifyRuntimeAuth(this.options.auth, {
        source: peerIdentity,
        local: this.identity,
      });
      if (!auth.ok) {
        result.link.close();
        this.recordAuthRejected(address, auth.reason);
        throw new Error(`Runtime handshake rejected: ${auth.reason}`);
      }
    }

    this.registerPeer(result.link, peerIdentity);
  }

  async disconnect(address: string): Promise<void> {
    const peer = this.peers.get(address);
    if (!peer) {
      return;
    }
    this.closePeer(address, peer, true);
  }

  getConnectedNodes(): string[] {
    return Array.from(this.peers.entries())
      .filter(([, peer]) => peer.link.isOpen && peer.state === 'connected')
      .map(([nodeAddress]) => nodeAddress);
  }

  isConnected(address: string): boolean {
    const peer = this.peers.get(address);
    return Boolean(peer?.link.isOpen && peer.state === 'connected');
  }

  /**
   * Flush a peer's outbound queue. Public so the per-medium channel (and PR-1 fake link)
   * can re-drive the queue when its underlying link transitions to open.
   */
  flushPeer(address: string): void {
    const peer = this.peers.get(address);
    if (peer) {
      this.flushOutboundQueue(address, peer);
    }
  }

  // --- peer lifecycle -------------------------------------------------------------------

  /**
   * Register an inbound peer surfaced by channel.listen(). The channel completed the raw
   * inbound handshake (hello/accept + auth) before calling onPeer and attached the peer
   * identity to the link, so the core registers it directly — mirroring node's
   * acceptInboundConnection -> registerPeer path. A link without an identity is ignored
   * (the channel must hand a handshaked inbound link).
   */
  private acceptInboundLink(link: PeerLink): void {
    if (!link.identity) {
      link.close();
      return;
    }
    // Normalize the structural PeerIdentity surfaced by the link into a full
    // RuntimeNodeIdentity (filling protocolVersion) so the registered peer carries the
    // complete handshake identity used for inbound frame source-matching and stats.
    this.registerPeer(
      link,
      createRuntimeNodeIdentity({
        nodeAddress: link.identity.nodeAddress,
        nodeId: link.identity.nodeId,
        incarnation: link.identity.incarnation,
      })
    );
  }

  private registerPeer(link: PeerLink, identity: RuntimeNodeIdentity): void {
    const existing = this.peers.get(identity.nodeAddress);
    if (existing && existing.link !== link) {
      this.closePeer(identity.nodeAddress, existing, false);
    }

    const peer: Peer = {
      link,
      identity,
      sequence: 0,
      lastReceivedSequence: 0,
      idempotencyCache: createRuntimeTransportIdempotencyFrontCache(this.idempotencyWindowSize),
      pendingAcks: new Map<string, PendingAck>(),
      outboundQueue: [],
      outboundFlushing: false,
      lastSeenAt: this.clock().getTime(),
      heartbeatInterval: null,
      heartbeatTimeout: null,
      unlistenReceive: null,
      unlistenAlive: null,
      state: 'connected',
    };
    this.peers.set(identity.nodeAddress, peer);
    this.recordPeerConnected(identity.nodeAddress, identity);

    peer.unlistenReceive = link.receive({
      onPayload: (payload) => {
        void this.handleInboundPayload(identity.nodeAddress, link, payload);
      },
      onClosed: () => {
        this.handlePeerClosed(identity.nodeAddress, link);
      },
    });

    if (link.heartbeat) {
      peer.unlistenAlive = link.heartbeat.onAlive(() => {
        this.markPeerSeen(identity.nodeAddress, link);
      });
    }

    this.startHeartbeat(identity.nodeAddress, peer);

    this.emitTransportMessage(identity.nodeAddress, {
      type: '__runtime.transport.connected',
      nodeAddress: identity.nodeAddress,
      _timestamp: this.clock().getTime(),
      _version: '1.0.0',
    } as ActorMessage<{ type: '__runtime.transport.connected'; nodeAddress: string }>);
  }

  private closePeer(nodeAddress: string, peer: Peer, emitDisconnected: boolean): void {
    peer.state = 'disconnecting';
    this.clearHeartbeat(peer);
    this.clearPendingAcks(peer);
    this.rejectQueuedFrames(
      peer,
      `Transport ${this.identity.nodeAddress} disconnected from ${nodeAddress}`
    );
    peer.unlistenReceive?.();
    peer.unlistenAlive?.();
    this.peers.delete(nodeAddress);
    peer.link.close(); // idempotent, never throws (errors-as-values)
    peer.state = 'disconnected';
    this.recordPeerDisconnected(nodeAddress, peer);

    if (emitDisconnected) {
      this.emitTransportMessage(nodeAddress, {
        type: '__runtime.transport.disconnected',
        nodeAddress,
        _timestamp: this.clock().getTime(),
        _version: '1.0.0',
      } as ActorMessage<{ type: '__runtime.transport.disconnected'; nodeAddress: string }>);
    }
  }

  private handlePeerClosed(nodeAddress: string, link: PeerLink): void {
    const peer = this.peers.get(nodeAddress);
    if (!peer || peer.link !== link) {
      return;
    }
    this.closePeer(nodeAddress, peer, true);
  }

  // --- inbound pipeline -----------------------------------------------------------------
  // Preserves the exact step order from browser-...transport.ts:405-461:
  // validate -> source-match -> markSeen -> idempotency claim -> record/duplicate -> sendAck -> emit.

  private async handleInboundPayload(
    sourceNodeAddress: string,
    link: PeerLink,
    payload: unknown
  ): Promise<void> {
    const peer = this.peers.get(sourceNodeAddress);
    if (!peer || peer.link !== link) {
      return;
    }

    const frame = payload;
    if (this.isHeartbeatFrame(frame)) {
      this.handleHeartbeatFrame(sourceNodeAddress, peer, frame);
      return;
    }
    if (this.isAckFrame(frame)) {
      this.handleAckFrame(sourceNodeAddress, peer, frame);
      return;
    }

    const validation = validateRuntimeTransportFrame(frame, this.identity);
    if (!validation.ok) {
      this.recordFrameDropped(sourceNodeAddress, validation.code, validation.message);
      await this.disconnect(sourceNodeAddress);
      return;
    }

    const runtimeFrame = frame as RuntimeTransportFrame;
    if (
      runtimeFrame.source.nodeAddress !== sourceNodeAddress ||
      runtimeFrame.source.nodeId !== peer.identity.nodeId ||
      runtimeFrame.source.incarnation !== peer.identity.incarnation
    ) {
      this.recordFrameDropped(
        sourceNodeAddress,
        'malformed_frame',
        'Runtime frame source mismatch.'
      );
      await this.disconnect(sourceNodeAddress);
      return;
    }

    this.markPeerSeen(sourceNodeAddress, link);
    const idempotency = await claimRuntimeTransportFrameIdempotency({
      cache: peer.idempotencyCache,
      provider: this.options.idempotencyProvider,
      localNode: this.identity,
      peerNode: peer.identity,
      frame: runtimeFrame,
    });

    if (idempotency.outcome === 'error') {
      this.recordIdempotencyProviderError(sourceNodeAddress, peer, idempotency);
      this.recordFrameDropped(
        sourceNodeAddress,
        'idempotency_provider_error',
        'Runtime idempotency provider claim failed.'
      );
      await this.disconnect(sourceNodeAddress);
      return;
    }

    this.recordIdempotencyCacheEvictions(sourceNodeAddress, idempotency.evictedMessageIds);

    if (idempotency.source === 'provider' && idempotency.outcome === 'accepted') {
      this.recordIdempotencyProviderClaimed(sourceNodeAddress, peer, idempotency.providerClaim);
    }

    if (idempotency.outcome === 'duplicate') {
      this.recordDuplicateFrameDropped(sourceNodeAddress, peer, runtimeFrame, idempotency.source);
      this.sendAck(sourceNodeAddress, peer, runtimeFrame);
      return;
    }

    this.recordFrameReceived(sourceNodeAddress, peer, runtimeFrame);
    this.sendAck(sourceNodeAddress, peer, runtimeFrame);
    this.emitTransportMessage(runtimeFrame.source.nodeAddress, runtimeFrame.message);
  }

  private handleAckFrame(sourceNodeAddress: string, peer: Peer, frame: unknown): void {
    const validation = validateRuntimeTransportAckFrame(frame, this.identity);
    if (!validation.ok) {
      this.recordFrameDropped(sourceNodeAddress, validation.code, validation.message);
      void this.disconnect(sourceNodeAddress);
      return;
    }

    const ackFrame = frame as ReturnType<typeof createRuntimeTransportAckFrame>;
    if (
      ackFrame.source.nodeAddress !== sourceNodeAddress ||
      ackFrame.source.nodeId !== peer.identity.nodeId ||
      ackFrame.source.incarnation !== peer.identity.incarnation
    ) {
      this.recordFrameDropped(sourceNodeAddress, 'malformed_frame', 'Runtime ack source mismatch.');
      void this.disconnect(sourceNodeAddress);
      return;
    }

    this.markPeerSeen(sourceNodeAddress, peer.link);
    this.clearPendingAck(sourceNodeAddress, peer, ackFrame.messageId);
  }

  private handleHeartbeatFrame(sourceNodeAddress: string, peer: Peer, frame: unknown): void {
    const validation = validateRuntimeTransportHeartbeatFrame(frame, this.identity);
    if (!validation.ok) {
      this.recordFrameDropped(sourceNodeAddress, validation.code, validation.message);
      void this.disconnect(sourceNodeAddress);
      return;
    }
    if (!this.isHeartbeatFrame(frame)) {
      this.recordFrameDropped(sourceNodeAddress, 'malformed_frame', 'Unsupported heartbeat frame.');
      void this.disconnect(sourceNodeAddress);
      return;
    }
    if (
      frame.source.nodeAddress !== sourceNodeAddress ||
      frame.source.nodeId !== peer.identity.nodeId ||
      frame.source.incarnation !== peer.identity.incarnation
    ) {
      this.recordFrameDropped(sourceNodeAddress, 'malformed_frame', 'Heartbeat source mismatch.');
      void this.disconnect(sourceNodeAddress);
      return;
    }

    this.markPeerSeen(sourceNodeAddress, peer.link);
    if (frame.type === 'runtime.transport.ping') {
      peer.link
        .send(
          JSON.stringify(
            createRuntimeTransportHeartbeatPong(this.identity, peer.identity, this.clock)
          )
        )
        .catch(() => {
          void this.disconnect(sourceNodeAddress);
        });
    }
  }

  // --- heartbeat engine -----------------------------------------------------------------

  private startHeartbeat(nodeAddress: string, peer: Peer): void {
    if (this.heartbeatIntervalMs <= 0) {
      return;
    }

    peer.heartbeatInterval = this.timers.setInterval(() => {
      if (!peer.link.isOpen || this.peers.get(nodeAddress) !== peer) {
        this.clearHeartbeat(peer);
        return;
      }

      // Native ping when the medium provides one (node ws); else a JSON ping frame
      // (browser, byte-identical). Arm the liveness deadline AFTER sending so a slow first
      // interval can't double-arm (architecture A4); the deadline is then driven purely by
      // lastSeenAt via resolveHeartbeat, so a steady ping cadence cannot push the deadline
      // out forever (the unified, decider-driven model — architecture §10).
      if (peer.link.heartbeat) {
        peer.link.heartbeat.ping();
      } else {
        peer.link
          .send(
            JSON.stringify(
              createRuntimeTransportHeartbeatPing(this.identity, peer.identity, this.clock)
            )
          )
          .catch(() => {
            void this.disconnect(nodeAddress);
          });
      }
      this.armHeartbeatTimeout(nodeAddress, peer);
    }, this.heartbeatIntervalMs);
  }

  private armHeartbeatTimeout(nodeAddress: string, peer: Peer): void {
    if (this.heartbeatTimeoutMs <= 0) {
      return;
    }

    // Idempotent: keep a single armed deadline. The decider (not a re-arm cadence) decides
    // alive vs timed-out from lastSeenAt, so repeated pings between deadlines are harmless.
    if (peer.heartbeatTimeout !== null) {
      return;
    }

    peer.heartbeatTimeout = this.timers.setTimeout(() => {
      peer.heartbeatTimeout = null;
      if (this.peers.get(nodeAddress) !== peer) {
        return;
      }

      const verdict = resolveHeartbeat(peer.lastSeenAt, this.clock().getTime(), {
        heartbeatTimeoutMs: this.heartbeatTimeoutMs,
      });
      if (verdict.kind === 'timed-out') {
        this.recordHeartbeatTimeout(nodeAddress, peer);
        this.closePeer(nodeAddress, peer, true);
      } else {
        this.armHeartbeatTimeout(nodeAddress, peer);
      }
    }, this.heartbeatTimeoutMs);
  }

  private clearHeartbeat(peer: Peer): void {
    if (peer.heartbeatInterval !== null) {
      this.timers.clearInterval(peer.heartbeatInterval);
      peer.heartbeatInterval = null;
    }
    if (peer.heartbeatTimeout !== null) {
      this.timers.clearTimeout(peer.heartbeatTimeout);
      peer.heartbeatTimeout = null;
    }
  }

  private markPeerSeen(nodeAddress: string, link: PeerLink): void {
    const peer = this.peers.get(nodeAddress);
    if (!peer || peer.link !== link) {
      return;
    }

    peer.lastSeenAt = this.clock().getTime();
    if (peer.heartbeatTimeout !== null) {
      this.timers.clearTimeout(peer.heartbeatTimeout);
      peer.heartbeatTimeout = null;
    }
  }

  // --- outbound queue + backpressure ----------------------------------------------------

  private enqueueFrame(
    nodeAddress: string,
    peer: Peer,
    frame: RuntimeTransportFrame,
    trackAck: boolean
  ): Promise<void> {
    const verdict = resolveBackpressure(peer.outboundQueue.length, this.outboundQueueLimit);
    if (verdict.kind === 'drop') {
      const error = new Error(
        `Transport ${this.identity.nodeAddress} outbound queue to ${nodeAddress} is full.`
      );
      this.recordOutboundQueueDropped(nodeAddress, peer, frame, error.message);
      return Promise.reject(error);
    }

    const promise = new Promise<void>((resolve, reject) => {
      peer.outboundQueue.push({ frame, resolve, reject, trackAck });
    });
    this.recordOutboundQueueEnqueued(nodeAddress, peer, frame);
    this.flushOutboundQueue(nodeAddress, peer);
    return promise;
  }

  private flushOutboundQueue(nodeAddress: string, peer: Peer): void {
    if (peer.outboundFlushing) {
      return;
    }

    peer.outboundFlushing = true;
    void this.drainOutboundQueue(nodeAddress, peer);
  }

  /**
   * Drain the outbound queue ONE send at a time, awaiting each link.send before draining the
   * next. Mirrors the pre-core node drainOutboundQueue (architecture A5): a single in-flight
   * send preserves wire ordering AND keeps the queue depth meaningful for backpressure — a
   * slow send (open link, unresolved send promise) holds the queue so a bounded queue can
   * fill and reject, exactly as the node transport did. The reentrancy guard
   * (outboundFlushing + tail re-flush in finally) is preserved.
   */
  private async drainOutboundQueue(nodeAddress: string, peer: Peer): Promise<void> {
    try {
      while (peer.outboundQueue.length > 0) {
        if (this.peers.get(nodeAddress) !== peer || !peer.link.isOpen) {
          return; // stalled until link opens; flushPeer re-drives it
        }

        const item = peer.outboundQueue.shift();
        if (!item) {
          continue;
        }
        this.updateOutboundQueueDepth(nodeAddress, peer);

        try {
          await peer.link.send(JSON.stringify(item.frame));
          this.recordFrameSent(nodeAddress, peer, item.frame);
          if (item.trackAck) {
            this.trackAckIfRetryable(nodeAddress, peer, item.frame);
          }
          item.resolve();
          this.emitTelemetry({
            type: 'outbound.queue.drained',
            peerNodeAddress: nodeAddress,
            messageType: item.frame.message.type,
            messageId: item.frame.messageId,
            queueDepth: peer.outboundQueue.length,
            queueLimit: this.outboundQueueLimit,
          });
        } catch (error) {
          item.reject(error instanceof Error ? error : new Error('Runtime transport send failed.'));
          void this.disconnect(nodeAddress);
          return;
        }
      }
    } finally {
      peer.outboundFlushing = false;
      if (
        peer.outboundQueue.length > 0 &&
        this.peers.get(nodeAddress) === peer &&
        peer.link.isOpen
      ) {
        this.flushOutboundQueue(nodeAddress, peer);
      }
    }
  }

  private rejectQueuedFrames(peer: Peer, reason: string): void {
    for (const item of peer.outboundQueue.splice(0)) {
      item.reject(new Error(reason));
    }
  }

  private updateOutboundQueueDepth(nodeAddress: string, peer: Peer): void {
    this.setPeerStats(nodeAddress, {
      outboundQueueDepth: peer.outboundQueue.length,
      outboundQueueLimit: this.outboundQueueLimit,
    });
    this.stats.outboundQueueDepth = Array.from(this.peers.values()).reduce(
      (total, currentPeer) => total + currentPeer.outboundQueue.length,
      0
    );
  }

  // --- ack tracking + timeout retry -----------------------------------------------------

  private isRetryableRuntimeFrame(frame: RuntimeTransportFrame): boolean {
    return frame.message.type.startsWith('__runtime.');
  }

  private trackAckIfRetryable(nodeAddress: string, peer: Peer, frame: RuntimeTransportFrame): void {
    if (!this.isRetryableRuntimeFrame(frame)) {
      return;
    }

    const pending: PendingAck = {
      frame,
      attempts: 0,
      lastSentAtMs: this.clock().getTime(),
      timer: null,
    };

    // give-up at arm time => retry disabled at construction; do not track.
    const verdict = resolveAckRetry(pending, pending.lastSentAtMs, {
      ackTimeoutMs: this.ackTimeoutMs,
      maxAckRetries: this.maxAckRetries,
    });
    if (verdict.kind === 'give-up') {
      return;
    }

    peer.pendingAcks.set(frame.messageId, pending);
    this.armAckRetry(nodeAddress, peer, pending);
  }

  private armAckRetry(nodeAddress: string, peer: Peer, pending: PendingAck): void {
    pending.timer = this.timers.setTimeout(() => {
      if (this.peers.get(nodeAddress) !== peer || !peer.pendingAcks.has(pending.frame.messageId)) {
        return;
      }

      const verdict = resolveAckRetry(pending, this.clock().getTime(), {
        ackTimeoutMs: this.ackTimeoutMs,
        maxAckRetries: this.maxAckRetries,
      });

      if (verdict.kind === 'give-up') {
        peer.pendingAcks.delete(pending.frame.messageId);
        this.recordRetryExhausted(nodeAddress, peer, pending.frame);
        return;
      }

      if (verdict.kind === 'wait') {
        this.armAckRetry(nodeAddress, peer, pending);
        return;
      }

      pending.attempts += 1;
      pending.lastSentAtMs = this.clock().getTime();
      this.recordFrameRetryScheduled(nodeAddress, peer, pending.frame);
      // Re-arm the retry deadline synchronously (independent of the async re-send) so the
      // next deadline is registered immediately — ack-retry stays deterministic under
      // injected fake timers.
      this.armAckRetry(nodeAddress, peer, pending);
      this.enqueueFrame(nodeAddress, peer, pending.frame, false).catch(() => {
        void this.disconnect(nodeAddress);
      });
    }, this.ackTimeoutMs);
  }

  private clearPendingAck(nodeAddress: string, peer: Peer, messageId: string): void {
    const pending = peer.pendingAcks.get(messageId);
    if (!pending) {
      return;
    }
    if (pending.timer !== null) {
      this.timers.clearTimeout(pending.timer);
      pending.timer = null;
    }
    peer.pendingAcks.delete(messageId);
    this.recordFrameAckReceived(nodeAddress, peer, pending.frame);
  }

  private clearPendingAcks(peer: Peer): void {
    for (const pending of peer.pendingAcks.values()) {
      if (pending.timer !== null) {
        this.timers.clearTimeout(pending.timer);
      }
    }
    peer.pendingAcks.clear();
  }

  private sendAck(nodeAddress: string, peer: Peer, frame: RuntimeTransportFrame): void {
    const ackFrame = createRuntimeTransportAckFrame(
      this.identity,
      peer.identity,
      frame.messageId,
      frame.sequence,
      this.clock
    );
    // A failed ack send (e.g. socket already CLOSING) is a fact, not an escaping rejection:
    // disconnect the peer, mirroring the pre-core node sendAck().catch(() => disconnect).
    peer.link.send(JSON.stringify(ackFrame)).catch(() => {
      void this.disconnect(nodeAddress);
    });
    this.recordFrameAckSent(nodeAddress, frame);
  }

  // --- guarded dispatch -----------------------------------------------------------------

  private emitTransportMessage(source: string, message: ActorMessage): void {
    const event = { source, message };
    for (const listener of Array.from(this.listeners)) {
      safeDispatchListener(listener, event, (error) => {
        this.onListenerError(error);
      });
    }
  }

  // --- frame type guards ----------------------------------------------------------------

  private isHeartbeatFrame(frame: unknown): frame is {
    type: 'runtime.transport.ping' | 'runtime.transport.pong';
    source: RuntimeNodeIdentity;
  } {
    return Boolean(
      frame &&
        typeof frame === 'object' &&
        ((frame as { type?: string }).type === 'runtime.transport.ping' ||
          (frame as { type?: string }).type === 'runtime.transport.pong')
    );
  }

  private isAckFrame(frame: unknown): frame is ReturnType<typeof createRuntimeTransportAckFrame> {
    return Boolean(
      frame &&
        typeof frame === 'object' &&
        (frame as { type?: string }).type === 'runtime.transport.ack'
    );
  }

  // --- stats / telemetry ----------------------------------------------------------------

  private createInitialStats(): RuntimeTransportStats {
    return {
      nodeAddress: this.identity.nodeAddress,
      connectedPeerCount: 0,
      framesSent: 0,
      framesReceived: 0,
      framesAcked: 0,
      framesRetried: 0,
      retryExhaustedCount: 0,
      outboundQueueDepth: 0,
      outboundQueueLimit: this.outboundQueueLimit,
      outboundFramesDropped: 0,
      backpressureDropCount: 0,
      duplicateFramesDropped: 0,
      idempotencyCacheEvictions: 0,
      idempotencyWindowSize: this.idempotencyWindowSize,
      idempotencyProviderEnabled: Boolean(this.options.idempotencyProvider),
      idempotencyProviderClaimCount: 0,
      idempotencyProviderDuplicateCount: 0,
      idempotencyProviderErrorCount: 0,
      malformedFramesDropped: 0,
      validationFramesDropped: 0,
      sequenceGapCount: 0,
      handshakeAcceptedCount: 0,
      handshakeRejectedCount: 0,
      disconnectCount: 0,
      reconnectCount: 0,
      heartbeatTimeoutCount: 0,
      peers: {},
    };
  }

  private emptyPeerStats(nodeAddress: string): RuntimeTransportPeerStats {
    return {
      nodeAddress,
      state: 'disconnected',
      lastSentSequence: 0,
      lastReceivedSequence: 0,
      framesSent: 0,
      framesReceived: 0,
      framesAcked: 0,
      framesRetried: 0,
      retryExhaustedCount: 0,
      outboundQueueDepth: 0,
      outboundQueueLimit: this.outboundQueueLimit,
      outboundFramesDropped: 0,
      backpressureDropCount: 0,
      duplicateFramesDropped: 0,
      idempotencyCacheEvictions: 0,
      idempotencyWindowSize: this.idempotencyWindowSize,
      idempotencyProviderEnabled: Boolean(this.options.idempotencyProvider),
      idempotencyProviderClaimCount: 0,
      idempotencyProviderDuplicateCount: 0,
      idempotencyProviderErrorCount: 0,
      malformedFramesDropped: 0,
      validationFramesDropped: 0,
      sequenceGapCount: 0,
      handshakeAcceptedCount: 0,
      handshakeRejectedCount: 0,
      disconnectCount: 0,
      reconnectCount: 0,
      heartbeatTimeoutCount: 0,
    };
  }

  private setPeerStats(
    nodeAddress: string,
    update: Partial<Omit<RuntimeTransportPeerStats, 'nodeAddress'>>
  ): RuntimeTransportPeerStats {
    const previous = this.stats.peers[nodeAddress] ?? this.emptyPeerStats(nodeAddress);
    const next = {
      ...previous,
      ...update,
      ...(update.identity ? { identity: { ...update.identity } } : {}),
    };
    this.stats.peers[nodeAddress] = next;
    return next;
  }

  private emitTelemetry(
    event: Omit<RuntimeTransportTelemetryEvent, 'nodeAddress' | 'timestamp'>
  ): void {
    const timestamp = this.clock().toISOString();
    this.stats.lastEventAt = timestamp;
    this.options.telemetry?.({
      nodeAddress: this.identity.nodeAddress,
      timestamp,
      ...event,
    });
  }

  private recordPeerConnected(nodeAddress: string, identity: RuntimeNodeIdentity): void {
    const previous = this.stats.peers[nodeAddress];
    const connectedAt = this.clock().toISOString();
    this.stats.handshakeAcceptedCount += 1;
    if (previous?.disconnectCount) {
      this.stats.reconnectCount += 1;
    }
    this.setPeerStats(nodeAddress, {
      state: 'connected',
      identity,
      connectedAt,
      lastSeenAt: connectedAt,
      handshakeAcceptedCount: (previous?.handshakeAcceptedCount ?? 0) + 1,
      reconnectCount: previous?.disconnectCount ? (previous?.reconnectCount ?? 0) + 1 : 0,
      rejectedReason: undefined,
    });
    this.refreshConnectedPeerCount();
    this.emitTelemetry({ type: 'handshake.accepted', peerNodeAddress: nodeAddress });
    this.emitTelemetry({ type: 'peer.connected', peerNodeAddress: nodeAddress });
  }

  private recordHandshakeRejected(nodeAddress: string, reason: string): void {
    const previous = this.stats.peers[nodeAddress];
    this.stats.handshakeRejectedCount += 1;
    this.setPeerStats(nodeAddress, {
      state: 'rejected',
      handshakeRejectedCount: (previous?.handshakeRejectedCount ?? 0) + 1,
      rejectedReason: reason,
    });
    this.emitTelemetry({ type: 'handshake.rejected', peerNodeAddress: nodeAddress, reason });
    this.emitTelemetry({ type: 'peer.rejected', peerNodeAddress: nodeAddress, reason });
  }

  private recordAuthRejected(nodeAddress: string, reason: string): void {
    this.setPeerStats(nodeAddress, { state: 'rejected', rejectedReason: reason });
    this.emitTelemetry({ type: 'auth.rejected', peerNodeAddress: nodeAddress, reason });
  }

  private recordPeerDisconnected(nodeAddress: string, peer: Peer): void {
    const previous = this.stats.peers[nodeAddress];
    const disconnectedAt = this.clock().toISOString();
    this.stats.disconnectCount += 1;
    this.setPeerStats(nodeAddress, {
      state: 'disconnected',
      identity: peer.identity,
      disconnectedAt,
      lastSeenAt: new Date(peer.lastSeenAt).toISOString(),
      disconnectCount: (previous?.disconnectCount ?? 0) + 1,
    });
    this.refreshConnectedPeerCount();
    this.emitTelemetry({ type: 'peer.disconnected', peerNodeAddress: nodeAddress });
  }

  private recordFrameSent(nodeAddress: string, peer: Peer, frame: RuntimeTransportFrame): void {
    this.stats.framesSent += 1;
    this.setPeerStats(nodeAddress, {
      identity: peer.identity,
      lastSentAt: this.clock().toISOString(),
      lastSentSequence: frame.sequence,
      framesSent: (this.stats.peers[nodeAddress]?.framesSent ?? 0) + 1,
    });
    this.emitTelemetry({
      type: 'frame.sent',
      peerNodeAddress: nodeAddress,
      messageType: frame.message.type,
      messageId: frame.messageId,
      sequence: frame.sequence,
    });
  }

  private recordFrameReceived(nodeAddress: string, peer: Peer, frame: RuntimeTransportFrame): void {
    const expectedSequence = peer.lastReceivedSequence + 1;
    if (frame.sequence > expectedSequence) {
      this.stats.sequenceGapCount += 1;
      this.setPeerStats(nodeAddress, {
        sequenceGapCount: (this.stats.peers[nodeAddress]?.sequenceGapCount ?? 0) + 1,
      });
      this.emitTelemetry({
        type: 'sequence.gap',
        peerNodeAddress: nodeAddress,
        sequence: frame.sequence,
        expectedSequence,
      });
    }

    peer.lastReceivedSequence = Math.max(peer.lastReceivedSequence, frame.sequence);
    this.stats.framesReceived += 1;
    this.setPeerStats(nodeAddress, {
      identity: peer.identity,
      lastReceivedAt: this.clock().toISOString(),
      lastReceivedSequence: peer.lastReceivedSequence,
      framesReceived: (this.stats.peers[nodeAddress]?.framesReceived ?? 0) + 1,
    });
    this.emitTelemetry({
      type: 'frame.received',
      peerNodeAddress: nodeAddress,
      messageType: frame.message.type,
      messageId: frame.messageId,
      sequence: frame.sequence,
    });
  }

  private recordIdempotencyCacheEvictions(
    nodeAddress: string,
    evictedMessageIds: readonly string[]
  ): void {
    for (const evicted of evictedMessageIds) {
      this.stats.idempotencyCacheEvictions += 1;
      this.setPeerStats(nodeAddress, {
        idempotencyCacheEvictions:
          (this.stats.peers[nodeAddress]?.idempotencyCacheEvictions ?? 0) + 1,
      });
      this.emitTelemetry({
        type: 'idempotency.cache.evicted',
        peerNodeAddress: nodeAddress,
        messageId: evicted,
      });
    }
  }

  private recordIdempotencyProviderClaimed(
    nodeAddress: string,
    peer: Peer,
    claim?: { readonly scope: string; readonly key: string }
  ): void {
    if (!claim) {
      return;
    }
    this.stats.idempotencyProviderClaimCount += 1;
    this.setPeerStats(nodeAddress, {
      identity: peer.identity,
      idempotencyProviderClaimCount:
        (this.stats.peers[nodeAddress]?.idempotencyProviderClaimCount ?? 0) + 1,
    });
    this.emitTelemetry({
      type: 'idempotency.provider.claimed',
      peerNodeAddress: nodeAddress,
      idempotencyScope: claim.scope,
      idempotencyKey: claim.key,
    });
  }

  private recordIdempotencyProviderError(
    nodeAddress: string,
    peer: Peer,
    input: {
      readonly error: Error;
      readonly providerClaim: { readonly scope: string; readonly key: string };
    }
  ): void {
    const erroredAt = this.clock().toISOString();
    this.stats.idempotencyProviderErrorCount += 1;
    this.stats.lastIdempotencyProviderErrorAt = erroredAt;
    this.stats.lastIdempotencyProviderErrorMessage = input.error.message;
    this.setPeerStats(nodeAddress, {
      identity: peer.identity,
      idempotencyProviderErrorCount:
        (this.stats.peers[nodeAddress]?.idempotencyProviderErrorCount ?? 0) + 1,
      lastIdempotencyProviderErrorAt: erroredAt,
      lastIdempotencyProviderErrorMessage: input.error.message,
    });
    this.emitTelemetry({
      type: 'idempotency.provider.error',
      peerNodeAddress: nodeAddress,
      reason: input.error.message,
      idempotencyScope: input.providerClaim.scope,
      idempotencyKey: input.providerClaim.key,
    });
  }

  private recordDuplicateFrameDropped(
    nodeAddress: string,
    peer: Peer,
    frame: RuntimeTransportFrame,
    source: 'memory' | 'provider'
  ): void {
    this.stats.duplicateFramesDropped += 1;
    const update: Partial<Omit<RuntimeTransportPeerStats, 'nodeAddress'>> = {
      identity: peer.identity,
      duplicateFramesDropped: (this.stats.peers[nodeAddress]?.duplicateFramesDropped ?? 0) + 1,
    };
    if (source === 'provider') {
      this.stats.idempotencyProviderDuplicateCount += 1;
      update.idempotencyProviderDuplicateCount =
        (this.stats.peers[nodeAddress]?.idempotencyProviderDuplicateCount ?? 0) + 1;
    }
    this.setPeerStats(nodeAddress, update);
    this.emitTelemetry({
      type: 'frame.duplicate',
      peerNodeAddress: nodeAddress,
      messageType: frame.message.type,
      messageId: frame.messageId,
      sequence: frame.sequence,
    });
    if (source === 'provider') {
      this.emitTelemetry({
        type: 'idempotency.provider.duplicate',
        peerNodeAddress: nodeAddress,
        messageType: frame.message.type,
        messageId: frame.messageId,
        sequence: frame.sequence,
      });
    }
  }

  private recordOutboundQueueEnqueued(
    nodeAddress: string,
    peer: Peer,
    frame: RuntimeTransportFrame
  ): void {
    this.updateOutboundQueueDepth(nodeAddress, peer);
    this.emitTelemetry({
      type: 'outbound.queue.enqueued',
      peerNodeAddress: nodeAddress,
      messageType: frame.message.type,
      messageId: frame.messageId,
      sequence: frame.sequence,
      queueDepth: peer.outboundQueue.length,
      queueLimit: this.outboundQueueLimit,
    });
  }

  private recordOutboundQueueDropped(
    nodeAddress: string,
    peer: Peer,
    frame: RuntimeTransportFrame,
    reason: string
  ): void {
    this.stats.outboundFramesDropped += 1;
    this.stats.backpressureDropCount += 1;
    this.setPeerStats(nodeAddress, {
      identity: peer.identity,
      outboundQueueDepth: peer.outboundQueue.length,
      outboundQueueLimit: this.outboundQueueLimit,
      outboundFramesDropped: (this.stats.peers[nodeAddress]?.outboundFramesDropped ?? 0) + 1,
      backpressureDropCount: (this.stats.peers[nodeAddress]?.backpressureDropCount ?? 0) + 1,
    });
    this.emitTelemetry({
      type: 'outbound.queue.dropped',
      peerNodeAddress: nodeAddress,
      messageType: frame.message.type,
      messageId: frame.messageId,
      sequence: frame.sequence,
      queueDepth: peer.outboundQueue.length,
      queueLimit: this.outboundQueueLimit,
      reason,
    });
    this.emitTelemetry({
      type: 'backpressure.applied',
      peerNodeAddress: nodeAddress,
      messageType: frame.message.type,
      messageId: frame.messageId,
      sequence: frame.sequence,
      queueDepth: peer.outboundQueue.length,
      queueLimit: this.outboundQueueLimit,
      reason,
    });
  }

  private recordOutboundFramePayloadTooLarge(
    nodeAddress: string,
    peer: Peer,
    frame: RuntimeTransportFrame,
    result: Extract<RuntimeTransportPayloadValidationResult, { ok: false }>
  ): void {
    this.stats.outboundFramesDropped += 1;
    this.stats.validationFramesDropped += 1;
    this.setPeerStats(nodeAddress, {
      identity: peer.identity,
      outboundQueueDepth: peer.outboundQueue.length,
      outboundQueueLimit: this.outboundQueueLimit,
      outboundFramesDropped: (this.stats.peers[nodeAddress]?.outboundFramesDropped ?? 0) + 1,
      validationFramesDropped: (this.stats.peers[nodeAddress]?.validationFramesDropped ?? 0) + 1,
    });
    this.emitTelemetry({
      type: 'frame.dropped',
      peerNodeAddress: nodeAddress,
      messageType: frame.message.type,
      messageId: frame.messageId,
      sequence: frame.sequence,
      reason: result.message,
      dropCode: result.code,
      frameBytes: result.frameBytes,
      maxFrameBytes: result.maxFrameBytes,
    });
  }

  private recordFrameAckSent(nodeAddress: string, frame: RuntimeTransportFrame): void {
    this.emitTelemetry({
      type: 'frame.ack.sent',
      peerNodeAddress: nodeAddress,
      messageType: frame.message.type,
      messageId: frame.messageId,
      sequence: frame.sequence,
    });
  }

  private recordFrameAckReceived(
    nodeAddress: string,
    peer: Peer,
    frame: RuntimeTransportFrame
  ): void {
    this.stats.framesAcked += 1;
    this.setPeerStats(nodeAddress, {
      identity: peer.identity,
      framesAcked: (this.stats.peers[nodeAddress]?.framesAcked ?? 0) + 1,
    });
    this.emitTelemetry({
      type: 'frame.ack.received',
      peerNodeAddress: nodeAddress,
      messageType: frame.message.type,
      messageId: frame.messageId,
      sequence: frame.sequence,
    });
  }

  private recordFrameRetryScheduled(
    nodeAddress: string,
    peer: Peer,
    frame: RuntimeTransportFrame
  ): void {
    this.stats.framesRetried += 1;
    this.setPeerStats(nodeAddress, {
      identity: peer.identity,
      framesRetried: (this.stats.peers[nodeAddress]?.framesRetried ?? 0) + 1,
    });
    this.emitTelemetry({
      type: 'frame.retry.scheduled',
      peerNodeAddress: nodeAddress,
      messageType: frame.message.type,
      messageId: frame.messageId,
      sequence: frame.sequence,
    });
  }

  private recordRetryExhausted(
    nodeAddress: string,
    peer: Peer,
    frame: RuntimeTransportFrame
  ): void {
    this.stats.retryExhaustedCount += 1;
    this.setPeerStats(nodeAddress, {
      identity: peer.identity,
      retryExhaustedCount: (this.stats.peers[nodeAddress]?.retryExhaustedCount ?? 0) + 1,
    });
    this.emitTelemetry({
      type: 'frame.retry.exhausted',
      peerNodeAddress: nodeAddress,
      messageType: frame.message.type,
      messageId: frame.messageId,
      sequence: frame.sequence,
    });
  }

  private recordFrameDropped(
    nodeAddress: string,
    code: RuntimeTransportDropCode,
    reason: string
  ): void {
    if (code === 'malformed_frame') {
      this.stats.malformedFramesDropped += 1;
      this.setPeerStats(nodeAddress, {
        malformedFramesDropped: (this.stats.peers[nodeAddress]?.malformedFramesDropped ?? 0) + 1,
      });
    } else if (code !== 'idempotency_provider_error') {
      this.stats.validationFramesDropped += 1;
      this.setPeerStats(nodeAddress, {
        validationFramesDropped: (this.stats.peers[nodeAddress]?.validationFramesDropped ?? 0) + 1,
      });
    }
    this.emitTelemetry({
      type: 'frame.dropped',
      peerNodeAddress: nodeAddress,
      reason,
      dropCode: code,
    });
  }

  private recordHeartbeatTimeout(nodeAddress: string, peer: Peer): void {
    this.stats.heartbeatTimeoutCount += 1;
    this.setPeerStats(nodeAddress, {
      identity: peer.identity,
      heartbeatTimeoutCount: (this.stats.peers[nodeAddress]?.heartbeatTimeoutCount ?? 0) + 1,
    });
    this.emitTelemetry({ type: 'heartbeat.timeout', peerNodeAddress: nodeAddress });
  }

  private refreshConnectedPeerCount(): void {
    this.stats.connectedPeerCount = Array.from(this.peers.values()).filter(
      (peer) => peer.link.isOpen && peer.state === 'connected'
    ).length;
  }

  private cloneStats(): RuntimeTransportStats {
    return {
      ...this.stats,
      peers: Object.fromEntries(
        Object.entries(this.stats.peers).map(([nodeAddress, stats]) => [
          nodeAddress,
          this.clonePeerStats(stats),
        ])
      ),
    };
  }

  private clonePeerStats(stats: RuntimeTransportPeerStats): RuntimeTransportPeerStats {
    return {
      ...stats,
      ...(stats.identity ? { identity: { ...stats.identity } } : {}),
    };
  }
}
