import WebSocket, { WebSocketServer } from 'ws';
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
  createRuntimeTransportHandshakeAccept,
  createRuntimeTransportHandshakeHello,
  createRuntimeTransportHandshakeReject,
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

export interface NodeWebSocketMessageTransportOptions {
  nodeAddress: string;
  nodeId?: string;
  incarnation?: string;
  capabilities?: readonly string[];
  listen?: {
    host?: string;
    port?: number;
  };
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
  auth?: RuntimeTransportAuthProvider<{
    readonly source: RuntimeNodeIdentity;
    readonly local: RuntimeNodeIdentity;
  }>;
}

export type NodeWebSocketPeerState =
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'disconnected'
  | 'rejected';

export interface NodeWebSocketPeerSnapshot {
  nodeAddress: string;
  identity?: RuntimeNodeIdentity;
  state: NodeWebSocketPeerState;
  lastSeenAt?: string;
  rejectedReason?: string;
}

type PeerConnection = {
  socket: WebSocket;
  identity: RuntimeNodeIdentity;
  sequence: number;
  lastReceivedSequence: number;
  seenMessageIds: string[];
  seenMessageIdSet: Set<string>;
  pendingAcks: Map<string, PendingAck>;
  outboundQueue: OutboundQueueItem[];
  outboundFlushing: boolean;
  state: NodeWebSocketPeerState;
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

export class NodeWebSocketMessageTransport implements MessageTransport {
  private readonly listeners = new Set<
    (event: { source: string; message: ActorMessage }) => void
  >();
  private readonly peers = new Map<string, PeerConnection>();
  private readonly peerSnapshots = new Map<string, NodeWebSocketPeerSnapshot>();
  private readonly identity: RuntimeNodeIdentity;
  private readonly connectTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly idempotencyWindowSize: number;
  private readonly ackTimeoutMs: number;
  private readonly maxAckRetries: number;
  private readonly outboundQueueLimit: number;
  private readonly stats: RuntimeTransportStats;
  private server: WebSocketServer | null = null;
  private listeningUrl: string | null = null;

  constructor(private readonly options: NodeWebSocketMessageTransportOptions) {
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
    this.stats = this.createInitialStats();
  }

  async start(): Promise<void> {
    if (!this.options.listen || this.server) {
      return;
    }

    const host = this.options.listen.host ?? '127.0.0.1';
    const port = this.options.listen.port ?? 0;

    this.server = new WebSocketServer({ host, port });
    this.server.on('connection', (socket) => {
      this.acceptInboundConnection(socket);
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server;
      if (!server) {
        reject(new Error('WebSocket server was not created.'));
        return;
      }

      server.once('listening', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('WebSocket server did not expose a TCP address.'));
          return;
        }

        this.listeningUrl = `ws://${address.address}:${address.port}`;
        this.stats.startedAt = new Date().toISOString();
        this.emitTelemetry({ type: 'transport.started' });
        resolve();
      });
      server.once('error', reject);
    });
  }

  async stop(): Promise<void> {
    for (const [nodeAddress, peer] of Array.from(this.peers.entries())) {
      this.closePeer(nodeAddress, peer, false);
    }

    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = null;
    this.listeningUrl = null;
    this.stats.stoppedAt = new Date().toISOString();
    this.emitTelemetry({ type: 'transport.stopped' });

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  getListeningUrl(): string | null {
    return this.listeningUrl;
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
    if (!peer || peer.state !== 'connected' || peer.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Transport ${this.identity.nodeAddress} is not connected to ${destination}`);
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
    if (existing?.state === 'connected' && existing.socket.readyState === WebSocket.OPEN) {
      return;
    }

    this.setPeerSnapshot(address, { state: 'connecting' });
    this.setPeerStats(address, { state: 'connecting' });
    this.emitTelemetry({ type: 'peer.connecting', peerNodeAddress: address });

    const url = await this.resolvePeerUrl(address);
    if (!url) {
      this.setPeerSnapshot(address, {
        state: 'rejected',
        rejectedReason: `No WebSocket peer URL configured for node ${address}`,
      });
      this.recordHandshakeRejected(address, `No WebSocket peer URL configured for node ${address}`);
      throw new Error(`No WebSocket peer URL configured for node ${address}`);
    }

    const socket = new WebSocket(url);
    try {
      await this.waitForOpen(socket);
      await this.sendJson(
        socket,
        createRuntimeTransportHandshakeHello(this.identity, {
          auth: await resolveRuntimeAuthPayload(this.options.auth),
        })
      );
      const peerIdentity = await this.waitForHandshakeAccept(socket, address);
      this.registerPeer(socket, peerIdentity);
    } catch (error) {
      this.setPeerSnapshot(address, {
        state: 'rejected',
        rejectedReason: error instanceof Error ? error.message : 'Runtime peer connection failed.',
      });
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
      .filter(([, peer]) => peer.state === 'connected' && peer.socket.readyState === WebSocket.OPEN)
      .map(([nodeAddress]) => nodeAddress);
  }

  isConnected(address: string): boolean {
    const peer = this.peers.get(address);
    return peer?.state === 'connected' && peer.socket.readyState === WebSocket.OPEN;
  }

  getPeerState(nodeAddress: string): NodeWebSocketPeerState | undefined {
    return this.peerSnapshots.get(nodeAddress)?.state;
  }

  getPeerSnapshot(nodeAddress: string): NodeWebSocketPeerSnapshot | undefined {
    const snapshot = this.peerSnapshots.get(nodeAddress);
    if (!snapshot) {
      return undefined;
    }

    return {
      ...snapshot,
      ...(snapshot.identity ? { identity: { ...snapshot.identity } } : {}),
    };
  }

  getPeerIdentity(nodeAddress: string): RuntimeNodeIdentity | undefined {
    const identity =
      this.peers.get(nodeAddress)?.identity ?? this.peerSnapshots.get(nodeAddress)?.identity;
    return identity ? { ...identity } : undefined;
  }

  private async resolvePeerUrl(nodeAddress: string): Promise<string | undefined> {
    return this.options.peers?.[nodeAddress] ?? this.options.peerUrlResolver?.(nodeAddress);
  }

  private acceptInboundConnection(socket: WebSocket): void {
    const timeout = setTimeout(() => {
      void this.rejectAndClose(socket, 'malformed_frame', 'Runtime handshake was not received.');
    }, this.connectTimeoutMs);

    socket.once('message', (data) => {
      clearTimeout(timeout);
      void this.handleInboundHandshake(socket, data);
    });
    socket.once('error', () => {
      clearTimeout(timeout);
    });
    socket.once('close', () => {
      clearTimeout(timeout);
    });
  }

  private async handleInboundHandshake(socket: WebSocket, data: WebSocket.RawData): Promise<void> {
    const frame = this.parseJson(data);
    const validation = validateRuntimeTransportHandshake(frame, this.identity);
    if (!validation.ok) {
      await this.rejectAndClose(socket, validation.code, validation.message);
      return;
    }

    if (!this.isHandshakeHello(frame)) {
      await this.rejectAndClose(socket, 'malformed_frame', 'Expected runtime handshake hello.');
      return;
    }

    const auth = await this.verifyPeerAuth(frame);
    if (!auth.ok) {
      this.recordAuthRejected(frame.source.nodeAddress, auth.reason, frame.source);
      this.recordHandshakeRejected(frame.source.nodeAddress, auth.reason, frame.source);
      await this.rejectAndClose(socket, 'unauthorized', auth.reason);
      return;
    }
    this.recordAuthAccepted(frame.source.nodeAddress);

    const acceptance = this.canAcceptPeer(frame.source);
    if (!acceptance.ok) {
      if (!this.peers.has(frame.source.nodeAddress)) {
        this.setPeerSnapshot(frame.source.nodeAddress, {
          state: 'rejected',
          identity: frame.source,
          rejectedReason: acceptance.message,
        });
      }
      this.recordHandshakeRejected(frame.source.nodeAddress, acceptance.message, frame.source);
      await this.rejectAndClose(socket, 'malformed_frame', acceptance.message);
      return;
    }

    await this.sendJson(
      socket,
      createRuntimeTransportHandshakeAccept(this.identity, frame.source, {
        auth: await resolveRuntimeAuthPayload(this.options.auth),
      })
    );
    this.registerPeer(socket, frame.source);
  }

  private async waitForHandshakeAccept(
    socket: WebSocket,
    expectedNodeAddress: string
  ): Promise<RuntimeNodeIdentity> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        socket.close();
        reject(new Error(`Timed out waiting for runtime handshake from ${expectedNodeAddress}`));
      }, this.connectTimeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        socket.off('message', onMessage);
        socket.off('close', onClose);
        socket.off('error', onError);
      };

      const onClose = () => {
        cleanup();
        reject(new Error(`WebSocket closed before runtime handshake from ${expectedNodeAddress}`));
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onMessage = (data: WebSocket.RawData) => {
        const frame = this.parseJson(data);
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
            this.recordAuthRejected(frame.source.nodeAddress, auth.reason, frame.source);
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

          const acceptance = this.canAcceptPeer(frame.source);
          if (!acceptance.ok) {
            socket.close();
            reject(new Error(acceptance.message));
            return;
          }

          resolve(frame.source);
        }, reject);
        return;
      };

      socket.on('message', onMessage);
      socket.on('close', onClose);
      socket.on('error', onError);
    });
  }

  private registerPeer(socket: WebSocket, identity: RuntimeNodeIdentity): void {
    const existing = this.peers.get(identity.nodeAddress);
    if (existing && existing.socket !== socket) {
      this.closePeer(identity.nodeAddress, existing, false);
    }

    const peer: PeerConnection = {
      socket,
      identity,
      sequence: 0,
      lastReceivedSequence: 0,
      seenMessageIds: [],
      seenMessageIdSet: new Set<string>(),
      pendingAcks: new Map<string, PendingAck>(),
      outboundQueue: [],
      outboundFlushing: false,
      state: 'connected',
      lastSeenAt: Date.now(),
      heartbeatInterval: null,
      heartbeatTimeout: null,
    };
    this.peers.set(identity.nodeAddress, peer);
    this.recordPeerConnected(identity.nodeAddress, identity);
    this.setPeerSnapshot(identity.nodeAddress, {
      state: 'connected',
      identity,
      lastSeenAt: new Date(peer.lastSeenAt).toISOString(),
    });

    socket.on('message', (data) => {
      this.handleRuntimeFrame(identity.nodeAddress, socket, data);
    });
    socket.on('pong', () => {
      this.markPeerSeen(identity.nodeAddress, socket);
    });
    socket.on('close', () => {
      this.handlePeerClosed(identity.nodeAddress, socket);
    });
    socket.on('error', () => {
      this.handlePeerClosed(identity.nodeAddress, socket);
    });

    this.startHeartbeat(identity.nodeAddress, peer);

    this.emitTransportMessage(identity.nodeAddress, {
      type: '__runtime.transport.connected',
      nodeAddress: identity.nodeAddress,
      _timestamp: Date.now(),
      _version: '1.0.0',
    } as ActorMessage<{ type: '__runtime.transport.connected'; nodeAddress: string }>);
  }

  private handleRuntimeFrame(
    sourceNodeAddress: string,
    socket: WebSocket,
    data: WebSocket.RawData
  ): void {
    const peer = this.peers.get(sourceNodeAddress);
    if (!peer || peer.socket !== socket || peer.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const frame = this.parseJson(data);
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
      this.disconnect(sourceNodeAddress).catch(() => {});
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
      this.disconnect(sourceNodeAddress).catch(() => {});
      return;
    }

    this.markPeerSeen(sourceNodeAddress, peer.socket);
    if (this.isDuplicateFrame(peer, runtimeFrame)) {
      this.recordDuplicateFrameDropped(sourceNodeAddress, peer, runtimeFrame);
      this.sendAck(sourceNodeAddress, peer, runtimeFrame).catch(() => {
        this.disconnect(sourceNodeAddress).catch(() => {});
      });
      return;
    }

    this.rememberMessageId(sourceNodeAddress, peer, runtimeFrame.messageId);
    this.recordFrameReceived(sourceNodeAddress, peer, runtimeFrame);
    this.sendAck(sourceNodeAddress, peer, runtimeFrame).catch(() => {
      this.disconnect(sourceNodeAddress).catch(() => {});
    });
    this.emitTransportMessage(runtimeFrame.source.nodeAddress, runtimeFrame.message);
  }

  private handleAckFrame(sourceNodeAddress: string, peer: PeerConnection, frame: unknown): void {
    const validation = validateRuntimeTransportAckFrame(frame, this.identity);
    if (!validation.ok) {
      this.recordFrameDropped(sourceNodeAddress, validation.code, validation.message);
      this.disconnect(sourceNodeAddress).catch(() => {});
      return;
    }

    const ackFrame = frame as ReturnType<typeof createRuntimeTransportAckFrame>;
    if (
      ackFrame.source.nodeAddress !== sourceNodeAddress ||
      ackFrame.source.nodeId !== peer.identity.nodeId ||
      ackFrame.source.incarnation !== peer.identity.incarnation
    ) {
      this.recordFrameDropped(sourceNodeAddress, 'malformed_frame', 'Runtime ack source mismatch.');
      this.disconnect(sourceNodeAddress).catch(() => {});
      return;
    }

    this.markPeerSeen(sourceNodeAddress, peer.socket);
    this.clearPendingAck(sourceNodeAddress, peer, ackFrame.messageId);
  }

  private handleHeartbeatFrame(
    sourceNodeAddress: string,
    peer: PeerConnection,
    frame: unknown
  ): void {
    const validation = validateRuntimeTransportHeartbeatFrame(frame, this.identity);
    if (!validation.ok) {
      this.recordFrameDropped(sourceNodeAddress, validation.code, validation.message);
      this.disconnect(sourceNodeAddress).catch(() => {});
      return;
    }
    if (!this.isHeartbeatFrame(frame)) {
      this.recordFrameDropped(sourceNodeAddress, 'malformed_frame', 'Unsupported heartbeat frame.');
      this.disconnect(sourceNodeAddress).catch(() => {});
      return;
    }

    if (
      frame.source.nodeAddress !== sourceNodeAddress ||
      frame.source.nodeId !== peer.identity.nodeId ||
      frame.source.incarnation !== peer.identity.incarnation
    ) {
      this.recordFrameDropped(sourceNodeAddress, 'malformed_frame', 'Heartbeat source mismatch.');
      this.disconnect(sourceNodeAddress).catch(() => {});
      return;
    }

    this.markPeerSeen(sourceNodeAddress, peer.socket);
    if (frame.type === 'runtime.transport.ping') {
      this.sendJson(
        peer.socket,
        createRuntimeTransportHeartbeatPong(this.identity, peer.identity)
      ).catch(() => {
        this.disconnect(sourceNodeAddress).catch(() => {});
      });
    }
  }

  private closePeer(nodeAddress: string, peer: PeerConnection, emitDisconnected: boolean): void {
    this.clearHeartbeat(peer);
    this.clearPendingAcks(peer);
    this.rejectQueuedFrames(
      peer,
      `Transport ${this.identity.nodeAddress} disconnected from ${nodeAddress}`
    );
    peer.state = 'disconnecting';
    this.setPeerSnapshot(nodeAddress, {
      state: 'disconnecting',
      identity: peer.identity,
      lastSeenAt: new Date(peer.lastSeenAt).toISOString(),
    });
    this.setPeerStats(nodeAddress, { state: 'disconnecting' });
    this.peers.delete(nodeAddress);
    peer.socket.close();
    peer.state = 'disconnected';
    this.setPeerSnapshot(nodeAddress, {
      state: 'disconnected',
      identity: peer.identity,
      lastSeenAt: new Date(peer.lastSeenAt).toISOString(),
    });
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

  private emitTransportMessage(source: string, message: ActorMessage): void {
    for (const listener of Array.from(this.listeners)) {
      listener({ source, message });
    }
  }

  private canAcceptPeer(
    identity: RuntimeNodeIdentity
  ): { ok: true } | { ok: false; message: string } {
    const existing = this.peers.get(identity.nodeAddress);
    if (!existing) {
      return { ok: true };
    }

    if (existing.identity.nodeId !== identity.nodeId) {
      return {
        ok: false,
        message: `Runtime peer identity conflict for ${identity.nodeAddress}.`,
      };
    }

    return { ok: true };
  }

  private async verifyPeerAuth(
    frame: Extract<
      RuntimeTransportHandshake,
      { type: 'runtime.handshake.hello' | 'runtime.handshake.accept' }
    >
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    return verifyRuntimeAuth(this.options.auth, {
      auth: frame.auth,
      source: frame.source,
      local: this.identity,
    });
  }

  private setPeerSnapshot(
    nodeAddress: string,
    update: Omit<NodeWebSocketPeerSnapshot, 'nodeAddress'>
  ): void {
    this.peerSnapshots.set(nodeAddress, {
      nodeAddress,
      ...update,
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

  private recordHandshakeRejected(
    nodeAddress: string,
    reason: string,
    identity?: RuntimeNodeIdentity
  ): void {
    const previous = this.stats.peers[nodeAddress];
    this.stats.handshakeRejectedCount += 1;
    this.setPeerStats(nodeAddress, {
      state: 'rejected',
      ...(identity ? { identity } : {}),
      handshakeRejectedCount: (previous?.handshakeRejectedCount ?? 0) + 1,
      rejectedReason: reason,
    });
    this.emitTelemetry({ type: 'handshake.rejected', peerNodeAddress: nodeAddress, reason });
    this.emitTelemetry({ type: 'peer.rejected', peerNodeAddress: nodeAddress, reason });
  }

  private recordAuthAccepted(nodeAddress: string): void {
    this.emitTelemetry({ type: 'auth.accepted', peerNodeAddress: nodeAddress });
  }

  private recordAuthRejected(
    nodeAddress: string,
    reason: string,
    identity?: RuntimeNodeIdentity
  ): void {
    this.setPeerSnapshot(nodeAddress, {
      state: 'rejected',
      ...(identity ? { identity } : {}),
      rejectedReason: reason,
    });
    this.setPeerStats(nodeAddress, {
      state: 'rejected',
      ...(identity ? { identity } : {}),
      rejectedReason: reason,
    });
    this.emitTelemetry({ type: 'auth.rejected', peerNodeAddress: nodeAddress, reason });
  }

  private recordPeerDisconnected(nodeAddress: string, peer: PeerConnection): void {
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
    peer: PeerConnection,
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
    peer: PeerConnection,
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

  private isDuplicateFrame(peer: PeerConnection, frame: RuntimeTransportFrame): boolean {
    return this.idempotencyWindowSize > 0 && peer.seenMessageIdSet.has(frame.messageId);
  }

  private rememberMessageId(nodeAddress: string, peer: PeerConnection, messageId: string): void {
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
    peer: PeerConnection,
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
    peer: PeerConnection,
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

  private flushOutboundQueue(nodeAddress: string, peer: PeerConnection): void {
    if (peer.outboundFlushing) {
      return;
    }

    peer.outboundFlushing = true;
    void this.drainOutboundQueue(nodeAddress, peer);
  }

  private async drainOutboundQueue(nodeAddress: string, peer: PeerConnection): Promise<void> {
    try {
      while (peer.outboundQueue.length > 0) {
        if (this.peers.get(nodeAddress) !== peer || peer.socket.readyState !== WebSocket.OPEN) {
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
          await this.sendJson(peer.socket, item.frame);
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
          this.disconnect(nodeAddress).catch(() => {});
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

  private rejectQueuedFrames(peer: PeerConnection, reason: string): void {
    for (const item of peer.outboundQueue.splice(0)) {
      item.reject(new Error(reason));
    }
  }

  private updateOutboundQueueDepth(nodeAddress: string, peer: PeerConnection): void {
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
    peer: PeerConnection,
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
    peer: PeerConnection,
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
    peer: PeerConnection,
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

  private armAckRetry(nodeAddress: string, peer: PeerConnection, pending: PendingAck): void {
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
          this.disconnect(nodeAddress).catch(() => {});
        });
    }, this.ackTimeoutMs);
  }

  private clearPendingAck(nodeAddress: string, peer: PeerConnection, messageId: string): void {
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

  private clearPendingAcks(peer: PeerConnection): void {
    for (const pending of peer.pendingAcks.values()) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
    }
    peer.pendingAcks.clear();
  }

  private async sendAck(
    nodeAddress: string,
    peer: PeerConnection,
    frame: RuntimeTransportFrame
  ): Promise<void> {
    const ackFrame = createRuntimeTransportAckFrame(
      this.identity,
      peer.identity,
      frame.messageId,
      frame.sequence
    );
    await this.sendJson(peer.socket, ackFrame);
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
    peer: PeerConnection,
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
    peer: PeerConnection,
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
    peer: PeerConnection,
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

  private recordHeartbeatTimeout(nodeAddress: string, peer: PeerConnection): void {
    this.stats.heartbeatTimeoutCount += 1;
    this.setPeerStats(nodeAddress, {
      identity: peer.identity,
      heartbeatTimeoutCount: (this.stats.peers[nodeAddress]?.heartbeatTimeoutCount ?? 0) + 1,
    });
    this.emitTelemetry({ type: 'heartbeat.timeout', peerNodeAddress: nodeAddress });
  }

  private refreshConnectedPeerCount(): void {
    this.stats.connectedPeerCount = Array.from(this.peers.values()).filter(
      (peer) => peer.state === 'connected' && peer.socket.readyState === WebSocket.OPEN
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

  private startHeartbeat(nodeAddress: string, peer: PeerConnection): void {
    if (this.heartbeatIntervalMs <= 0) {
      return;
    }

    peer.heartbeatInterval = setInterval(() => {
      if (peer.socket.readyState !== WebSocket.OPEN || this.peers.get(nodeAddress) !== peer) {
        this.clearHeartbeat(peer);
        return;
      }

      peer.socket.ping();
      this.armHeartbeatTimeout(nodeAddress, peer);
    }, this.heartbeatIntervalMs);
  }

  private armHeartbeatTimeout(nodeAddress: string, peer: PeerConnection): void {
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

  private clearHeartbeat(peer: PeerConnection): void {
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
    this.setPeerSnapshot(nodeAddress, {
      state: peer.state,
      identity: peer.identity,
      lastSeenAt: new Date(peer.lastSeenAt).toISOString(),
    });
  }

  private async rejectAndClose(
    socket: WebSocket,
    code: Parameters<typeof createRuntimeTransportHandshakeReject>[0],
    message: string
  ): Promise<void> {
    if (socket.readyState === WebSocket.OPEN) {
      await this.sendJson(
        socket,
        createRuntimeTransportHandshakeReject(code, message, { source: this.identity })
      );
    }
    socket.close();
  }

  private async waitForOpen(socket: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        socket.close();
        reject(new Error('Timed out opening WebSocket transport connection.'));
      }, this.connectTimeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        socket.off('open', onOpen);
        socket.off('error', onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      socket.on('open', onOpen);
      socket.on('error', onError);
    });
  }

  private async sendJson(socket: WebSocket, frame: unknown): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      socket.send(JSON.stringify(frame), (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private parseJson(data: WebSocket.RawData): unknown {
    const text = Array.isArray(data)
      ? Buffer.concat(data).toString('utf8')
      : data instanceof ArrayBuffer
        ? Buffer.from(data).toString('utf8')
        : Buffer.from(data).toString('utf8');
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private isHandshakeHello(
    frame: unknown
  ): frame is Extract<RuntimeTransportHandshake, { type: 'runtime.handshake.hello' }> {
    return Boolean(
      frame &&
        typeof frame === 'object' &&
        (frame as { type?: string }).type === 'runtime.handshake.hello'
    );
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

export function createNodeWebSocketMessageTransport(
  options: NodeWebSocketMessageTransportOptions
): NodeWebSocketMessageTransport {
  return new NodeWebSocketMessageTransport(options);
}
