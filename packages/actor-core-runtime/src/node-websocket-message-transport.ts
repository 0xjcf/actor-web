import WebSocket, { WebSocketServer } from 'ws';
import type { ActorMessage, MessageTransport } from './actor-system.js';
import {
  createRuntimeNodeIdentity,
  createRuntimeTransportFrame,
  createRuntimeTransportHandshakeAccept,
  createRuntimeTransportHandshakeHello,
  createRuntimeTransportHandshakeReject,
  type RuntimeNodeIdentity,
  type RuntimeTransportFrame,
  type RuntimeTransportHandshake,
  validateRuntimeTransportFrame,
  validateRuntimeTransportHandshake,
} from './runtime-transport-contract.js';

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
}

type PeerConnection = {
  socket: WebSocket;
  identity: RuntimeNodeIdentity;
  sequence: number;
};

export class NodeWebSocketMessageTransport implements MessageTransport {
  private readonly listeners = new Set<
    (event: { source: string; message: ActorMessage }) => void
  >();
  private readonly peers = new Map<string, PeerConnection>();
  private readonly identity: RuntimeNodeIdentity;
  private readonly connectTimeoutMs: number;
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

  async send(destination: string, message: ActorMessage): Promise<void> {
    const peer = this.peers.get(destination);
    if (!peer || peer.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Transport ${this.identity.nodeAddress} is not connected to ${destination}`);
    }

    peer.sequence += 1;
    const frame = createRuntimeTransportFrame({
      source: this.identity,
      destination: peer.identity,
      sequence: peer.sequence,
      message,
    });

    await this.sendJson(peer.socket, frame);
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
    if (existing?.socket.readyState === WebSocket.OPEN) {
      return;
    }

    const url = await this.resolvePeerUrl(address);
    if (!url) {
      throw new Error(`No WebSocket peer URL configured for node ${address}`);
    }

    const socket = new WebSocket(url);
    await this.waitForOpen(socket);
    await this.sendJson(socket, createRuntimeTransportHandshakeHello(this.identity));
    const peerIdentity = await this.waitForHandshakeAccept(socket, address);
    this.registerPeer(socket, peerIdentity);
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
      .filter(([, peer]) => peer.socket.readyState === WebSocket.OPEN)
      .map(([nodeAddress]) => nodeAddress);
  }

  isConnected(address: string): boolean {
    return this.peers.get(address)?.socket.readyState === WebSocket.OPEN;
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

    await this.sendJson(socket, createRuntimeTransportHandshakeAccept(this.identity, frame.source));
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
      };

      socket.on('message', onMessage);
      socket.on('close', onClose);
      socket.on('error', onError);
    });
  }

  private registerPeer(socket: WebSocket, identity: RuntimeNodeIdentity): void {
    const existing = this.peers.get(identity.nodeAddress);
    if (existing && existing.socket !== socket) {
      existing.socket.close();
    }

    this.peers.set(identity.nodeAddress, {
      socket,
      identity,
      sequence: 0,
    });

    socket.on('message', (data) => {
      this.handleRuntimeFrame(identity.nodeAddress, data);
    });
    socket.on('close', () => {
      this.handlePeerClosed(identity.nodeAddress, socket);
    });
    socket.on('error', () => {
      this.handlePeerClosed(identity.nodeAddress, socket);
    });

    this.emitTransportMessage(identity.nodeAddress, {
      type: '__runtime.transport.connected',
      nodeAddress: identity.nodeAddress,
      _timestamp: Date.now(),
      _version: '1.0.0',
    } as ActorMessage<{ type: '__runtime.transport.connected'; nodeAddress: string }>);
  }

  private handleRuntimeFrame(sourceNodeAddress: string, data: WebSocket.RawData): void {
    const frame = this.parseJson(data);
    const validation = validateRuntimeTransportFrame(frame, this.identity);
    if (!validation.ok) {
      this.disconnect(sourceNodeAddress).catch(() => {});
      return;
    }

    const runtimeFrame = frame as RuntimeTransportFrame;
    if (runtimeFrame.source.nodeAddress !== sourceNodeAddress) {
      this.disconnect(sourceNodeAddress).catch(() => {});
      return;
    }

    this.emitTransportMessage(runtimeFrame.source.nodeAddress, runtimeFrame.message);
  }

  private closePeer(nodeAddress: string, peer: PeerConnection, emitDisconnected: boolean): void {
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

  private emitTransportMessage(source: string, message: ActorMessage): void {
    for (const listener of Array.from(this.listeners)) {
      listener({ source, message });
    }
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
}

export function createNodeWebSocketMessageTransport(
  options: NodeWebSocketMessageTransportOptions
): NodeWebSocketMessageTransport {
  return new NodeWebSocketMessageTransport(options);
}
