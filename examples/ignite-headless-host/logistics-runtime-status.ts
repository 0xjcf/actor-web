/// <reference types="vite/client" />

import { serviceWorkerRuntimeAvailable } from './browser-transport';
import { logistics } from './logistics-topology';

export interface LogisticsRuntimePeerStatus {
  readonly nodeAddress: string;
  readonly state: string;
  readonly connected: boolean;
  readonly fresh: boolean;
  readonly staleAfterMs: number;
  readonly lastSeenAt?: string;
  readonly disconnectedAt?: string;
  readonly rejectedReason?: string;
  readonly staleReason?: string;
}

export interface LogisticsRuntimeStatusResponse {
  readonly gatewayUrl: string | null;
  readonly transportUrl: string | null;
  readonly lifecycleMode: string;
  readonly transport: {
    readonly connectedNodes: readonly string[];
    readonly peers: readonly LogisticsRuntimePeerStatus[];
    readonly workerConnected: boolean;
    readonly workerPeerFresh: boolean;
    readonly workerPeer: LogisticsRuntimePeerStatus;
  };
  readonly nodes: {
    readonly browserHost: string;
    readonly serverRuntime: string;
    readonly workerRuntime: string;
    readonly serviceWorkerRuntime: string;
  };
  readonly actors: {
    readonly shipment: string;
    readonly routing: string;
    readonly providerHq: string;
    readonly logisticsSupervisor: string;
    readonly dispatcher: string;
    readonly driverDirectory: string;
    readonly serviceWorkerProof: string;
  };
}

export interface LogisticsRuntimeMetricView {
  readonly label: string;
  readonly value: string;
  readonly unavailable: boolean;
}

export interface LogisticsRuntimeNodeView {
  readonly id: string;
  readonly chipLabel: string;
  readonly chipToneClass: string;
  readonly title: string;
  readonly processLabel: string;
  readonly nodeAddress: string;
  readonly actorAddresses: readonly string[];
  readonly statusLabel: string;
  readonly statusBadgeClass: string;
  readonly detail: string;
  readonly peerState: string;
  readonly connectedLabel: string;
  readonly freshLabel: string;
  readonly lastSeenAt: string;
  readonly disconnectedAt: string;
  readonly staleReason: string;
  readonly rejectedReason: string;
}

export interface LogisticsRuntimeStatusView {
  readonly sourceLabel: string;
  readonly lifecycleMode: string;
  readonly gatewayUrl: string;
  readonly transportUrl: string;
  readonly workerSummaryLabel: string;
  readonly workerSummaryBadgeClass: string;
  readonly pollingError: string | null;
  readonly metrics: readonly LogisticsRuntimeMetricView[];
  readonly nodes: readonly LogisticsRuntimeNodeView[];
}

export const LOGISTICS_RUNTIME_STATUS_POLL_INTERVAL_MS = 1_500;

function configuredRestUrl(): string | null {
  const configuredUrl = import.meta.env.VITE_ACTOR_WEB_REST_URL;

  return typeof configuredUrl === 'string' && configuredUrl.trim().length > 0
    ? configuredUrl
    : null;
}

function displayValue(value: string | null | undefined, fallback = 'unavailable'): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function displayBoolean(value: boolean | null | undefined): string {
  return value === true ? 'true' : value === false ? 'false' : 'unavailable';
}

function runtimeStatusSourceLabel(): string {
  const restUrl = configuredRestUrl();

  return restUrl ? `${restUrl}/runtime/status` : '/runtime/status';
}

function createMetricView(
  label: string,
  value: string | number,
  unavailable = false
): LogisticsRuntimeMetricView {
  return {
    label,
    value: String(value),
    unavailable,
  };
}

function createUnavailableMetric(label: string): LogisticsRuntimeMetricView {
  return createMetricView(label, 'unavailable', true);
}

function createNodeView(input: LogisticsRuntimeNodeView): LogisticsRuntimeNodeView {
  return input;
}

function workerSummaryLabel(
  workerConnected: boolean,
  workerPeerFresh: boolean,
  recovered: boolean
): { label: string; badgeClass: string } {
  if (recovered) {
    return {
      label: 'worker recovered',
      badgeClass: 'badge runtime-recovered',
    };
  }

  if (workerConnected && workerPeerFresh) {
    return {
      label: 'worker connected',
      badgeClass: 'badge runtime-connected',
    };
  }

  if (workerConnected) {
    return {
      label: 'worker stale',
      badgeClass: 'badge runtime-warning',
    };
  }

  return {
    label: 'worker disconnected',
    badgeClass: 'badge runtime-disconnected',
  };
}

function deriveWorkerNodeStatus(
  previous: LogisticsRuntimeStatusView | null,
  response: LogisticsRuntimeStatusResponse
): { label: string; badgeClass: string; recovered: boolean } {
  const wasDisconnected =
    previous?.pollingError === null && previous.workerSummaryLabel === 'worker disconnected';
  const recovered =
    wasDisconnected && response.transport.workerConnected && response.transport.workerPeerFresh;

  if (recovered) {
    return {
      label: 'Recovered',
      badgeClass: 'badge runtime-recovered',
      recovered: true,
    };
  }

  if (response.transport.workerConnected && response.transport.workerPeerFresh) {
    return {
      label: 'Connected',
      badgeClass: 'badge runtime-connected',
      recovered: false,
    };
  }

  if (response.transport.workerConnected) {
    return {
      label: 'Connected / stale',
      badgeClass: 'badge runtime-warning',
      recovered: false,
    };
  }

  return {
    label: 'Disconnected',
    badgeClass: 'badge runtime-disconnected',
    recovered: false,
  };
}

function createRuntimeNodeViews(
  previous: LogisticsRuntimeStatusView | null,
  response: LogisticsRuntimeStatusResponse
): readonly LogisticsRuntimeNodeView[] {
  const workerStatus = deriveWorkerNodeStatus(previous, response);
  const workerPeer = response.transport.workerPeer;
  const browserNodeAddress = logistics.nodes.browser.address;

  return [
    createNodeView({
      id: 'browser-host',
      chipLabel: 'Browser',
      chipToneClass: 'tone-local',
      title: 'Browser Host',
      processLabel: 'Local browser process',
      nodeAddress: browserNodeAddress,
      actorAddresses: [],
      statusLabel: 'Local projection host',
      statusBadgeClass: 'badge runtime-proof',
      detail: 'Thin Ignite host; REST intent and gateway projections only.',
      peerState: 'proof/local',
      connectedLabel: 'not a runtime peer',
      freshLabel: 'not tracked',
      lastSeenAt: 'unavailable',
      disconnectedAt: 'unavailable',
      staleReason: 'unavailable',
      rejectedReason: 'unavailable',
    }),
    createNodeView({
      id: 'server-runtime',
      chipLabel: 'Server',
      chipToneClass: 'tone-server',
      title: 'Server Runtime',
      processLabel: 'Node server process / server-runtime container',
      nodeAddress: response.nodes.serverRuntime,
      actorAddresses: [
        response.actors.shipment,
        response.actors.providerHq,
        response.actors.logisticsSupervisor,
        response.actors.dispatcher,
        response.actors.driverDirectory,
      ],
      statusLabel: 'Connected',
      statusBadgeClass: 'badge runtime-connected',
      detail: 'Operator source of truth for gateway, transport listener, and shipment actors.',
      peerState: response.transport.connectedNodes.length > 0 ? 'peers connected' : 'no peers',
      connectedLabel: 'true',
      freshLabel: 'n/a',
      lastSeenAt: 'unavailable',
      disconnectedAt: 'unavailable',
      staleReason: 'unavailable',
      rejectedReason: 'unavailable',
    }),
    createNodeView({
      id: 'worker-runtime',
      chipLabel: 'Worker',
      chipToneClass: 'tone-worker',
      title: 'Worker Runtime',
      processLabel: 'WebWorker or worker-runtime container',
      nodeAddress: response.nodes.workerRuntime,
      actorAddresses: [response.actors.routing],
      statusLabel: workerStatus.label,
      statusBadgeClass: workerStatus.badgeClass,
      detail: workerStatus.recovered
        ? 'Recovered after a prior disconnect and rejoined transport.'
        : 'Runtime-derived peer health from /runtime/status.',
      peerState: displayValue(workerPeer.state),
      connectedLabel: displayBoolean(response.transport.workerConnected),
      freshLabel: displayBoolean(response.transport.workerPeerFresh),
      lastSeenAt: displayValue(workerPeer.lastSeenAt),
      disconnectedAt: displayValue(workerPeer.disconnectedAt),
      staleReason: displayValue(workerPeer.staleReason),
      rejectedReason: displayValue(workerPeer.rejectedReason),
    }),
    createNodeView({
      id: 'service-worker-proof',
      chipLabel: 'Proof',
      chipToneClass: 'tone-local',
      title: 'Service Worker Proof',
      processLabel: 'Browser-local service worker scope',
      nodeAddress: response.nodes.serviceWorkerRuntime,
      actorAddresses: [response.actors.serviceWorkerProof],
      statusLabel: serviceWorkerRuntimeAvailable() ? 'Available locally' : 'Unavailable locally',
      statusBadgeClass: serviceWorkerRuntimeAvailable()
        ? 'badge runtime-proof'
        : 'badge runtime-unavailable',
      detail: 'MessagePort proof only; not a cluster membership source of truth.',
      peerState: 'proof/local',
      connectedLabel: 'not tracked',
      freshLabel: 'not tracked',
      lastSeenAt: 'unavailable',
      disconnectedAt: 'unavailable',
      staleReason: 'unavailable',
      rejectedReason: 'unavailable',
    }),
  ];
}

export function createInitialLogisticsRuntimeStatusView(): LogisticsRuntimeStatusView {
  const restUrl = configuredRestUrl();
  return {
    sourceLabel: runtimeStatusSourceLabel(),
    lifecycleMode: 'unknown',
    gatewayUrl: 'unavailable',
    transportUrl: 'unavailable',
    workerSummaryLabel: 'worker disconnected',
    workerSummaryBadgeClass: 'badge runtime-disconnected',
    pollingError: restUrl ? 'Waiting for operator status.' : 'Set VITE_ACTOR_WEB_REST_URL.',
    metrics: [
      createMetricView('Connected nodes', 0),
      createMetricView('Known peers', 0),
      createUnavailableMetric('Frames sent'),
      createUnavailableMetric('Frames received'),
    ],
    nodes: [
      createNodeView({
        id: 'browser-host',
        chipLabel: 'Browser',
        chipToneClass: 'tone-local',
        title: 'Browser Host',
        processLabel: 'Local browser process',
        nodeAddress: logistics.nodes.browser.address,
        actorAddresses: [],
        statusLabel: 'Local projection host',
        statusBadgeClass: 'badge runtime-proof',
        detail: 'Thin Ignite host; waiting for /runtime/status.',
        peerState: 'proof/local',
        connectedLabel: 'not a runtime peer',
        freshLabel: 'not tracked',
        lastSeenAt: 'unavailable',
        disconnectedAt: 'unavailable',
        staleReason: 'unavailable',
        rejectedReason: 'unavailable',
      }),
    ],
  };
}

export function reduceLogisticsRuntimeStatusView(
  previous: LogisticsRuntimeStatusView | null,
  response: LogisticsRuntimeStatusResponse
): LogisticsRuntimeStatusView {
  const workerStatus = deriveWorkerNodeStatus(previous, response);
  const workerSummary = workerSummaryLabel(
    response.transport.workerConnected,
    response.transport.workerPeerFresh,
    workerStatus.recovered
  );

  return {
    sourceLabel: runtimeStatusSourceLabel(),
    lifecycleMode: response.lifecycleMode,
    gatewayUrl: displayValue(response.gatewayUrl),
    transportUrl: displayValue(response.transportUrl),
    workerSummaryLabel: workerSummary.label,
    workerSummaryBadgeClass: workerSummary.badgeClass,
    pollingError: null,
    metrics: [
      createMetricView('Connected nodes', response.transport.connectedNodes.length),
      createMetricView('Known peers', response.transport.peers.length),
      createUnavailableMetric('Frames sent'),
      createUnavailableMetric('Frames received'),
    ],
    nodes: createRuntimeNodeViews(previous, response),
  };
}

export function applyLogisticsRuntimeStatusError(
  previous: LogisticsRuntimeStatusView,
  error: unknown
): LogisticsRuntimeStatusView {
  return {
    ...previous,
    pollingError:
      error instanceof Error ? error.message : 'Unable to load /runtime/status for operator panel.',
  };
}

export async function fetchLogisticsRuntimeStatus(): Promise<LogisticsRuntimeStatusResponse> {
  const restUrl = configuredRestUrl();
  if (!restUrl) {
    throw new Error('VITE_ACTOR_WEB_REST_URL is required for the runtime operator panel.');
  }

  const response = await fetch(`${restUrl}/runtime/status`);
  if (!response.ok) {
    throw new Error(`/runtime/status failed with ${response.status}`);
  }

  return (await response.json()) as LogisticsRuntimeStatusResponse;
}
