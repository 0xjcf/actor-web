// Adapter: the browser WebSocket TransportChannel. All reliability machinery (ack/retry,
// outbound queue, heartbeat engine, stats/telemetry, sequence, dispatch, idempotency) now
// lives in TransportCore (transport/transport-core.ts); this file is a thin channel that
// dials peers + runs the client handshake and wraps each WebSocket in a PeerLink. The
// browser transport is CLIENT-ONLY (it cannot listen), so the channel implements dial()
// only — no server, no listen()/closeServer(). The PeerLink omits the native heartbeat hook
// so the core falls back to JSON heartbeat ping/pong frames, keeping the wire byte-identical
// to the pre-core browser transport. The public createBrowserWebSocketMessageTransport
// factory and the BrowserWebSocketMessageTransport surface (start/stop, getStats/
// getPeerStats, send/subscribe/connect/disconnect/isConnected/getConnectedNodes) are
// preserved verbatim.

import type { ActorMessage, MessageTransport } from './actor-system.js';
import {
  type RuntimeTransportAuthProvider,
  resolveRuntimeAuthPayload,
  verifyRuntimeAuth,
} from './runtime-auth.js';
import {
  createRuntimeNodeIdentity,
  createRuntimeTransportHandshakeHello,
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
  PeerLinkSink,
  TransportChannel,
} from './transport/transport-channel.js';
import { TransportCore } from './transport/transport-core.js';

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
  idempotencyProvider?: RuntimeTransportIdempotencyProvider;
  telemetry?: RuntimeTransportTelemetryObserver;
  webSocketFactory?: (url: string) => WebSocket;
  auth?: RuntimeTransportAuthProvider<{
    readonly source: RuntimeNodeIdentity;
    readonly local: RuntimeNodeIdentity;
  }>;
}

const WEB_SOCKET_OPEN = 1;

/**
 * One live browser WebSocket as a PeerLink. The core owns all reliability; this link only
 * moves opaque JSON payloads (byte-identical to the pre-core sendJson/parseJson) and reports
 * raw liveness via WebSocket.readyState. It has NO native heartbeat hook, so the core falls
 * back to JSON heartbeat ping/pong frames — exactly the wire the pre-core browser transport
 * spoke (no native ws ping/pong is available in the browser DOM WebSocket API).
 */
class BrowserWebSocketPeerLink implements PeerLink {
  private sink: PeerLinkSink | null = null;
  private closed = false;

  constructor(
    readonly socket: WebSocket,
    readonly remoteAddress: string,
    readonly identity: RuntimeNodeIdentity
  ) {}

  get isOpen(): boolean {
    return !this.closed && this.socket.readyState === WEB_SOCKET_OPEN;
  }

  send(payload: unknown): Promise<void> {
    // The DOM WebSocket.send is fire-and-forget (no completion callback); transmit
    // synchronously then resolve. The core hands a pre-serialized JSON string, transmitted
    // verbatim for byte parity with the pre-core sendJson.
    this.socket.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
    return Promise.resolve();
  }

  receive(sink: PeerLinkSink): () => void {
    this.sink = sink;
    const onMessage = (event: MessageEvent): void => {
      // parseJson is async (Blob branch); feed the parsed payload to the core when ready.
      void parseJson(event.data).then((parsed) => {
        this.sink?.onPayload(parsed);
      });
    };
    const onClose = (): void => {
      this.sink?.onClosed('socket closed');
    };
    const onError = (): void => {
      this.sink?.onClosed('socket error');
    };
    this.socket.addEventListener('message', onMessage);
    this.socket.addEventListener('close', onClose);
    this.socket.addEventListener('error', onError);
    return () => {
      this.socket.removeEventListener('message', onMessage);
      this.socket.removeEventListener('close', onClose);
      this.socket.removeEventListener('error', onError);
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

async function parseJson(data: unknown): Promise<unknown> {
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

function sendJson(socket: WebSocket, frame: unknown): void {
  socket.send(JSON.stringify(frame));
}

interface BrowserChannelDeps {
  readonly identity: RuntimeNodeIdentity;
  readonly connectTimeoutMs: number;
  readonly auth: BrowserWebSocketMessageTransportOptions['auth'];
  readonly webSocketFactory: (url: string) => WebSocket;
  /** Resolve a peer URL on demand — reads the live options so a test/caller can rebind it. */
  readonly resolvePeerUrl: (nodeAddress: string) => Promise<string | undefined>;
  readonly emitTelemetry: (
    event: Omit<RuntimeTransportTelemetryEvent, 'nodeAddress' | 'timestamp'>
  ) => void;
}

/**
 * The browser WebSocket TransportChannel. dial() runs the client handshake (open + hello +
 * waitForHandshakeAccept + auth-verify) and returns a fact-shaped DialResult ({ ok:false,
 * reason } for "no peer URL", connection failure, or handshake reject) instead of throwing
 * control-flow. There is NO listen()/closeServer(): the browser transport is client-only,
 * so the core skips the inbound-peer path entirely. The raw handshake frames are
 * byte-identical to the pre-core browser transport.
 */
class BrowserWebSocketChannel implements TransportChannel {
  constructor(private readonly deps: BrowserChannelDeps) {}

  async dial(remoteAddress: string): Promise<DialResult> {
    const url = await this.deps.resolvePeerUrl(remoteAddress);
    if (!url) {
      return {
        ok: false,
        reason: `No WebSocket peer URL configured for node ${remoteAddress}`,
      };
    }

    const socket = this.deps.webSocketFactory(url);
    try {
      await this.waitForOpen(socket);
      sendJson(
        socket,
        createRuntimeTransportHandshakeHello(this.deps.identity, {
          auth: await resolveRuntimeAuthPayload(this.deps.auth),
        })
      );
      const peerIdentity = await this.waitForHandshakeAccept(socket, remoteAddress);
      return { ok: true, link: new BrowserWebSocketPeerLink(socket, remoteAddress, peerIdentity) };
    } catch (error) {
      socket.close();
      return {
        ok: false,
        reason: error instanceof Error ? error.message : 'Runtime peer connection failed.',
      };
    }
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
      }, this.deps.connectTimeoutMs);

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
        void parseJson(event.data).then((frame) => {
          if (settled) {
            return;
          }

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

            resolve(frame.source);
          }, reject);
        }, reject);
      };

      socket.addEventListener('message', onMessage);
      socket.addEventListener('close', onClose);
      socket.addEventListener('error', onError);
    });
  }

  private waitForOpen(socket: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        socket.close();
        reject(new Error('Timed out opening WebSocket transport connection.'));
      }, this.deps.connectTimeoutMs);

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
}

/**
 * Emits transport telemetry envelopes (nodeAddress + timestamp) through the caller-supplied
 * observer. Shared by the channel (auth telemetry on the client handshake path) and the core
 * (everything else) so a single observer sees one consistent event stream — exactly as the
 * pre-core single-class browser transport did.
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

export class BrowserWebSocketMessageTransport implements MessageTransport {
  private readonly core: TransportCore;
  private readonly channel: BrowserWebSocketChannel;
  private readonly identity: RuntimeNodeIdentity;

  // Held so callers/tests that mutate options.peers (e.g. peer-URL rebinding) reach the
  // SAME object the channel resolves URLs from.
  private readonly options: BrowserWebSocketMessageTransportOptions;

  constructor(options: BrowserWebSocketMessageTransportOptions) {
    this.options = options;
    this.identity = createRuntimeNodeIdentity({
      nodeAddress: options.nodeAddress,
      nodeId: options.nodeId ?? options.nodeAddress,
      incarnation: options.incarnation ?? `${Date.now()}`,
      ...(options.capabilities ? { capabilities: options.capabilities } : {}),
    });
    const emitTelemetry = createTelemetryEmitter(this.identity.nodeAddress, options.telemetry);

    this.channel = new BrowserWebSocketChannel({
      identity: this.identity,
      connectTimeoutMs: options.connectTimeoutMs ?? 3000,
      ...(options.auth ? { auth: options.auth } : { auth: undefined }),
      webSocketFactory:
        options.webSocketFactory ??
        ((url) => {
          if (typeof WebSocket === 'undefined') {
            throw new Error('Browser WebSocket transport requires a global WebSocket constructor.');
          }

          return new WebSocket(url);
        }),
      // Reads the live this.options so a caller/test that rebinds options.peers between
      // connects is honored.
      resolvePeerUrl: async (nodeAddress) =>
        this.options.peers?.[nodeAddress] ?? this.options.peerUrlResolver?.(nodeAddress),
      emitTelemetry,
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
  }

  async start(): Promise<void> {
    // The core emits transport.started/stopped through the shared telemetry observer.
    await this.core.start();
  }

  async stop(): Promise<void> {
    await this.core.stop();
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
    await this.core.connect(address);
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
}

export function createBrowserWebSocketMessageTransport(
  options: BrowserWebSocketMessageTransportOptions
): BrowserWebSocketMessageTransport {
  return new BrowserWebSocketMessageTransport(options);
}
