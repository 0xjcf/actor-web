// Imperative shell (composition root, behaviorBoundaries.shell). The public authoring
// surface: wires an author medium -> fromDuplex/PeerLink -> TransportCore into a
// MessageTransport factory. No reliability logic of its own — every concern lives in
// TransportCore.
//
// PR-1 scope guard (engineering brief §1.4 / §6): this module + its unit tests land here,
// but it is NOT yet re-exported from index.ts/browser.ts/node.ts. The public re-export
// ships in a later PR alongside the websocket-alias re-authoring, keeping PR 1 strictly
// additive/internal. TransportCore/TransportChannel/PeerLink are never publicly exported.

import type { MessageTransport } from '../actor-system.js';
import type { RuntimeTransportAuthProvider } from '../runtime-auth.js';
import {
  createRuntimeNodeIdentity,
  type RuntimeNodeIdentity,
} from '../runtime-transport-contract.js';
import type { RuntimeTransportIdempotencyProvider } from '../runtime-transport-idempotency.js';
import type {
  RuntimeTransportPeerStats,
  RuntimeTransportStats,
  RuntimeTransportTelemetryObserver,
} from '../runtime-transport-telemetry.js';
import type {
  DialResult,
  PeerLink,
  PeerLinkSink,
  TransportChannel,
  TransportListenHandle,
} from './transport-channel.js';
import { TransportCore, type TransportTimers } from './transport-core.js';

/**
 * What a defineTransport factory returns: the MessageTransport surface plus the
 * lifecycle/observability methods the runtime host drives. TransportCore (internal) is the
 * concrete implementation; it is never exported as a named type.
 */
export interface TransportInstance extends MessageTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStats(): RuntimeTransportStats;
  getPeerStats(nodeAddress: string): RuntimeTransportPeerStats | undefined;
}

/** A duplex any author can hand to fromDuplex: postMessage out, onmessage in, close. */
export interface TransportDuplex {
  postMessage(data: unknown): void;
  onmessage?: ((event: { data: unknown }) => void) | null;
  addEventListener?(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener?(type: 'message', listener: (event: { data: unknown }) => void): void;
  close?(): void;
}

/** The required identity + optional reliability knobs an author's factory accepts. */
export interface TransportFactoryOptions {
  /**
   * REQUIRED node identity for cross-node transports (directory-collision guard, per the
   * locked decision). `node` is the human node name; `nodeAddress` defaults to it.
   */
  readonly node: string;
  readonly nodeAddress?: string;
  readonly nodeId?: string;
  readonly incarnation?: string;
  readonly capabilities?: readonly string[];
  readonly connectTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
  readonly idempotencyWindowSize?: number;
  readonly ackTimeoutMs?: number;
  readonly maxAckRetries?: number;
  readonly outboundQueueLimit?: number;
  readonly idempotencyProvider?: RuntimeTransportIdempotencyProvider;
  readonly telemetry?: RuntimeTransportTelemetryObserver;
  readonly auth?: RuntimeTransportAuthProvider<{
    readonly source: RuntimeNodeIdentity;
    readonly local: RuntimeNodeIdentity;
  }>;
  readonly clock?: () => Date;
  readonly timers?: TransportTimers;
  readonly onListenerError?: (error: unknown) => void;
}

/**
 * Normalize any postMessage/onmessage/close duplex into a PeerLink the core can drive.
 * This is what lets `defineTransport(({ channel }) => new BroadcastChannel(channel))` be
 * one line. The core serializes frames to a string before send (byte-identical wire); the
 * duplex transmits the payload verbatim and surfaces inbound payloads as facts.
 */
export function fromDuplex(duplex: TransportDuplex, remoteAddress: string): PeerLink {
  let open = true;
  let sink: PeerLinkSink | null = null;
  let removeNativeListener: (() => void) | null = null;

  const deliver = (event: { data: unknown }): void => {
    sink?.onPayload(event.data);
  };

  return {
    remoteAddress,
    get isOpen(): boolean {
      return open;
    },
    send(payload: unknown): Promise<void> {
      duplex.postMessage(payload);
      return Promise.resolve();
    },
    receive(nextSink: PeerLinkSink): () => void {
      sink = nextSink;
      if (duplex.addEventListener) {
        duplex.addEventListener('message', deliver);
        removeNativeListener = () => duplex.removeEventListener?.('message', deliver);
      } else {
        duplex.onmessage = deliver;
        removeNativeListener = () => {
          if (duplex.onmessage === deliver) {
            duplex.onmessage = null;
          }
        };
      }
      return () => {
        removeNativeListener?.();
        removeNativeListener = null;
        sink = null;
      };
    },
    close(): void {
      // Idempotent; never throws (errors-as-values).
      if (!open) {
        return;
      }
      open = false;
      removeNativeListener?.();
      removeNativeListener = null;
      sink = null;
      try {
        duplex.close?.();
      } catch {
        // A medium that throws on close is treated as already-closed — we report the fact
        // (open = false) rather than propagating an expected teardown error.
      }
    },
  };
}

function buildIdentity(options: TransportFactoryOptions): RuntimeNodeIdentity {
  if (!options.node) {
    throw new Error(
      'defineTransport requires a `node` identity for cross-node transports (directory-collision guard).'
    );
  }
  const nodeAddress = options.nodeAddress ?? options.node;
  return createRuntimeNodeIdentity({
    nodeAddress,
    nodeId: options.nodeId ?? options.node,
    incarnation: options.incarnation ?? `${Date.now()}`,
    ...(options.capabilities ? { capabilities: options.capabilities } : {}),
  });
}

function buildCore(
  identity: RuntimeNodeIdentity,
  channel: TransportChannel,
  options: TransportFactoryOptions
): TransportCore {
  return new TransportCore({
    identity,
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
    ...(options.idempotencyProvider ? { idempotencyProvider: options.idempotencyProvider } : {}),
    ...(options.telemetry ? { telemetry: options.telemetry } : {}),
    ...(options.auth ? { auth: options.auth } : {}),
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.timers ? { timers: options.timers } : {}),
    ...(options.onListenerError ? { onListenerError: options.onListenerError } : {}),
  });
}

/**
 * Public authoring API. The author returns the raw medium (a duplex or a PeerLink);
 * defineTransport wires it through fromDuplex + TransportCore into a MessageTransport
 * factory. The single channel dials the one peer the author's medium describes.
 */
export function defineTransport<TArgs>(
  author: (args: TArgs) => TransportDuplex | PeerLink
): (args: TArgs & TransportFactoryOptions) => TransportInstance {
  return (args: TArgs & TransportFactoryOptions): TransportInstance => {
    const identity = buildIdentity(args);
    const channel: TransportChannel = {
      dial(remoteAddress: string): Promise<DialResult> {
        const medium = author(args);
        const link = isPeerLink(medium) ? medium : fromDuplex(medium, remoteAddress);
        return Promise.resolve({ ok: true, link });
      },
    };
    return buildCore(identity, channel, args);
  };
}

export namespace defineTransport {
  /** Multi-peer servers opt into the richer form (mirrors node listen()). */
  export function server<TArgs>(
    author: (args: TArgs) => {
      listen: (onPeer: (link: PeerLink) => void) => void | Promise<void>;
    }
  ): (args: TArgs & TransportFactoryOptions) => TransportInstance {
    return (args: TArgs & TransportFactoryOptions): TransportInstance => {
      const identity = buildIdentity(args);
      const channel: TransportChannel = {
        dial(remoteAddress: string): Promise<DialResult> {
          return Promise.resolve({
            ok: false,
            reason: `Server transport ${identity.nodeAddress} does not dial ${remoteAddress}; peers connect inbound.`,
          });
        },
        async listen(onPeer: (link: PeerLink) => void): Promise<TransportListenHandle> {
          await author(args).listen(onPeer);
          return {
            close(): Promise<void> {
              return Promise.resolve();
            },
          };
        },
      };
      return buildCore(identity, channel, args);
    };
  }
}

function isPeerLink(value: TransportDuplex | PeerLink): value is PeerLink {
  return (
    typeof (value as PeerLink).send === 'function' &&
    typeof (value as PeerLink).receive === 'function' &&
    typeof (value as PeerLink).remoteAddress === 'string'
  );
}
