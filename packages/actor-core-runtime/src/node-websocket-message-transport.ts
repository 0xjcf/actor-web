// Adapter: the node WebSocket TransportChannel. All reliability machinery (ack/retry,
// outbound queue, heartbeat engine, stats/telemetry, sequence, dispatch, idempotency) now
// lives in TransportCore (transport/transport-core.ts); this file is a thin channel that
// (a) dials peers + runs the client handshake, (b) listens for inbound peers + runs the
// server handshake, and (c) wraps each ws socket in a PeerLink whose heartbeat uses NATIVE
// ws ping/pong so the wire stays byte-identical to the pre-core node transport. The public
// createNodeWebSocketMessageTransport factory and the NodeWebSocketMessageTransport surface
// (getListeningUrl, start/stop, getStats/getPeerStats, send/subscribe/connect/disconnect/
// isConnected/getConnectedNodes, plus the node-specific getPeerState/getPeerSnapshot/
// getPeerIdentity views) are preserved verbatim.

import WebSocket, { WebSocketServer } from 'ws';
import type { ActorMessage, MessageTransport } from './actor-system.js';
import {
  type RuntimeTransportAuthProvider,
  resolveRuntimeAuthPayload,
  verifyRuntimeAuth,
} from './runtime-auth.js';
import {
  createRuntimeNodeIdentity,
  createRuntimeTransportHandshakeAccept,
  createRuntimeTransportHandshakeHello,
  createRuntimeTransportHandshakeReject,
  type RuntimeNodeIdentity,
  type RuntimeTransportHandshake,
  validateRuntimeTransportHandshake,
} from './runtime-transport-contract.js';
import type { RuntimeTransportIdempotencyProvider } from './runtime-transport-idempotency.js';
import type {
  RuntimeTransportPeerStats,
  RuntimeTransportStats,
  RuntimeTransportTelemetryEvent,
  RuntimeTransportTelemetryObserver,
} from './runtime-transport-telemetry.js';
import type {
  DialResult,
  PeerLink,
  PeerLinkHeartbeat,
  PeerLinkSink,
  TransportChannel,
  TransportListenHandle,
} from './transport/transport-channel.js';
import { TransportCore } from './transport/transport-core.js';

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
  idempotencyProvider?: RuntimeTransportIdempotencyProvider;
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

/**
 * Emits transport telemetry envelopes (nodeAddress + timestamp) through the caller-supplied
 * observer. Shared by the channel (handshake/auth telemetry on the server inbound path) and
 * the core (everything else) so a single observer sees one consistent event stream — exactly
 * as the pre-core single-class transport did.
 */
function createTelemetryEmitter(
  localNodeAddress: string,
  telemetry: RuntimeTransportTelemetryObserver | undefined
): (event: Omit<RuntimeTransportTelemetryEvent, 'nodeAddress' | 'timestamp'>) => void {
  return (event) => {
    telemetry?.({
      nodeAddress: localNodeAddress,
      timestamp: new Date().toISOString(),
      ...event,
    } as RuntimeTransportTelemetryEvent);
  };
}

/**
 * One live ws socket as a PeerLink. The core owns all reliability; this link only moves
 * opaque JSON payloads (byte-identical to the pre-core sendJson/parseJson), reports raw
 * liveness via ws.readyState, and exposes NATIVE ws ping/pong as its heartbeat so the wire
 * stays unchanged (no JSON heartbeat frames on node).
 */
class NodeWebSocketPeerLink implements PeerLink {
  readonly heartbeat: PeerLinkHeartbeat;
  private sink: PeerLinkSink | null = null;
  private closed = false;

  constructor(
    readonly socket: WebSocket,
    readonly remoteAddress: string,
    readonly identity: RuntimeNodeIdentity
  ) {
    this.heartbeat = {
      ping: () => {
        if (this.socket.readyState === WebSocket.OPEN) {
          this.socket.ping();
        }
      },
      onAlive: (listener) => {
        const onPong = (): void => listener();
        this.socket.on('pong', onPong);
        return () => {
          this.socket.off('pong', onPong);
        };
      },
    };
  }

  get isOpen(): boolean {
    return !this.closed && this.socket.readyState === WebSocket.OPEN;
  }

  send(payload: unknown): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.socket.send(
        // Core hands a pre-serialized JSON string; transmit it verbatim for byte parity.
        typeof payload === 'string' ? payload : JSON.stringify(payload),
        (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        }
      );
    });
  }

  receive(sink: PeerLinkSink): () => void {
    this.sink = sink;
    const onMessage = (data: WebSocket.RawData): void => {
      this.sink?.onPayload(parseJson(data));
    };
    const onClose = (): void => {
      this.sink?.onClosed('socket closed');
    };
    const onError = (): void => {
      this.sink?.onClosed('socket error');
    };
    this.socket.on('message', onMessage);
    this.socket.on('close', onClose);
    this.socket.on('error', onError);
    return () => {
      this.socket.off('message', onMessage);
      this.socket.off('close', onClose);
      this.socket.off('error', onError);
      this.sink = null;
    };
  }

  close(): void {
    // Idempotent; never throws (errors-as-values at the adapter seam).
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      this.socket.close();
    } catch {
      // closing an already-closed/erroring socket is a fact, not an error.
    }
  }
}

function parseJson(data: WebSocket.RawData): unknown {
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

function isHandshakeHello(
  frame: unknown
): frame is Extract<RuntimeTransportHandshake, { type: 'runtime.handshake.hello' }> {
  return Boolean(
    frame &&
      typeof frame === 'object' &&
      (frame as { type?: string }).type === 'runtime.handshake.hello'
  );
}

function isHandshakeAccept(
  frame: unknown
): frame is Extract<RuntimeTransportHandshake, { type: 'runtime.handshake.accept' }> {
  return Boolean(
    frame &&
      typeof frame === 'object' &&
      (frame as { type?: string }).type === 'runtime.handshake.accept'
  );
}

function isHandshakeReject(
  frame: unknown
): frame is Extract<RuntimeTransportHandshake, { type: 'runtime.handshake.reject' }> {
  return Boolean(
    frame &&
      typeof frame === 'object' &&
      (frame as { type?: string }).type === 'runtime.handshake.reject'
  );
}

function sendJson(socket: WebSocket, frame: unknown): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.send(JSON.stringify(frame), (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

interface NodeChannelDeps {
  readonly identity: RuntimeNodeIdentity;
  readonly connectTimeoutMs: number;
  readonly listen: NodeWebSocketMessageTransportOptions['listen'];
  readonly auth: NodeWebSocketMessageTransportOptions['auth'];
  /** Resolve a peer URL on demand — reads the live options so a test/caller can rebind it. */
  readonly resolvePeerUrl: (nodeAddress: string) => Promise<string | undefined>;
  readonly emitTelemetry: (
    event: Omit<RuntimeTransportTelemetryEvent, 'nodeAddress' | 'timestamp'>
  ) => void;
  /** The core's view of currently registered peers, for inbound identity-conflict checks. */
  readonly getPeerIdentity: (nodeAddress: string) => RuntimeNodeIdentity | undefined;
  /** Records an inbound auth/handshake rejection in the node peer-snapshot view. */
  readonly recordRejectedSnapshot: (
    nodeAddress: string,
    reason: string,
    identity?: RuntimeNodeIdentity
  ) => void;
  /**
   * Reports an inbound handshake rejection to the core so its stats/telemetry reflect it
   * (state='rejected', rejectedReason, handshakeRejectedCount++, auth.rejected /
   * handshake.rejected / peer.rejected events) — the pre-core acceptInboundConnection ->
   * recordAuthRejected + recordHandshakeRejected path. `auth` distinguishes a failed shared
   * secret (emits auth.rejected too) from a structural handshake/identity-conflict rejection.
   */
  readonly recordInboundRejected: (
    nodeAddress: string,
    reason: string,
    options: { readonly auth: boolean }
  ) => void;
}

/**
 * The node WebSocket TransportChannel. dial() runs the client handshake and returns a
 * fact-shaped DialResult ({ ok:false, reason } for "no peer URL" instead of throwing).
 * listen() runs the WebSocketServer and the server-side handshake, surfacing each accepted
 * peer (with its handshaked identity attached to the link) via onPeer. The raw handshake
 * frames are byte-identical to the pre-core node transport.
 */
class NodeWebSocketChannel implements TransportChannel {
  private server: WebSocketServer | null = null;
  private listeningUrl: string | null = null;

  constructor(private readonly deps: NodeChannelDeps) {}

  async dial(remoteAddress: string): Promise<DialResult> {
    const url = await this.deps.resolvePeerUrl(remoteAddress);
    if (!url) {
      return {
        ok: false,
        reason: `No WebSocket peer URL configured for node ${remoteAddress}`,
      };
    }

    const socket = new WebSocket(url);
    try {
      await this.waitForOpen(socket);
      await sendJson(
        socket,
        createRuntimeTransportHandshakeHello(this.deps.identity, {
          auth: await resolveRuntimeAuthPayload(this.deps.auth),
        })
      );
      const peerIdentity = await this.waitForHandshakeAccept(socket, remoteAddress);
      return { ok: true, link: new NodeWebSocketPeerLink(socket, remoteAddress, peerIdentity) };
    } catch (error) {
      try {
        socket.close();
      } catch {
        // best-effort cleanup
      }
      return {
        ok: false,
        reason: error instanceof Error ? error.message : 'Runtime peer connection failed.',
      };
    }
  }

  async listen(onPeer: (link: PeerLink) => void): Promise<TransportListenHandle> {
    if (!this.deps.listen) {
      // Client-only node transport: no server, but expose a closeable handle with no url.
      return {
        close: () => Promise.resolve(),
      };
    }

    const host = this.deps.listen.host ?? '127.0.0.1';
    const port = this.deps.listen.port ?? 0;

    const server = new WebSocketServer({ host, port });
    this.server = server;
    server.on('connection', (socket) => {
      this.acceptInboundConnection(socket, onPeer);
    });

    await new Promise<void>((resolve, reject) => {
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

    const url = this.listeningUrl;
    return {
      ...(url ? { url } : {}),
      close: () => this.closeServer(),
    };
  }

  async closeServer(): Promise<void> {
    const server = this.server;
    if (!server) {
      return;
    }
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

  private acceptInboundConnection(socket: WebSocket, onPeer: (link: PeerLink) => void): void {
    const timeout = setTimeout(() => {
      void this.rejectAndClose(socket, 'malformed_frame', 'Runtime handshake was not received.');
    }, this.deps.connectTimeoutMs);

    socket.once('message', (data) => {
      clearTimeout(timeout);
      void this.handleInboundHandshake(socket, data, onPeer);
    });
    socket.once('error', () => {
      clearTimeout(timeout);
    });
    socket.once('close', () => {
      clearTimeout(timeout);
    });
  }

  private async handleInboundHandshake(
    socket: WebSocket,
    data: WebSocket.RawData,
    onPeer: (link: PeerLink) => void
  ): Promise<void> {
    const frame = parseJson(data);
    const validation = validateRuntimeTransportHandshake(frame, this.deps.identity);
    if (!validation.ok) {
      await this.rejectAndClose(socket, validation.code, validation.message);
      return;
    }

    if (!isHandshakeHello(frame)) {
      await this.rejectAndClose(socket, 'malformed_frame', 'Expected runtime handshake hello.');
      return;
    }

    const auth = await verifyRuntimeAuth(this.deps.auth, {
      auth: frame.auth,
      source: frame.source,
      local: this.deps.identity,
    });
    if (!auth.ok) {
      // Mirror pre-core acceptInboundConnection: record the auth rejection in the node
      // snapshot view AND in the core's stats/telemetry (auth.rejected + handshake.rejected
      // + peer.rejected, handshakeRejectedCount++) so getRuntimePeerStatus() sees a rejected
      // peer with a reason. recordInboundRejected reports the rejection as a fact instead of
      // letting it escape this handshake promise (the PR#27-class unhandled-rejection hazard).
      this.deps.recordRejectedSnapshot(frame.source.nodeAddress, auth.reason, frame.source);
      this.deps.recordInboundRejected(frame.source.nodeAddress, auth.reason, { auth: true });
      await this.rejectAndClose(socket, 'unauthorized', auth.reason);
      return;
    }
    this.deps.emitTelemetry({
      type: 'auth.accepted',
      peerNodeAddress: frame.source.nodeAddress,
    });

    const acceptance = this.canAcceptPeer(frame.source);
    if (!acceptance.ok) {
      this.deps.recordRejectedSnapshot(frame.source.nodeAddress, acceptance.message, frame.source);
      this.deps.recordInboundRejected(frame.source.nodeAddress, acceptance.message, {
        auth: false,
      });
      await this.rejectAndClose(socket, 'malformed_frame', acceptance.message);
      return;
    }

    await sendJson(
      socket,
      createRuntimeTransportHandshakeAccept(this.deps.identity, frame.source, {
        auth: await resolveRuntimeAuthPayload(this.deps.auth),
      })
    );
    onPeer(new NodeWebSocketPeerLink(socket, frame.source.nodeAddress, frame.source));
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
      }, this.deps.connectTimeoutMs);

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
        const frame = parseJson(data);
        const validation = validateRuntimeTransportHandshake(frame, this.deps.identity);
        if (!validation.ok) {
          cleanup();
          socket.close();
          reject(new Error(`Runtime handshake rejected: ${validation.message}`));
          return;
        }

        if (isHandshakeReject(frame)) {
          cleanup();
          socket.close();
          reject(new Error(`Runtime handshake rejected: ${frame.message}`));
          return;
        }

        if (!isHandshakeAccept(frame)) {
          cleanup();
          socket.close();
          reject(new Error('Expected runtime handshake accept.'));
          return;
        }

        cleanup();
        void verifyRuntimeAuth(this.deps.auth, {
          auth: frame.auth,
          source: frame.source,
          local: this.deps.identity,
        }).then((auth) => {
          if (!auth.ok) {
            socket.close();
            this.deps.emitTelemetry({
              type: 'auth.rejected',
              peerNodeAddress: frame.source.nodeAddress,
              reason: auth.reason,
            });
            reject(new Error(`Runtime handshake rejected: ${auth.reason}`));
            return;
          }
          this.deps.emitTelemetry({
            type: 'auth.accepted',
            peerNodeAddress: frame.source.nodeAddress,
          });

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

  private canAcceptPeer(
    identity: RuntimeNodeIdentity
  ): { ok: true } | { ok: false; message: string } {
    const existing = this.deps.getPeerIdentity(identity.nodeAddress);
    if (!existing) {
      return { ok: true };
    }

    if (existing.nodeId !== identity.nodeId) {
      return {
        ok: false,
        message: `Runtime peer identity conflict for ${identity.nodeAddress}.`,
      };
    }

    return { ok: true };
  }

  private async rejectAndClose(
    socket: WebSocket,
    code: Parameters<typeof createRuntimeTransportHandshakeReject>[0],
    message: string
  ): Promise<void> {
    if (socket.readyState === WebSocket.OPEN) {
      await sendJson(
        socket,
        createRuntimeTransportHandshakeReject(code, message, { source: this.deps.identity })
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
      }, this.deps.connectTimeoutMs);

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
}

export class NodeWebSocketMessageTransport implements MessageTransport {
  private readonly core: TransportCore;
  private readonly channel: NodeWebSocketChannel;
  private readonly identity: RuntimeNodeIdentity;
  private readonly emitTelemetry: (
    event: Omit<RuntimeTransportTelemetryEvent, 'nodeAddress' | 'timestamp'>
  ) => void;
  private readonly peerSnapshots = new Map<string, NodeWebSocketPeerSnapshot>();
  private unsubscribeLifecycle: (() => void) | null = null;

  // Held so callers/tests that mutate options.peers (e.g. peer-URL rebinding across a
  // restart) reach the SAME object the channel resolves URLs from.
  private readonly options: NodeWebSocketMessageTransportOptions;

  constructor(options: NodeWebSocketMessageTransportOptions) {
    this.options = options;
    this.identity = createRuntimeNodeIdentity({
      nodeAddress: options.nodeAddress,
      nodeId: options.nodeId ?? options.nodeAddress,
      incarnation: options.incarnation ?? `${Date.now()}`,
      ...(options.capabilities ? { capabilities: options.capabilities } : {}),
    });
    this.emitTelemetry = createTelemetryEmitter(this.identity.nodeAddress, options.telemetry);

    this.channel = new NodeWebSocketChannel({
      identity: this.identity,
      connectTimeoutMs: options.connectTimeoutMs ?? 3000,
      ...(options.listen ? { listen: options.listen } : { listen: undefined }),
      ...(options.auth ? { auth: options.auth } : { auth: undefined }),
      // Reads the live this.options so a caller/test that rebinds options.peers between
      // connects is honored (the duplicate-restart white-box test does this).
      resolvePeerUrl: async (nodeAddress) =>
        this.options.peers?.[nodeAddress] ?? this.options.peerUrlResolver?.(nodeAddress),
      emitTelemetry: this.emitTelemetry,
      getPeerIdentity: (nodeAddress) =>
        this.core.isConnected(nodeAddress)
          ? this.core.getPeerStats(nodeAddress)?.identity
          : undefined,
      recordRejectedSnapshot: (nodeAddress, reason, identity) => {
        // Mirror the pre-core guard (node acceptInboundConnection): do not clobber the
        // snapshot of a peer that is currently connected — an inbound conflict from a
        // different node id must not flip the live peer to 'rejected'.
        if (this.core.isConnected(nodeAddress)) {
          return;
        }
        this.setPeerSnapshot(nodeAddress, {
          state: 'rejected',
          ...(identity ? { identity } : {}),
          rejectedReason: reason,
        });
      },
      // Route inbound handshake rejections into the core so its stats/telemetry record them
      // (the pre-core single-class transport did this inline). The core guards against
      // clobbering a currently-connected peer itself.
      recordInboundRejected: (nodeAddress, reason, options) => {
        this.core.recordInboundHandshakeRejection(nodeAddress, reason, options);
      },
    });

    this.core = new TransportCore({
      identity: this.identity,
      channel: this.channel,
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
    });

    // Keep the node-specific peer-snapshot view in sync with the core's connected/
    // disconnected lifecycle (the core emits these as in-band transport messages).
    this.unsubscribeLifecycle = this.core.subscribe(({ message }) => {
      if (message.type === '__runtime.transport.connected') {
        const nodeAddress = (message as { nodeAddress?: string }).nodeAddress;
        if (nodeAddress) {
          const identity = this.core.getPeerStats(nodeAddress)?.identity;
          this.setPeerSnapshot(nodeAddress, {
            state: 'connected',
            ...(identity ? { identity } : {}),
            lastSeenAt: new Date().toISOString(),
          });
        }
      } else if (message.type === '__runtime.transport.disconnected') {
        const nodeAddress = (message as { nodeAddress?: string }).nodeAddress;
        if (nodeAddress) {
          const existing = this.peerSnapshots.get(nodeAddress);
          this.setPeerSnapshot(nodeAddress, {
            state: 'disconnected',
            ...(existing?.identity ? { identity: existing.identity } : {}),
            ...(existing?.lastSeenAt ? { lastSeenAt: existing.lastSeenAt } : {}),
          });
        }
      }
    });
  }

  async start(): Promise<void> {
    // The core emits transport.started/stopped through the shared telemetry observer.
    await this.core.start();
  }

  async stop(): Promise<void> {
    await this.core.stop();
    this.unsubscribeLifecycle?.();
    this.unsubscribeLifecycle = null;
  }

  getListeningUrl(): string | null {
    return this.core.getListeningUrl();
  }

  getStats(): RuntimeTransportStats {
    return this.core.getStats();
  }

  getPeerStats(nodeAddress: string): RuntimeTransportPeerStats | undefined {
    return this.core.getPeerStats(nodeAddress);
  }

  async send(destination: string, message: ActorMessage): Promise<void> {
    await this.core.send(destination, message);
  }

  subscribe(listener: (event: { source: string; message: ActorMessage }) => void): () => void {
    return this.core.subscribe(listener);
  }

  async connect(address: string): Promise<void> {
    this.setPeerSnapshot(address, { state: 'connecting' });
    try {
      await this.core.connect(address);
    } catch (error) {
      // The core records handshake/auth-reject telemetry + stats; mirror the node snapshot
      // view (rejected) unless an inbound path already recorded a richer reason.
      if (this.peerSnapshots.get(address)?.state !== 'rejected') {
        this.setPeerSnapshot(address, {
          state: 'rejected',
          rejectedReason:
            error instanceof Error ? error.message : 'Runtime peer connection failed.',
        });
      }
      throw error;
    }
  }

  async disconnect(address: string): Promise<void> {
    await this.core.disconnect(address);
  }

  getConnectedNodes(): string[] {
    return this.core.getConnectedNodes();
  }

  isConnected(address: string): boolean {
    return this.core.isConnected(address);
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
      this.core.getPeerStats(nodeAddress)?.identity ??
      this.peerSnapshots.get(nodeAddress)?.identity;
    return identity ? { ...identity } : undefined;
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
}

export function createNodeWebSocketMessageTransport(
  options: NodeWebSocketMessageTransportOptions
): NodeWebSocketMessageTransport {
  return new NodeWebSocketMessageTransport(options);
}
