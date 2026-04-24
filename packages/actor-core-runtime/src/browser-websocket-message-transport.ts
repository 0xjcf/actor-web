import type { ActorMessage, MessageTransport } from './actor-system.js';
import {
  createRuntimeNodeIdentity,
  createRuntimeTransportFrame,
  createRuntimeTransportHandshakeHello,
  createRuntimeTransportHeartbeatPing,
  createRuntimeTransportHeartbeatPong,
  type RuntimeNodeIdentity,
  type RuntimeTransportFrame,
  type RuntimeTransportHandshake,
  validateRuntimeTransportFrame,
  validateRuntimeTransportHandshake,
  validateRuntimeTransportHeartbeatFrame,
} from './runtime-transport-contract.js';

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
  webSocketFactory?: (url: string) => WebSocket;
}

type BrowserPeerConnection = {
  socket: WebSocket;
  identity: RuntimeNodeIdentity;
  sequence: number;
  lastSeenAt: number;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  heartbeatTimeout: ReturnType<typeof setTimeout> | null;
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
  private readonly webSocketFactory: (url: string) => WebSocket;

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
    this.webSocketFactory =
      options.webSocketFactory ??
      ((url) => {
        if (typeof WebSocket === 'undefined') {
          throw new Error('Browser WebSocket transport requires a global WebSocket constructor.');
        }

        return new WebSocket(url);
      });
  }

  async start(): Promise<void> {
    return Promise.resolve();
  }

  async stop(): Promise<void> {
    for (const [nodeAddress, peer] of Array.from(this.peers.entries())) {
      this.closePeer(nodeAddress, peer, false);
    }
  }

  async send(destination: string, message: ActorMessage): Promise<void> {
    const peer = this.peers.get(destination);
    if (!peer || peer.socket.readyState !== WEB_SOCKET_OPEN) {
      throw new Error(
        `Transport ${this.identity.nodeAddress} is not connected to ${destination} (readyState=${peer?.socket.readyState ?? 'missing'})`
      );
    }

    peer.sequence += 1;
    this.sendJson(
      peer.socket,
      createRuntimeTransportFrame({
        source: this.identity,
        destination: peer.identity,
        sequence: peer.sequence,
        message,
      })
    );
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
      throw new Error(`No WebSocket peer URL configured for node ${address}`);
    }

    const socket = this.webSocketFactory(url);
    try {
      await this.waitForOpen(socket);
      this.sendJson(socket, createRuntimeTransportHandshakeHello(this.identity));
      const peerIdentity = await this.waitForHandshakeAccept(socket, address);
      this.registerPeer(socket, peerIdentity);
    } catch (error) {
      socket.close();
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

          if (frame.source.nodeAddress !== expectedNodeAddress) {
            cleanup();
            socket.close();
            reject(
              new Error(`Runtime handshake accepted unexpected node ${frame.source.nodeAddress}.`)
            );
            return;
          }

          cleanup();
          resolve(frame.source);
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
      lastSeenAt: Date.now(),
      heartbeatInterval: null,
      heartbeatTimeout: null,
    };
    this.peers.set(identity.nodeAddress, peer);

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

    const validation = validateRuntimeTransportFrame(frame, this.identity);
    if (!validation.ok) {
      await this.disconnect(sourceNodeAddress);
      return;
    }

    const runtimeFrame = frame as RuntimeTransportFrame;
    if (
      runtimeFrame.source.nodeAddress !== sourceNodeAddress ||
      runtimeFrame.source.nodeId !== peer.identity.nodeId ||
      runtimeFrame.source.incarnation !== peer.identity.incarnation
    ) {
      await this.disconnect(sourceNodeAddress);
      return;
    }

    this.markPeerSeen(sourceNodeAddress, peer.socket);
    this.emitTransportMessage(runtimeFrame.source.nodeAddress, runtimeFrame.message);
  }

  private handleHeartbeatFrame(
    sourceNodeAddress: string,
    peer: BrowserPeerConnection,
    frame: unknown
  ): void {
    const validation = validateRuntimeTransportHeartbeatFrame(frame, this.identity);
    if (!validation.ok || !this.isHeartbeatFrame(frame)) {
      void this.disconnect(sourceNodeAddress);
      return;
    }

    if (
      frame.source.nodeAddress !== sourceNodeAddress ||
      frame.source.nodeId !== peer.identity.nodeId ||
      frame.source.incarnation !== peer.identity.incarnation
    ) {
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
    this.peers.delete(nodeAddress);
    peer.socket.close();

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
}

export function createBrowserWebSocketMessageTransport(
  options: BrowserWebSocketMessageTransportOptions
): BrowserWebSocketMessageTransport {
  return new BrowserWebSocketMessageTransport(options);
}
