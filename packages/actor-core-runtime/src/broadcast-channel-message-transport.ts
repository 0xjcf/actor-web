import type { ActorMessage, MessageTransport } from './actor-system.js';
import { raiseAdapterFailure } from './adapter-failure.js';
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
  isSameRuntimeNodeIdentity,
  type RuntimeNodeIdentity,
  type RuntimeTransportHandshake,
  validateRuntimeNodeIdentity,
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
import { safeDispatchListener } from './transport/transport-channel.js';
import { TransportCore, type TransportTimers } from './transport/transport-core.js';

const BROADCAST_CHANNEL_TRANSPORT_PROTOCOL = 'actor-web.broadcast-channel/1' as const;
const DEFAULT_BROADCAST_CHANNEL_NAME = 'actor-web-runtime';
const DEFAULT_CONNECT_TIMEOUT_MS = 3000;

export interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  addEventListener: EventTarget['addEventListener'];
  removeEventListener: EventTarget['removeEventListener'];
}

export interface BroadcastChannelMessageTransportOptions {
  nodeAddress: string;
  nodeId?: string;
  incarnation?: string;
  capabilities?: readonly string[];
  channelName?: string;
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
  broadcastChannelFactory?: (channelName: string) => BroadcastChannelLike;
  onListenerError?: (error: unknown) => void;
}

interface BroadcastChannelTransportEnvelope {
  readonly protocol: typeof BROADCAST_CHANNEL_TRANSPORT_PROTOCOL;
  readonly source: RuntimeNodeIdentity;
  readonly destination: string;
  readonly payload: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isBroadcastChannelTransportEnvelope(
  value: unknown
): value is BroadcastChannelTransportEnvelope {
  if (!isRecord(value)) {
    return false;
  }

  if (value.protocol !== BROADCAST_CHANNEL_TRANSPORT_PROTOCOL) {
    return false;
  }

  if (typeof value.destination !== 'string' || value.destination.trim().length === 0) {
    return false;
  }

  return validateRuntimeNodeIdentity(value.source).ok;
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

function parseBroadcastPayload(payload: unknown): unknown {
  if (typeof payload !== 'string') {
    return payload;
  }

  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function createDefaultBroadcastChannel(channelName: string): BroadcastChannelLike {
  if (typeof BroadcastChannel === 'undefined') {
    raiseAdapterFailure(
      'BroadcastChannel transport requires a global BroadcastChannel constructor.'
    );
  }

  return new BroadcastChannel(channelName);
}

function createTelemetryEmitter(
  localNodeAddress: string,
  telemetry: RuntimeTransportTelemetryObserver | undefined,
  now: () => Date
): (event: Omit<RuntimeTransportTelemetryEvent, 'nodeAddress' | 'timestamp'>) => void {
  return (event) => {
    telemetry?.({
      nodeAddress: localNodeAddress,
      timestamp: now().toISOString(),
      ...event,
    } as RuntimeTransportTelemetryEvent);
  };
}

class BroadcastChannelBus {
  private readonly listeners = new Set<(envelope: BroadcastChannelTransportEnvelope) => unknown>();
  private closed = false;

  constructor(
    private readonly channel: BroadcastChannelLike,
    private readonly identity: RuntimeNodeIdentity,
    private readonly onListenerError: (error: unknown) => void
  ) {
    this.channel.addEventListener('message', this.handleMessage);
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  subscribe(listener: (envelope: BroadcastChannelTransportEnvelope) => unknown): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  post(destination: string, payload: unknown): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('BroadcastChannel transport is closed.'));
    }

    const envelope: BroadcastChannelTransportEnvelope = {
      protocol: BROADCAST_CHANNEL_TRANSPORT_PROTOCOL,
      source: this.identity,
      destination,
      payload,
    };

    try {
      this.channel.postMessage(envelope);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.listeners.clear();
    this.channel.removeEventListener('message', this.handleMessage);
    try {
      this.channel.close();
    } catch {
      // Close is teardown; an already-closed medium is a fact, not a thrown adapter failure.
    }
  }

  private readonly handleMessage = (event: Event): void => {
    const data = (event as MessageEvent).data;
    if (!isBroadcastChannelTransportEnvelope(data)) {
      return;
    }

    if (data.destination !== this.identity.nodeAddress) {
      return;
    }

    if (isSameRuntimeNodeIdentity(data.source, this.identity)) {
      return;
    }

    for (const listener of Array.from(this.listeners)) {
      safeDispatchListener(listener, data, this.onListenerError);
    }
  };
}

class BroadcastChannelPeerLink implements PeerLink {
  private sink: PeerLinkSink | null = null;
  private unsubscribe: (() => void) | null = null;
  private closed = false;

  constructor(
    private readonly bus: BroadcastChannelBus,
    readonly remoteAddress: string,
    readonly identity: RuntimeNodeIdentity
  ) {}

  get isOpen(): boolean {
    return !this.closed && this.bus.isOpen;
  }

  send(payload: unknown): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error(`BroadcastChannel peer ${this.remoteAddress} is closed.`));
    }

    return this.bus.post(this.remoteAddress, payload);
  }

  receive(sink: PeerLinkSink): () => void {
    this.sink = sink;
    this.unsubscribe = this.bus.subscribe((envelope) => {
      if (this.closed || envelope.source.nodeAddress !== this.remoteAddress) {
        return;
      }

      this.sink?.onPayload(parseBroadcastPayload(envelope.payload));
    });

    return () => {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.sink = null;
    };
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.sink = null;
  }
}

interface BroadcastChannelTransportChannelOptions {
  readonly identity: RuntimeNodeIdentity;
  readonly bus: BroadcastChannelBus;
  readonly connectTimeoutMs: number;
  readonly auth: BroadcastChannelMessageTransportOptions['auth'];
  readonly now: () => Date;
  readonly timers: TransportTimers;
  readonly emitTelemetry: (
    event: Omit<RuntimeTransportTelemetryEvent, 'nodeAddress' | 'timestamp'>
  ) => void;
}

class BroadcastChannelTransportChannel implements TransportChannel {
  constructor(private readonly options: BroadcastChannelTransportChannelOptions) {}

  async dial(remoteAddress: string): Promise<DialResult> {
    if (remoteAddress === this.options.identity.nodeAddress) {
      return {
        ok: false,
        reason: 'Runtime transport cannot connect a node to itself.',
      };
    }

    const authPayload = await resolveRuntimeAuthPayload(this.options.auth);
    return this.exchangeHandshake(remoteAddress, authPayload);
  }

  async listen(onPeer: (link: PeerLink) => void): Promise<TransportListenHandle> {
    const unsubscribe = this.options.bus.subscribe((envelope) => {
      if (!isHandshakeHello(envelope.payload)) {
        return;
      }

      void this.acceptHandshakeHello(envelope, onPeer);
    });

    return {
      close: async () => {
        unsubscribe();
      },
    };
  }

  async closeServer(): Promise<void> {
    this.options.bus.close();
  }

  private exchangeHandshake(
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
        unsubscribe();
        resolve(result);
      };

      const timeout = this.options.timers.setTimeout(() => {
        finish({
          ok: false,
          reason: `Timed out waiting for BroadcastChannel runtime handshake from ${remoteAddress}`,
        });
      }, this.options.connectTimeoutMs);

      const unsubscribe = this.options.bus.subscribe((envelope) => {
        if (envelope.source.nodeAddress !== remoteAddress) {
          return;
        }

        const frame = envelope.payload;
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
              link: new BroadcastChannelPeerLink(
                this.options.bus,
                frame.source.nodeAddress,
                frame.source
              ),
            });
          },
          (error: unknown) => {
            finish({
              ok: false,
              reason: error instanceof Error ? error.message : 'Runtime handshake auth failed.',
            });
          }
        );
      });

      void this.options.bus
        .post(
          remoteAddress,
          createRuntimeTransportHandshakeHello(this.options.identity, {
            auth: authPayload,
            now: this.options.now,
          })
        )
        .catch((error: unknown) => {
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

  private async acceptHandshakeHello(
    envelope: BroadcastChannelTransportEnvelope,
    onPeer: (link: PeerLink) => void
  ): Promise<void> {
    const frame = envelope.payload;
    if (!isHandshakeHello(frame)) {
      return;
    }

    const reject = async (message: string): Promise<void> => {
      await this.options.bus.post(
        envelope.source.nodeAddress,
        createRuntimeTransportHandshakeReject('malformed_frame', message, {
          source: this.options.identity,
          destination: envelope.source,
          now: this.options.now,
        })
      );
    };

    const validation = validateRuntimeTransportHandshake(frame, this.options.identity);
    if (!validation.ok) {
      await reject(validation.message);
      return;
    }

    if (!isSameRuntimeNodeIdentity(frame.source, envelope.source)) {
      await reject('BroadcastChannel handshake envelope source does not match payload source.');
      return;
    }

    const auth = await verifyRuntimeAuth(this.options.auth, {
      auth: frame.auth,
      source: frame.source,
      local: this.options.identity,
    });
    if (!auth.ok) {
      await this.options.bus.post(
        frame.source.nodeAddress,
        createRuntimeTransportHandshakeReject('unauthorized', auth.reason, {
          source: this.options.identity,
          destination: frame.source,
          now: this.options.now,
        })
      );
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
    onPeer(new BroadcastChannelPeerLink(this.options.bus, frame.source.nodeAddress, frame.source));
    await this.options.bus.post(
      frame.source.nodeAddress,
      createRuntimeTransportHandshakeAccept(this.options.identity, frame.source, {
        auth: await resolveRuntimeAuthPayload(this.options.auth),
        now: this.options.now,
      })
    );
  }
}

export class BroadcastChannelMessageTransport implements MessageTransport {
  private readonly core: TransportCore;
  private readonly bus: BroadcastChannelBus;
  private readonly identity: RuntimeNodeIdentity;

  constructor(options: BroadcastChannelMessageTransportOptions) {
    this.identity = createRuntimeNodeIdentity({
      nodeAddress: options.nodeAddress,
      nodeId: options.nodeId ?? options.nodeAddress,
      incarnation: options.incarnation ?? `${Date.now()}`,
      ...(options.capabilities ? { capabilities: options.capabilities } : {}),
    });

    const now = options.clock ?? (() => new Date());
    const channelName = options.channelName ?? DEFAULT_BROADCAST_CHANNEL_NAME;
    const nativeChannel = (options.broadcastChannelFactory ?? createDefaultBroadcastChannel)(
      channelName
    );
    const emitTelemetry = createTelemetryEmitter(this.identity.nodeAddress, options.telemetry, now);
    const onListenerError = options.onListenerError ?? (() => undefined);

    this.bus = new BroadcastChannelBus(nativeChannel, this.identity, onListenerError);
    const channel = new BroadcastChannelTransportChannel({
      identity: this.identity,
      bus: this.bus,
      connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      ...(options.auth ? { auth: options.auth } : { auth: undefined }),
      now,
      timers: options.timers ?? {
        setTimeout: (callback, ms) => setTimeout(callback, ms) as unknown as number,
        clearTimeout: (handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
        setInterval: (callback, ms) => setInterval(callback, ms) as unknown as number,
        clearInterval: (handle) =>
          clearInterval(handle as unknown as ReturnType<typeof setInterval>),
      },
      emitTelemetry,
    });

    this.core = new TransportCore({
      identity: this.identity,
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

export function createBroadcastChannelMessageTransport(
  options: BroadcastChannelMessageTransportOptions
): BroadcastChannelMessageTransport {
  return new BroadcastChannelMessageTransport(options);
}
