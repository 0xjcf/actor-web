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
  isRuntimeNodeIdentity,
  type RuntimeNodeIdentity,
  type RuntimeTransportHandshake,
  type RuntimeTransportHandshakeRejectCode,
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
  TransportListenHandle,
} from './transport/transport-channel.js';
import { TransportCore, type TransportTimers } from './transport/transport-core.js';

const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

export interface WebRtcDataChannelLike {
  readonly label?: string;
  readonly readyState: RTCDataChannelState;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: EventListener): void;
  removeEventListener(type: 'open' | 'message' | 'close' | 'error', listener: EventListener): void;
}

export interface WebRtcIncomingDataChannelEvent {
  readonly dataChannel: WebRtcDataChannelLike;
}

export interface WebRtcOpenDataChannelInput {
  readonly local: RuntimeNodeIdentity;
  readonly remoteAddress: string;
}

export interface WebRtcDataChannelBootstrap {
  openDataChannel(input: WebRtcOpenDataChannelInput): Promise<WebRtcDataChannelLike>;
  listen?(listener: (event: WebRtcIncomingDataChannelEvent) => void | Promise<void>): () => void;
}

export interface WebRtcMessageTransportOptions {
  nodeAddress: string;
  nodeId?: string;
  incarnation?: string;
  capabilities?: readonly string[];
  bootstrap: WebRtcDataChannelBootstrap;
  connectTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  idempotencyWindowSize?: number;
  ackTimeoutMs?: number;
  maxAckRetries?: number;
  outboundQueueLimit?: number;
  maxFrameBytes?: number;
  idempotencyProvider?: RuntimeTransportIdempotencyProvider;
  telemetry?: RuntimeTransportTelemetryObserver;
  auth?: RuntimeTransportAuthProvider<{
    readonly source: RuntimeNodeIdentity;
    readonly local: RuntimeNodeIdentity;
  }>;
  clock?: () => Date;
  timers?: TransportTimers;
  onListenerError?: (error: unknown) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isHandshakeHello(
  value: unknown
): value is Extract<RuntimeTransportHandshake, { type: 'runtime.handshake.hello' }> {
  return isRecord(value) && value.type === 'runtime.handshake.hello';
}

function isHandshakeAccept(
  value: unknown
): value is Extract<RuntimeTransportHandshake, { type: 'runtime.handshake.accept' }> {
  return isRecord(value) && value.type === 'runtime.handshake.accept';
}

function isHandshakeReject(
  value: unknown
): value is Extract<RuntimeTransportHandshake, { type: 'runtime.handshake.reject' }> {
  return isRecord(value) && value.type === 'runtime.handshake.reject';
}

function parseDataChannelPayload(data: unknown): unknown {
  if (typeof data !== 'string') {
    return data;
  }

  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function sendDataChannelJson(channel: WebRtcDataChannelLike, frame: unknown): Promise<void> {
  if (channel.readyState !== 'open') {
    return Promise.reject(new Error('WebRTC data channel is not open.'));
  }

  try {
    channel.send(typeof frame === 'string' ? frame : JSON.stringify(frame));
    return Promise.resolve();
  } catch (error) {
    return Promise.reject(error);
  }
}

function createDefaultTimers(): TransportTimers {
  return {
    setTimeout: (callback, ms) => setTimeout(callback, ms) as unknown as number,
    clearTimeout: (handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
    setInterval: (callback, ms) => setInterval(callback, ms) as unknown as number,
    clearInterval: (handle) => clearInterval(handle as unknown as ReturnType<typeof setInterval>),
  };
}

function createTelemetryEmitter(
  localNodeAddress: string,
  telemetry: RuntimeTransportTelemetryObserver | undefined,
  now: () => Date,
  onTelemetryError: (error: unknown) => void
): (event: Omit<RuntimeTransportTelemetryEvent, 'nodeAddress' | 'timestamp'>) => void {
  return (event) => {
    try {
      telemetry?.({
        nodeAddress: localNodeAddress,
        timestamp: now().toISOString(),
        ...event,
      } as RuntimeTransportTelemetryEvent);
    } catch (error) {
      onTelemetryError(error);
    }
  };
}

class WebRtcPeerLink implements PeerLink {
  private sink: PeerLinkSink | null = null;
  private closed = false;

  constructor(
    private readonly dataChannel: WebRtcDataChannelLike,
    readonly remoteAddress: string,
    readonly identity: RuntimeNodeIdentity
  ) {}

  get isOpen(): boolean {
    return !this.closed && this.dataChannel.readyState === 'open';
  }

  send(payload: unknown): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error(`WebRTC peer ${this.remoteAddress} is closed.`));
    }

    return sendDataChannelJson(this.dataChannel, payload);
  }

  receive(sink: PeerLinkSink): () => void {
    this.sink = sink;

    const onMessage: EventListener = (event) => {
      this.sink?.onPayload(parseDataChannelPayload((event as MessageEvent).data));
    };
    const onClose: EventListener = () => {
      this.sink?.onClosed('data channel closed');
    };
    const onError: EventListener = () => {
      this.sink?.onClosed('data channel error');
    };

    this.dataChannel.addEventListener('message', onMessage);
    this.dataChannel.addEventListener('close', onClose);
    this.dataChannel.addEventListener('error', onError);

    return () => {
      this.dataChannel.removeEventListener('message', onMessage);
      this.dataChannel.removeEventListener('close', onClose);
      this.dataChannel.removeEventListener('error', onError);
      this.sink = null;
    };
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.sink = null;
    try {
      this.dataChannel.close();
    } catch {
      // Closing an already-closed WebRTC data channel is teardown, not a raised adapter error.
    }
  }
}

interface WebRtcTransportChannelOptions {
  readonly identity: RuntimeNodeIdentity;
  readonly bootstrap: WebRtcDataChannelBootstrap;
  readonly connectTimeoutMs: number;
  readonly auth: WebRtcMessageTransportOptions['auth'];
  readonly now: () => Date;
  readonly timers: TransportTimers;
  readonly emitTelemetry: (
    event: Omit<RuntimeTransportTelemetryEvent, 'nodeAddress' | 'timestamp'>
  ) => void;
  readonly onListenerError: (error: unknown) => void;
}

class WebRtcTransportChannel implements TransportChannel {
  constructor(private readonly options: WebRtcTransportChannelOptions) {}

  async dial(remoteAddress: string): Promise<DialResult> {
    if (remoteAddress === this.options.identity.nodeAddress) {
      return {
        ok: false,
        reason: 'Runtime transport cannot connect a node to itself.',
      };
    }

    let dataChannel: WebRtcDataChannelLike;
    try {
      dataChannel = await this.options.bootstrap.openDataChannel({
        local: this.options.identity,
        remoteAddress,
      });
    } catch (error) {
      return {
        ok: false,
        reason:
          error instanceof Error ? error.message : `WebRTC bootstrap failed for ${remoteAddress}.`,
      };
    }

    const opened = await this.waitForOpen(dataChannel, `WebRTC data channel to ${remoteAddress}`);
    if (!opened.ok) {
      dataChannel.close();
      return opened;
    }

    const authPayload = await resolveRuntimeAuthPayload(this.options.auth);
    return this.exchangeHandshake(dataChannel, remoteAddress, authPayload);
  }

  async listen(onPeer: (link: PeerLink) => void): Promise<TransportListenHandle> {
    const unsubscribe =
      this.options.bootstrap.listen?.((event) => {
        void this.acceptIncomingDataChannel(event.dataChannel, onPeer).catch((error: unknown) => {
          this.options.onListenerError(error);
        });
      }) ?? (() => undefined);

    return {
      close: async () => {
        unsubscribe();
      },
    };
  }

  private waitForOpen(
    dataChannel: WebRtcDataChannelLike,
    label: string
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (dataChannel.readyState === 'open') {
      return Promise.resolve({ ok: true });
    }

    if (dataChannel.readyState === 'closed') {
      return Promise.resolve({ ok: false, reason: `${label} is closed.` });
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: { ok: true } | { ok: false; reason: string }): void => {
        if (settled) {
          return;
        }

        settled = true;
        this.options.timers.clearTimeout(timeout);
        dataChannel.removeEventListener('open', onOpen);
        dataChannel.removeEventListener('close', onClose);
        dataChannel.removeEventListener('error', onError);
        resolve(result);
      };

      const onOpen: EventListener = () => finish({ ok: true });
      const onClose: EventListener = () => finish({ ok: false, reason: `${label} closed.` });
      const onError: EventListener = () => finish({ ok: false, reason: `${label} errored.` });
      const timeout = this.options.timers.setTimeout(() => {
        finish({ ok: false, reason: `Timed out waiting for ${label} to open.` });
      }, this.options.connectTimeoutMs);

      dataChannel.addEventListener('open', onOpen);
      dataChannel.addEventListener('close', onClose);
      dataChannel.addEventListener('error', onError);
    });
  }

  private exchangeHandshake(
    dataChannel: WebRtcDataChannelLike,
    remoteAddress: string,
    authPayload: Awaited<ReturnType<typeof resolveRuntimeAuthPayload>>
  ): Promise<DialResult> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: DialResult): void => {
        if (settled) {
          return;
        }

        settled = true;
        this.options.timers.clearTimeout(timeout);
        dataChannel.removeEventListener('message', onMessage);
        resolve(result);
      };

      const timeout = this.options.timers.setTimeout(() => {
        finish({
          ok: false,
          reason: `Timed out waiting for WebRTC runtime handshake from ${remoteAddress}`,
        });
      }, this.options.connectTimeoutMs);

      const onMessage: EventListener = (event) => {
        const frame = parseDataChannelPayload((event as MessageEvent).data);
        if (!isHandshakeAccept(frame) && !isHandshakeReject(frame)) {
          return;
        }

        if (isHandshakeReject(frame)) {
          finish({ ok: false, reason: `Runtime handshake rejected: ${frame.message}` });
          return;
        }

        const validation = validateRuntimeTransportHandshake(frame, this.options.identity);
        if (!validation.ok) {
          finish({ ok: false, reason: `Runtime handshake rejected: ${validation.message}` });
          return;
        }

        if (frame.source.nodeAddress !== remoteAddress) {
          finish({
            ok: false,
            reason: `Runtime handshake accepted unexpected node ${frame.source.nodeAddress}.`,
          });
          return;
        }

        void verifyRuntimeAuth(this.options.auth, {
          auth: frame.auth,
          source: frame.source,
          local: this.options.identity,
        }).then(
          (auth) => {
            if (!auth.ok) {
              this.options.emitTelemetry({
                type: 'auth.rejected',
                peerNodeAddress: frame.source.nodeAddress,
                reason: auth.reason,
              });
              finish({ ok: false, reason: `Runtime handshake rejected: ${auth.reason}` });
              return;
            }

            this.options.emitTelemetry({
              type: 'auth.accepted',
              peerNodeAddress: frame.source.nodeAddress,
            });
            finish({
              ok: true,
              link: new WebRtcPeerLink(dataChannel, frame.source.nodeAddress, frame.source),
            });
          },
          (error: unknown) => {
            finish({
              ok: false,
              reason: error instanceof Error ? error.message : 'Runtime handshake auth failed.',
            });
          }
        );
      };

      dataChannel.addEventListener('message', onMessage);
      sendDataChannelJson(
        dataChannel,
        createRuntimeTransportHandshakeHello(this.options.identity, {
          auth: authPayload,
          now: this.options.now,
        })
      ).catch((error: unknown) => {
        finish({
          ok: false,
          reason:
            error instanceof Error
              ? `Runtime handshake hello send failed: ${error.message}`
              : 'Runtime handshake hello send failed.',
        });
      });
    });
  }

  private async acceptIncomingDataChannel(
    dataChannel: WebRtcDataChannelLike,
    onPeer: (link: PeerLink) => void
  ): Promise<void> {
    const opened = await this.waitForOpen(dataChannel, 'inbound WebRTC data channel');
    if (!opened.ok) {
      dataChannel.close();
      return;
    }

    const frame = await this.waitForHandshakeHello(dataChannel);
    if (!frame) {
      dataChannel.close();
      return;
    }

    const reject = async (
      code: RuntimeTransportHandshakeRejectCode,
      message: string,
      source?: RuntimeNodeIdentity
    ): Promise<void> => {
      await sendDataChannelJson(
        dataChannel,
        createRuntimeTransportHandshakeReject(code, message, {
          source: this.options.identity,
          ...(source ? { destination: source } : {}),
          now: this.options.now,
        })
      );
    };

    const validation = validateRuntimeTransportHandshake(frame, this.options.identity);
    if (!validation.ok) {
      await reject(
        validation.code,
        validation.message,
        isRuntimeNodeIdentity(frame.source) ? frame.source : undefined
      );
      return;
    }

    const auth = await verifyRuntimeAuth(this.options.auth, {
      auth: frame.auth,
      source: frame.source,
      local: this.options.identity,
    });
    if (!auth.ok) {
      await reject('unauthorized', auth.reason, frame.source);
      this.options.emitTelemetry({
        type: 'auth.rejected',
        peerNodeAddress: frame.source.nodeAddress,
        reason: auth.reason,
      });
      return;
    }

    this.options.emitTelemetry({
      type: 'auth.accepted',
      peerNodeAddress: frame.source.nodeAddress,
    });
    onPeer(new WebRtcPeerLink(dataChannel, frame.source.nodeAddress, frame.source));
    await sendDataChannelJson(
      dataChannel,
      createRuntimeTransportHandshakeAccept(this.options.identity, frame.source, {
        auth: await resolveRuntimeAuthPayload(this.options.auth),
        now: this.options.now,
      })
    );
  }

  private waitForHandshakeHello(
    dataChannel: WebRtcDataChannelLike
  ): Promise<Extract<RuntimeTransportHandshake, { type: 'runtime.handshake.hello' }> | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (
        frame: Extract<RuntimeTransportHandshake, { type: 'runtime.handshake.hello' }> | null
      ): void => {
        if (settled) {
          return;
        }

        settled = true;
        this.options.timers.clearTimeout(timeout);
        dataChannel.removeEventListener('message', onMessage);
        resolve(frame);
      };

      const timeout = this.options.timers.setTimeout(() => {
        finish(null);
      }, this.options.connectTimeoutMs);

      const onMessage: EventListener = (event) => {
        const frame = parseDataChannelPayload((event as MessageEvent).data);
        if (isHandshakeHello(frame)) {
          finish(frame);
        }
      };

      dataChannel.addEventListener('message', onMessage);
    });
  }
}

export class WebRtcMessageTransport implements MessageTransport {
  private readonly core: TransportCore;
  private readonly identity: RuntimeNodeIdentity;

  constructor(options: WebRtcMessageTransportOptions) {
    this.identity = createRuntimeNodeIdentity({
      nodeAddress: options.nodeAddress,
      nodeId: options.nodeId ?? options.nodeAddress,
      incarnation: options.incarnation ?? `${Date.now()}`,
      ...(options.capabilities ? { capabilities: options.capabilities } : {}),
    });

    const now = options.clock ?? (() => new Date());
    const timers = options.timers ?? createDefaultTimers();
    const onListenerError = options.onListenerError ?? (() => undefined);
    const emitTelemetry = createTelemetryEmitter(
      this.identity.nodeAddress,
      options.telemetry,
      now,
      onListenerError
    );

    this.core = new TransportCore({
      identity: this.identity,
      channel: new WebRtcTransportChannel({
        identity: this.identity,
        bootstrap: options.bootstrap,
        connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
        ...(options.auth ? { auth: options.auth } : { auth: undefined }),
        now,
        timers,
        emitTelemetry,
        onListenerError,
      }),
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
      ...(options.maxFrameBytes !== undefined ? { maxFrameBytes: options.maxFrameBytes } : {}),
      ...(options.idempotencyProvider ? { idempotencyProvider: options.idempotencyProvider } : {}),
      ...(options.telemetry ? { telemetry: options.telemetry } : {}),
      ...(options.auth ? { auth: options.auth } : {}),
      ...(options.clock ? { clock: options.clock } : {}),
      ...(options.timers ? { timers: options.timers } : {}),
      ...(options.onListenerError ? { onListenerError: options.onListenerError } : {}),
    });
  }

  async start(): Promise<void> {
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

export function createWebRtcMessageTransport(
  options: WebRtcMessageTransportOptions
): WebRtcMessageTransport {
  return new WebRtcMessageTransport(options);
}
