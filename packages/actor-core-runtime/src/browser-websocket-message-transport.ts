import type { ActorMessage, MessageTransport } from './actor-system.js';
import {
  type RuntimeTransportAuthProvider,
  resolveRuntimeAuthPayload,
  verifyRuntimeAuth,
} from './runtime-auth.js';
import {
  createRuntimeNodeIdentity,
  createRuntimeTransportAckFrame,
  createRuntimeTransportFrame,
  createRuntimeTransportHandshakeHello,
  createRuntimeTransportHeartbeatPing,
  createRuntimeTransportHeartbeatPong,
  type RuntimeNodeIdentity,
  type RuntimeTransportFrame,
  type RuntimeTransportHandshake,
  validateRuntimeTransportAckFrame,
  validateRuntimeTransportFrame,
  validateRuntimeTransportHandshake,
  validateRuntimeTransportHeartbeatFrame,
} from './runtime-transport-contract.js';
import type {
  RuntimeTransportPeerStats,
  RuntimeTransportStats,
  RuntimeTransportTelemetryEvent,
  RuntimeTransportTelemetryObserver,
} from './runtime-transport-telemetry.js';

export interface BrowserWebSocketMessageTransportOptions {
  nodeAddress: string;
  nodeId?: string;
  incarnation?: string;
  capabilities?: readonly string[];
  peers?: Record<string, string>;
  peerUrlResolver?: (nodeAddress: string) => string | undefined | Promise<string | undefined>;
  connectTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  idempotencyWindowSize?: number;
  ackTimeoutMs?: number;
  maxAckRetries?: number;
  outboundQueueLimit?: number;
  telemetry?: RuntimeTransportTelemetryObserver;
  webSocketFactory?: (url: string) => WebSocket;
  auth?: RuntimeTransportAuthProvider<{
    readonly source: RuntimeNodeIdentity;
    readonly local: RuntimeNodeIdentity;
  }>;
}

type BrowserPeerConnection = {
  socket: WebSocket;
  identity: RuntimeNodeIdentity;
  sequence: number;
  lastReceivedSequence: number;
  seenMessageIds: string[];
  seenMessageIdSet: Set<string>;
  pendingAcks: Map<string, PendingAck>;
  outboundQueue: OutboundQueueItem[];
  outboundFlushing: boolean;
  lastSeenAt: number;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  heartbeatTimeout: ReturnType<typeof setTimeout> | null;
};

type PendingAck = {
  frame: RuntimeTransportFrame;
  retries: number;
  timer: ReturnType<typeof setTimeout> | null;
};

type OutboundQueueItem = {
  frame: RuntimeTransportFrame;
  resolve: () => void;
  reject: (error: Error) => void;
  trackAck: boolean;
};

const WEB_SOCKET_OPEN = 1;

export class BrowserWebSocketMessageTransport implements MessageTransport {
  private readonly listeners = new Set<
    (event: { source: string; message: ActorMessage }) => void
  >();
  private readonly peers = new Map<string, BrowserPeerConnection>();
  private readonly identity: RuntimeNodeIdentity;
  private readonly connectTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly idempotencyWindowSize: number;
  private readonly ackTimeoutMs: number;
  private readonly maxAckRetries: number;
  private readonly outboundQueueLimit: number;
  private readonly webSocketFactory: (url: string) => WebSocket;
  private readonly stats: RuntimeTransportStats;

  constructor(private readonly options: BrowserWebSocketMessageTransportOptions) {
    this.identity = createRuntimeNodeIdentity({
      nodeAddress: options.nodeAddress,
      nodeId: options.nodeId ?? options.nodeAddress,
      incarnation: options.incarnation ?? `${Date.now()}`,
      ...(options.capabilities ? { capabilities: options.capabilities } : {}),
    });
    this.connectTimeoutMs = options.connectTimeoutMs ?? 3000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? this.heartbeatIntervalMs * 2;
    this.idempotencyWindowSize = options.idempotencyWindowSize ?? 1024;
    this.ackTimeoutMs = options.ackTimeoutMs ?? 1000;
    this.maxAckRetries = options.maxAckRetries ?? 2;
    this.outboundQueueLimit = options.outboundQueueLimit ?? 1024;
    this.webSocketFactory =
      options.webSocketFactory ??
      ((url) => {
        if (typeof WebSocket === 'undefined') {
          throw new Error('Browser WebSocket transport requires a global WebSocket constructor.');
        }

        return new WebSocket(url);
      });
    this.stats = this.createInitialStats();
  }

  async start(): Promise<void> {
    if (!this.stats.startedAt) {
      this.stats.startedAt = new Date().toISOString();
      this.emitTelemetry({ type: 'transport.started' });
    }
    return Promise.resolve();
  }

  async stop(): Promise<void> {
    for (const [nodeAddress, peer] of Array.from(this.peers.entries())) {
      this.closePeer(nodeAddress, peer, false);
    }
    this.stats.stoppedAt = new Date().toISOString();
    this.emitTelemetry({ type: 'transport.stopped' });
  }

  getStats(): RuntimeTransportStats {
    return this.cloneStats();
  }

  getPeerStats(nodeAddress: string): RuntimeTransportPeerStats | undefined {
    const stats = this.stats.peers[nodeAddress];
    return stats ? this.clonePeerStats(stats) : undefined;
  }

  async send(destination: string, message: ActorMessage): Promise<void> {
    const peer = this.peers.get(destination);
    if (!peer || peer.socket.readyState !== WEB_SOCKET_OPEN) {
      throw new Error(
        `Transport ${this.identity.nodeAddress} is not connected to ${destination} (readyState=${peer?.socket.readyState ?? 'missing'})`
      );
    }

    peer.sequence += 1;
    const frame = createRuntimeTransportFrame({
      source: this.identity,
      destination: peer.identity,
      messageId: this.createMessageId(destination, peer.sequence),
      sequence: peer.sequence,
      message,
    });

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
    if (existing?.socket.readyState === WEB_SOCKET_OPEN) {
      return;
    }

    const url = await this.resolvePeerUrl(address);
    if (!url) {
      this.recordHandshakeRejected(address, `No WebSocket peer URL configured for node ${address}`);
      throw new Error(`No WebSocket peer URL configured for node ${address}`);
    }

    this.setPeerStats(address, { state: 'connecting' });
    this.emitTelemetry({ type: 'peer.connecting', peerNodeAddress: address });
    const socket = this.webSocketFactory(url);
    try {
      await this.waitForOpen(socket);
      this.sendJson(
        socket,
        createRuntimeTransportHandshakeHello(this.identity, {
          auth: await resolveRuntimeAuthPayload(this.options.auth),
        })
      );
      const peerIdentity = await this.waitForHandshakeAccept(socket, address);
      this.registerPeer(socket, peerIdentity);
    } catch (error) {
      socket.close();
      this.recordHandshakeRejected(
        address,
        error instanceof Error ? error.message : 'Runtime peer connection failed.'
      );
      throw error;
    }
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
      .filter(([, peer]) => peer.socket.readyState === WEB_SOCKET_OPEN)
      .map(([nodeAddress]) => nodeAddress);
  }

  isConnected(address: string): boolean {
    return this.peers.get(address)?.socket.readyState === WEB_SOCKET_OPEN;
  }

  private async resolvePeerUrl(nodeAddress: string): Promise<string | undefined> {
    return this.options.peers?.[nodeAddress] ?? this.options.peerUrlResolver?.(nodeAddress);
  }

  private async waitForHandshakeAccept(
    socket: WebSocket,
    expectedNodeAddress: string
  ): Promise<RuntimeNodeIdentity> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        cleanup();
        socket.close();
        reject(new Error(`Timed out waiting for runtime handshake from ${expectedNodeAddress}`));
      }, this.connectTimeoutMs);

      const cleanup = () => {
        settled = true;
        clearTimeout(timeout);
        socket.removeEventListener('message', onMessage);
        socket.removeEventListener('close', onClose);
        socket.removeEventListener('error', onError);
      };

      const onClose = () => {
        if (settled) {
          return;
        }
        cleanup();
        reject(new Error(`WebSocket closed before runtime handshake from ${expectedNodeAddress}`));
      };
      const onError = () => {
        if (settled) {
          return;
        }
        cleanup();
        reject(new Error(`WebSocket error before runtime handshake from ${expectedNodeAddress}`));
      };
      const onMessage = (event: MessageEvent) => {
        if (settled) {
          return;
        }
        void this.parseJson(event.data).then((frame) => {
          if (settled) {
            return;
          }

          const validation = validateRuntimeTransportHandshake(frame, this.identity);
          if (!validation.ok) {
            cleanup();
            socket.close();
            reject(new Error(`Runtime handshake rejected: ${validation.message}`));
            return;
          }

          if (this.isHandshakeReject(frame)) {
            cleanup();
            socket.close();
            reject(new Error(`Runtime handshake rejected: ${frame.message}`));
            return;
          }

          if (!this.isHandshakeAccept(frame)) {
            cleanup();
            socket.close();
            reject(new Error('Expected runtime handshake accept.'));
            return;
          }

          cleanup();
          void this.verifyPeerAuth(frame).then((auth) => {
            if (!auth.ok) {
              socket.close();
              this.recordAuthRejected(frame.source.nodeAddress, auth.reason);
              reject(new Error(`Runtime handshake rejected: ${auth.reason}`));
              return;
            }
            this.recordAuthAccepted(frame.source.nodeAddress);

            if (frame.source.nodeAddress !== expectedNodeAddress) {
              socket.close();
              reject(
                new Error(`Runtime handshake accepted unexpected node ${frame.source.nodeAddress}.`)
              );
              return;
            }

            resolve(frame.source);
          }, reject);
        }, reject);
      };

      socket.addEventListener('message', onMessage);
      socket.addEventListener('close', onClose);
      socket.addEventListener('error', onError);
    });
  }

  private registerPeer(socket: WebSocket, identity: RuntimeNodeIdentity): void {
    const existing = this.peers.get(identity.nodeAddress);
    if (existing && existing.socket !== socket) {
      this.closePeer(identity.nodeAddress, existing, false);
    }

    const peer: BrowserPeerConnection = {
      socket,
      identity,
      sequence: 0,
      lastReceivedSequence: 0,
      seenMessageIds: [],
      seenMessageIdSet: new Set<string>(),
      pendingAcks: new Map<string, PendingAck>(),
      outboundQueue: [],
      outboundFlushing: false,
      lastSeenAt: Date.now(),
      heartbeatInterval: null,
      heartbeatTimeout: null,
    };
    this.peers.set(identity.nodeAddress, peer);
    this.recordPeerConnected(identity.nodeAddress, identity);

    socket.addEventListener('message', (event) => {
      void this.handleSocketMessage(identity.nodeAddress, socket, event.data);
    });
    socket.addEventListener('close', () => {
      this.handlePeerClosed(identity.nodeAddress, socket);
    });
    socket.addEventListener('error', () => {
      this.handlePeerClosed(identity.nodeAddress, socket);
    });

    this.startHeartbeat(identity.nodeAddress, peer);
    queueMicrotask(() => {
      if (this.peers.get(identity.nodeAddress) !== peer) {
        return;
      }

      this.emitTransportMessage(identity.nodeAddress, {
        type: '__runtime.transport.connected',
        nodeAddress: identity.nodeAddress,
        _timestamp: Date.now(),
        _version: '1.0.0',
      } as ActorMessage<{ type: '__runtime.transport.connected'; nodeAddress: string }>);
    });
  }

  private async handleSocketMessage(
    sourceNodeAddress: string,
    socket: WebSocket,
    data: unknown
  ): Promise<void> {
    const peer = this.peers.get(sourceNodeAddress);
    if (!peer || peer.socket !== socket || peer.socket.readyState !== WEB_SOCKET_OPEN) {
      return;
    }

    const frame = await this.parseJson(data);
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

    this.markPeerSeen(sourceNodeAddress, peer.socket);
    if (this.isDuplicateFrame(peer, runtimeFrame)) {
      this.recordDuplicateFrameDropped(sourceNodeAddress, peer, runtimeFrame);
      this.sendAck(sourceNodeAddress, peer, runtimeFrame);
      return;
    }

    this.rememberMessageId(sourceNodeAddress, peer, runtimeFrame.messageId);
    this.recordFrameReceived(sourceNodeAddress, peer, runtimeFrame);
    this.sendAck(sourceNodeAddress, peer, runtimeFrame);
    this.emitTransportMessage(runtimeFrame.source.nodeAddress, runtimeFrame.message);
  }

  private handleAckFrame(
    sourceNodeAddress: string,
    peer: BrowserPeerConnection,
    frame: unknown
  ): void {
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

    this.markPeerSeen(sourceNodeAddress, peer.socket);
    this.clearPendingAck(sourceNodeAddress, peer, ackFrame.messageId);
  }

  private handleHeartbeatFrame(
    sourceNodeAddress: string,
    peer: BrowserPeerConnection,
    frame: unknown
  ): void {
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

    this.markPeerSeen(sourceNodeAddress, peer.socket);
    if (frame.type === 'runtime.transport.ping') {
      this.sendJson(peer.socket, createRuntimeTransportHeartbeatPong(this.identity, peer.identity));
    }
  }

  private closePeer(
    nodeAddress: string,
    peer: BrowserPeerConnection,
    emitDisconnected: boolean
  ): void {
    this.clearHeartbeat(peer);
    this.clearPendingAcks(peer);
    this.rejectQueuedFrames(
      peer,
      `Transport ${this.identity.nodeAddress} disconnected from ${nodeAddress}`
    );
    this.peers.delete(nodeAddress);
    peer.socket.close();
    this.recordPeerDisconnected(nodeAddress, peer);

    if (emitDisconnected) {
      this.emitTransportMessage(nodeAddress, {
        type: '__runtime.transport.disconnected',
        nodeAddress,
        _timestamp: Date.now(),
        _version: '1.0.0',
      } as ActorMessage<{ type: '__runtime.transport.disconnected'; nodeAddress: string }>);
    }
  }

  private handlePeerClosed(nodeAddress: string, socket: WebSocket): void {
    const peer = this.peers.get(nodeAddress);
    if (!peer || peer.socket !== socket) {
      return;
    }

    this.closePeer(nodeAddress, peer, true);
  }

  private startHeartbeat(nodeAddress: string, peer: BrowserPeerConnection): void {
    if (this.heartbeatIntervalMs <= 0) {
      return;
    }

    peer.heartbeatInterval = setInterval(() => {
      if (peer.socket.readyState !== WEB_SOCKET_OPEN || this.peers.get(nodeAddress) !== peer) {
        this.clearHeartbeat(peer);
        return;
      }

      this.sendJson(peer.socket, createRuntimeTransportHeartbeatPing(this.identity, peer.identity));
      this.armHeartbeatTimeout(nodeAddress, peer);
    }, this.heartbeatIntervalMs);
  }

  private armHeartbeatTimeout(nodeAddress: string, peer: BrowserPeerConnection): void {
    if (this.heartbeatTimeoutMs <= 0) {
      return;
    }

    if (peer.heartbeatTimeout) {
      clearTimeout(peer.heartbeatTimeout);
    }

    peer.heartbeatTimeout = setTimeout(() => {
      if (this.peers.get(nodeAddress) !== peer) {
        return;
      }

      this.recordHeartbeatTimeout(nodeAddress, peer);
      this.closePeer(nodeAddress, peer, true);
    }, this.heartbeatTimeoutMs);
  }

  private clearHeartbeat(peer: BrowserPeerConnection): void {
    if (peer.heartbeatInterval) {
      clearInterval(peer.heartbeatInterval);
      peer.heartbeatInterval = null;
    }
    if (peer.heartbeatTimeout) {
      clearTimeout(peer.heartbeatTimeout);
      peer.heartbeatTimeout = null;
    }
  }

  private markPeerSeen(nodeAddress: string, socket: WebSocket): void {
    const peer = this.peers.get(nodeAddress);
    if (!peer || peer.socket !== socket) {
      return;
    }

    peer.lastSeenAt = Date.now();
    if (peer.heartbeatTimeout) {
      clearTimeout(peer.heartbeatTimeout);
      peer.heartbeatTimeout = null;
    }
  }

  private emitTransportMessage(source: string, message: ActorMessage): void {
    for (const listener of Array.from(this.listeners)) {
      listener({ source, message });
    }
  }

  private async verifyPeerAuth(
    frame: Extract<RuntimeTransportHandshake, { type: 'runtime.handshake.accept' }>
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    return verifyRuntimeAuth(this.options.auth, {
      auth: frame.auth,
      source: frame.source,
      local: this.identity,
    });
  }

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
    const timestamp = new Date().toISOString();
    this.stats.lastEventAt = timestamp;
    this.options.telemetry?.({
      nodeAddress: this.identity.nodeAddress,
      timestamp,
      ...event,
    });
  }

  private recordPeerConnected(nodeAddress: string, identity: RuntimeNodeIdentity): void {
    const previous = this.stats.peers[nodeAddress];
    const connectedAt = new Date().toISOString();
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

  private recordAuthAccepted(nodeAddress: string): void {
    this.emitTelemetry({ type: 'auth.accepted', peerNodeAddress: nodeAddress });
  }

  private recordAuthRejected(nodeAddress: string, reason: string): void {
    this.setPeerStats(nodeAddress, {
      state: 'rejected',
      rejectedReason: reason,
    });
    this.emitTelemetry({ type: 'auth.rejected', peerNodeAddress: nodeAddress, reason });
  }

  private recordPeerDisconnected(nodeAddress: string, peer: BrowserPeerConnection): void {
    const previous = this.stats.peers[nodeAddress];
    const disconnectedAt = new Date().toISOString();
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

  private recordFrameSent(
    nodeAddress: string,
    peer: BrowserPeerConnection,
    frame: RuntimeTransportFrame
  ): void {
    this.stats.framesSent += 1;
    this.setPeerStats(nodeAddress, {
      identity: peer.identity,
      lastSentAt: new Date().toISOString(),
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

  private recordFrameReceived(
    nodeAddress: string,
    peer: BrowserPeerConnection,
    frame: RuntimeTransportFrame
  ): void {
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
      lastReceivedAt: new Date().toISOString(),
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

  private createMessageId(destination: string, sequence: number): string {
    return [
      this.identity.nodeAddress,
      this.identity.incarnation,
      destination,
      String(sequence),
    ].join(':');
  }

  private isDuplicateFrame(peer: BrowserPeerConnection, frame: RuntimeTransportFrame): boolean {
    return this.idempotencyWindowSize > 0 && peer.seenMessageIdSet.has(frame.messageId);
  }

  private rememberMessageId(
    nodeAddress: string,
    peer: BrowserPeerConnection,
    messageId: string
  ): void {
    if (this.idempotencyWindowSize <= 0) {
      return;
    }

    peer.seenMessageIdSet.add(messageId);
    peer.seenMessageIds.push(messageId);

    while (peer.seenMessageIds.length > this.idempotencyWindowSize) {
      const evicted = peer.seenMessageIds.shift();
      if (!evicted) {
        continue;
      }

      peer.seenMessageIdSet.delete(evicted);
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

  private recordDuplicateFrameDropped(
    nodeAddress: string,
    peer: BrowserPeerConnection,
    frame: RuntimeTransportFrame
  ): void {
    this.stats.duplicateFramesDropped += 1;
    this.setPeerStats(nodeAddress, {
      identity: peer.identity,
      duplicateFramesDropped: (this.stats.peers[nodeAddress]?.duplicateFramesDropped ?? 0) + 1,
    });
    this.emitTelemetry({
      type: 'frame.duplicate',
      peerNodeAddress: nodeAddress,
      messageType: frame.message.type,
      messageId: frame.messageId,
      sequence: frame.sequence,
    });
  }

  private isRetryableRuntimeFrame(frame: RuntimeTransportFrame): boolean {
    return frame.message.type.startsWith('__runtime.');
  }

  private enqueueFrame(
    nodeAddress: string,
    peer: BrowserPeerConnection,
    frame: RuntimeTransportFrame,
    trackAck: boolean
  ): Promise<void> {
    if (this.outboundQueueLimit >= 0 && peer.outboundQueue.length >= this.outboundQueueLimit) {
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

  private flushOutboundQueue(nodeAddress: string, peer: BrowserPeerConnection): void {
    if (peer.outboundFlushing) {
      return;
    }

    peer.outboundFlushing = true;
    try {
      while (peer.outboundQueue.length > 0) {
        if (this.peers.get(nodeAddress) !== peer || peer.socket.readyState !== WEB_SOCKET_OPEN) {
          this.rejectQueuedFrames(
            peer,
            `Transport ${this.identity.nodeAddress} is not connected to ${nodeAddress}`
          );
          return;
        }

        const item = peer.outboundQueue.shift();
        if (!item) {
          continue;
        }
        this.updateOutboundQueueDepth(nodeAddress, peer);
        try {
          this.sendJson(peer.socket, item.frame);
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
      if (peer.outboundQueue.length > 0) {
        this.flushOutboundQueue(nodeAddress, peer);
      }
    }
  }

  private rejectQueuedFrames(peer: BrowserPeerConnection, reason: string): void {
    for (const item of peer.outboundQueue.splice(0)) {
      item.reject(new Error(reason));
    }
  }

  private updateOutboundQueueDepth(nodeAddress: string, peer: BrowserPeerConnection): void {
    this.setPeerStats(nodeAddress, {
      outboundQueueDepth: peer.outboundQueue.length,
      outboundQueueLimit: this.outboundQueueLimit,
    });
    this.stats.outboundQueueDepth = Array.from(this.peers.values()).reduce(
      (total, currentPeer) => total + currentPeer.outboundQueue.length,
      0
    );
  }

  private recordOutboundQueueEnqueued(
    nodeAddress: string,
    peer: BrowserPeerConnection,
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
    peer: BrowserPeerConnection,
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

  private trackAckIfRetryable(
    nodeAddress: string,
    peer: BrowserPeerConnection,
    frame: RuntimeTransportFrame
  ): void {
    if (this.ackTimeoutMs <= 0 || this.maxAckRetries <= 0 || !this.isRetryableRuntimeFrame(frame)) {
      return;
    }

    const pending: PendingAck = {
      frame,
      retries: 0,
      timer: null,
    };
    peer.pendingAcks.set(frame.messageId, pending);
    this.armAckRetry(nodeAddress, peer, pending);
  }

  private armAckRetry(nodeAddress: string, peer: BrowserPeerConnection, pending: PendingAck): void {
    pending.timer = setTimeout(() => {
      if (this.peers.get(nodeAddress) !== peer || !peer.pendingAcks.has(pending.frame.messageId)) {
        return;
      }

      if (pending.retries >= this.maxAckRetries) {
        peer.pendingAcks.delete(pending.frame.messageId);
        this.recordRetryExhausted(nodeAddress, peer, pending.frame);
        return;
      }

      pending.retries += 1;
      this.recordFrameRetryScheduled(nodeAddress, peer, pending.frame);
      this.enqueueFrame(nodeAddress, peer, pending.frame, false)
        .then(() => this.armAckRetry(nodeAddress, peer, pending))
        .catch(() => {
          void this.disconnect(nodeAddress);
        });
    }, this.ackTimeoutMs);
  }

  private clearPendingAck(
    nodeAddress: string,
    peer: BrowserPeerConnection,
    messageId: string
  ): void {
    const pending = peer.pendingAcks.get(messageId);
    if (!pending) {
      return;
    }

    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
    peer.pendingAcks.delete(messageId);
    this.recordFrameAckReceived(nodeAddress, peer, pending.frame);
  }

  private clearPendingAcks(peer: BrowserPeerConnection): void {
    for (const pending of peer.pendingAcks.values()) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
    }
    peer.pendingAcks.clear();
  }

  private sendAck(
    nodeAddress: string,
    peer: BrowserPeerConnection,
    frame: RuntimeTransportFrame
  ): void {
    const ackFrame = createRuntimeTransportAckFrame(
      this.identity,
      peer.identity,
      frame.messageId,
      frame.sequence
    );
    this.sendJson(peer.socket, ackFrame);
    this.recordFrameAckSent(nodeAddress, frame);
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
    peer: BrowserPeerConnection,
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
    peer: BrowserPeerConnection,
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
    peer: BrowserPeerConnection,
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
    code:
      | 'malformed_frame'
      | 'missing_identity'
      | 'self_connection'
      | 'incompatible_protocol'
      | 'unauthorized',
    reason: string
  ): void {
    if (code === 'malformed_frame') {
      this.stats.malformedFramesDropped += 1;
      this.setPeerStats(nodeAddress, {
        malformedFramesDropped: (this.stats.peers[nodeAddress]?.malformedFramesDropped ?? 0) + 1,
      });
    } else {
      this.stats.validationFramesDropped += 1;
      this.setPeerStats(nodeAddress, {
        validationFramesDropped: (this.stats.peers[nodeAddress]?.validationFramesDropped ?? 0) + 1,
      });
    }
    this.emitTelemetry({ type: 'frame.dropped', peerNodeAddress: nodeAddress, reason });
  }

  private recordHeartbeatTimeout(nodeAddress: string, peer: BrowserPeerConnection): void {
    this.stats.heartbeatTimeoutCount += 1;
    this.setPeerStats(nodeAddress, {
      identity: peer.identity,
      heartbeatTimeoutCount: (this.stats.peers[nodeAddress]?.heartbeatTimeoutCount ?? 0) + 1,
    });
    this.emitTelemetry({ type: 'heartbeat.timeout', peerNodeAddress: nodeAddress });
  }

  private refreshConnectedPeerCount(): void {
    this.stats.connectedPeerCount = Array.from(this.peers.values()).filter(
      (peer) => peer.socket.readyState === WEB_SOCKET_OPEN
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

  private waitForOpen(socket: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        socket.close();
        reject(new Error('Timed out opening WebSocket transport connection.'));
      }, this.connectTimeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('error', onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('WebSocket transport connection failed.'));
      };

      socket.addEventListener('open', onOpen);
      socket.addEventListener('error', onError);
    });
  }

  private sendJson(socket: WebSocket, frame: unknown): void {
    socket.send(JSON.stringify(frame));
  }

  private async parseJson(data: unknown): Promise<unknown> {
    try {
      if (typeof data === 'string') {
        return JSON.parse(data);
      }

      if (data instanceof ArrayBuffer) {
        return JSON.parse(new TextDecoder().decode(data));
      }

      if (ArrayBuffer.isView(data)) {
        return JSON.parse(new TextDecoder().decode(data));
      }

      if (typeof Blob !== 'undefined' && data instanceof Blob) {
        return JSON.parse(await data.text());
      }

      return JSON.parse(String(data));
    } catch {
      return null;
    }
  }

  private isHandshakeAccept(
    frame: unknown
  ): frame is Extract<RuntimeTransportHandshake, { type: 'runtime.handshake.accept' }> {
    return Boolean(
      frame &&
        typeof frame === 'object' &&
        (frame as { type?: string }).type === 'runtime.handshake.accept'
    );
  }

  private isHandshakeReject(
    frame: unknown
  ): frame is Extract<RuntimeTransportHandshake, { type: 'runtime.handshake.reject' }> {
    return Boolean(
      frame &&
        typeof frame === 'object' &&
        (frame as { type?: string }).type === 'runtime.handshake.reject'
    );
  }

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
}

export function createBrowserWebSocketMessageTransport(
  options: BrowserWebSocketMessageTransportOptions
): BrowserWebSocketMessageTransport {
  return new BrowserWebSocketMessageTransport(options);
}
