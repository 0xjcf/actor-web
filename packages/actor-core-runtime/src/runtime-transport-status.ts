import type { MessageTransport } from './actor-system.js';
import type {
  RuntimeTransportPeerStats,
  RuntimeTransportStats,
} from './runtime-transport-telemetry.js';

export type RuntimePeerStatusState = RuntimeTransportPeerStats['state'] | 'unknown';

export interface RuntimePeerStatus {
  readonly nodeAddress: string;
  readonly state: RuntimePeerStatusState;
  readonly connected: boolean;
  readonly fresh: boolean;
  readonly staleAfterMs: number;
  readonly lastSeenAt?: string;
  readonly disconnectedAt?: string;
  readonly rejectedReason?: string;
  readonly staleReason?: string;
  readonly idempotency: RuntimeTransportIdempotencyStatus;
}

export interface RuntimeTransportIdempotencyStatus {
  readonly windowSize: number;
  readonly providerEnabled: boolean;
  readonly providerClaimCount: number;
  readonly providerDuplicateCount: number;
  readonly providerErrorCount: number;
  readonly lastProviderErrorAt?: string;
  readonly lastProviderErrorMessage?: string;
}

export interface RuntimeTransportStatus {
  readonly connectedNodes: readonly string[];
  readonly peers: readonly RuntimePeerStatus[];
  readonly startedAt?: string;
  readonly stoppedAt?: string;
  readonly idempotency?: RuntimeTransportIdempotencyStatus;
}

export interface RuntimeTransportStatusOptions {
  readonly staleAfterMs?: number;
  readonly now?: number;
}

interface RuntimeTransportStatusReadable extends MessageTransport {
  getStats?(): RuntimeTransportStats;
  getPeerStats?(nodeAddress: string): RuntimeTransportPeerStats | undefined;
}

const DEFAULT_RUNTIME_TRANSPORT_STATUS_STALE_AFTER_MS = 45_000;

function deriveRuntimeTransportIdempotencyStatus(
  stats?: Pick<
    RuntimeTransportPeerStats,
    | 'idempotencyWindowSize'
    | 'idempotencyProviderEnabled'
    | 'idempotencyProviderClaimCount'
    | 'idempotencyProviderDuplicateCount'
    | 'idempotencyProviderErrorCount'
    | 'lastIdempotencyProviderErrorAt'
    | 'lastIdempotencyProviderErrorMessage'
  >
): RuntimeTransportIdempotencyStatus {
  return {
    windowSize: stats?.idempotencyWindowSize ?? 0,
    providerEnabled: stats?.idempotencyProviderEnabled ?? false,
    providerClaimCount: stats?.idempotencyProviderClaimCount ?? 0,
    providerDuplicateCount: stats?.idempotencyProviderDuplicateCount ?? 0,
    providerErrorCount: stats?.idempotencyProviderErrorCount ?? 0,
    ...(stats?.lastIdempotencyProviderErrorAt
      ? { lastProviderErrorAt: stats.lastIdempotencyProviderErrorAt }
      : {}),
    ...(stats?.lastIdempotencyProviderErrorMessage
      ? { lastProviderErrorMessage: stats.lastIdempotencyProviderErrorMessage }
      : {}),
  };
}

export function deriveRuntimePeerStatus(
  nodeAddress: string,
  options: {
    readonly isConnected: boolean;
    readonly stats?: RuntimeTransportPeerStats;
    readonly staleAfterMs?: number;
    readonly now?: number;
  }
): RuntimePeerStatus {
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_RUNTIME_TRANSPORT_STATUS_STALE_AFTER_MS;
  const state = options.stats?.state ?? (options.isConnected ? 'connected' : 'unknown');
  const lastSeenAt = options.stats?.lastSeenAt;
  const disconnectedAt = options.stats?.disconnectedAt;
  const rejectedReason = options.stats?.rejectedReason;
  const lastSeenTime = lastSeenAt ? Date.parse(lastSeenAt) : Number.NaN;
  const canBecomeStale =
    Boolean(options.stats) && options.isConnected && state === 'connected' && staleAfterMs > 0;
  const isFresh =
    options.isConnected &&
    state === 'connected' &&
    (!canBecomeStale ||
      (Number.isFinite(lastSeenTime) &&
        (options.now ?? Date.now()) - lastSeenTime <= staleAfterMs));

  return {
    nodeAddress,
    state,
    connected: options.isConnected && state === 'connected' && isFresh,
    fresh: isFresh,
    staleAfterMs,
    ...(lastSeenAt ? { lastSeenAt } : {}),
    ...(disconnectedAt ? { disconnectedAt } : {}),
    ...(rejectedReason ? { rejectedReason } : {}),
    idempotency: deriveRuntimeTransportIdempotencyStatus(options.stats),
    ...(!isFresh && options.isConnected && state === 'connected'
      ? {
          staleReason: lastSeenAt
            ? `Peer has not been seen within ${staleAfterMs}ms.`
            : 'Peer has no last-seen timestamp.',
        }
      : {}),
  };
}

export function getRuntimePeerStatus(
  transport: MessageTransport,
  nodeAddress: string,
  options: RuntimeTransportStatusOptions = {}
): RuntimePeerStatus {
  const readable = transport as RuntimeTransportStatusReadable;
  return deriveRuntimePeerStatus(nodeAddress, {
    isConnected: transport.isConnected(nodeAddress),
    stats: readable.getPeerStats?.(nodeAddress),
    staleAfterMs: options.staleAfterMs,
    now: options.now,
  });
}

export function getRuntimeTransportStatus(
  transport: MessageTransport,
  options: RuntimeTransportStatusOptions = {}
): RuntimeTransportStatus {
  const readable = transport as RuntimeTransportStatusReadable;
  const stats = readable.getStats?.();
  const connectedNodes = transport.getConnectedNodes();
  const nodeAddresses = new Set([...connectedNodes, ...Object.keys(stats?.peers ?? {})]);
  const peers = Array.from(nodeAddresses).map((nodeAddress) =>
    getRuntimePeerStatus(transport, nodeAddress, options)
  );

  return {
    connectedNodes: peers.filter((peer) => peer.connected).map((peer) => peer.nodeAddress),
    peers,
    ...(stats?.startedAt ? { startedAt: stats.startedAt } : {}),
    ...(stats?.stoppedAt ? { stoppedAt: stats.stoppedAt } : {}),
    ...(stats ? { idempotency: deriveRuntimeTransportIdempotencyStatus(stats) } : {}),
  };
}
