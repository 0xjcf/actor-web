/** @jsxImportSource ignite-element/jsx */

import { type ActorSource, createProjectionTransportStatus } from '@actor-web/runtime/browser';
import { igniteCore } from 'ignite-element/actor-web';
import styles from './ignite-headless-host-element.css?raw';
import {
  applyLogisticsRuntimeStatusError,
  createInitialLogisticsRuntimeStatusView,
  fetchLogisticsRuntimeStatus,
  LOGISTICS_RUNTIME_STATUS_POLL_INTERVAL_MS,
  type LogisticsRuntimeStatusView,
  reduceLogisticsRuntimeStatusView,
} from './logistics-runtime-status';
import { createActorSnapshot } from './logistics-snapshots';

export const LOGISTICS_RUNTIME_STATUS_PANEL_ELEMENT_NAME = 'aw-logistics-runtime-status-panel';

interface RuntimeStatusCommand {
  readonly type: 'REFRESH_RUNTIME_STATUS';
}

type RuntimeStatusSource = ActorSource<
  LogisticsRuntimeStatusView,
  RuntimeStatusCommand,
  { type: 'RUNTIME_STATUS_REFRESHED' }
>;

function createRuntimeStatusSource(): { source: RuntimeStatusSource; stop(): void } {
  // Operator demo surface only: this source owns the /runtime/status side-channel
  // and does not participate in shipment actor state.
  let context = createInitialLogisticsRuntimeStatusView();
  let transport = createProjectionTransportStatus('local');
  const snapshotListeners = new Set<
    (snapshot: ReturnType<RuntimeStatusSource['snapshot']>) => void
  >();
  const transportListeners = new Set<
    (status: ReturnType<RuntimeStatusSource['transportStatus']>) => void
  >();
  let stopped = false;
  let syncInFlight = false;

  const source: RuntimeStatusSource = {
    address: {
      id: 'logistics-runtime-status-panel',
      type: 'actor',
      path: 'actor://logistics-browser-host/actor/logistics-runtime-status-panel',
    },
    snapshot: () => {
      const phase = context.pollingError ? 'degraded' : 'ready';
      const snapshot = createActorSnapshot(phase, context);

      return {
        ...snapshot,
        address: source.address,
        phase,
        toJSON: () => ({
          ...snapshot.toJSON(),
          address: source.address,
          phase,
        }),
      };
    },
    subscribe(listener) {
      snapshotListeners.add(listener);
      listener(source.snapshot());
      return () => {
        snapshotListeners.delete(listener);
      };
    },
    transportStatus: () => transport,
    subscribeTransportStatus(listener) {
      transportListeners.add(listener);
      listener(transport);
      return () => {
        transportListeners.delete(listener);
      };
    },
    subscribeEvent() {
      return () => {};
    },
    async send(_message) {},
    async ask<Response = unknown>() {
      return undefined as Response;
    },
  };

  const notify = (): void => {
    const snapshot = source.snapshot();
    for (const listener of snapshotListeners) {
      listener(snapshot);
    }
    for (const listener of transportListeners) {
      listener(transport);
    }
  };

  const sync = async (): Promise<void> => {
    if (stopped || syncInFlight) {
      return;
    }

    syncInFlight = true;
    try {
      const response = await fetchLogisticsRuntimeStatus();
      if (stopped) {
        return;
      }
      context = reduceLogisticsRuntimeStatusView(context, response);
      transport = createProjectionTransportStatus('connected');
    } catch (error) {
      if (stopped) {
        return;
      }
      context = applyLogisticsRuntimeStatusError(context, error);
      transport = createProjectionTransportStatus('degraded');
    } finally {
      syncInFlight = false;
    }

    if (stopped) {
      return;
    }
    notify();
  };

  const intervalId = window.setInterval(() => {
    void sync();
  }, LOGISTICS_RUNTIME_STATUS_POLL_INTERVAL_MS);
  void sync();

  return {
    source,
    stop() {
      stopped = true;
      window.clearInterval(intervalId);
    },
  };
}

const runtimeStatusSource = createRuntimeStatusSource();

const registerRuntimeStatusPanel = igniteCore({
  source: runtimeStatusSource,
  states: ({ context, transport }) => ({
    runtimeStatus: context ?? createInitialLogisticsRuntimeStatusView(),
    runtimeTransportState: transport.state,
  }),
  cleanup: true,
});

registerRuntimeStatusPanel(LOGISTICS_RUNTIME_STATUS_PANEL_ELEMENT_NAME, (view) => {
  return (
    <section class="panel">
      <style>{styles}</style>
      <div class="section-head">
        <h3>Runtime Operator Panel</h3>
        <span class={view.runtimeStatus.workerSummaryBadgeClass}>
          {view.runtimeStatus.workerSummaryLabel}
        </span>
      </div>
      <p class="muted">
        Live operator status from <code>{view.runtimeStatus.sourceLabel}</code>. Browser host and
        service-worker rows are local proof labels, not cluster membership.
      </p>
      <div class="runtime-metrics">
        <div class="route-card tone-server">
          <span class="runtime-chip">Mode</span>
          <strong>{view.runtimeStatus.lifecycleMode}</strong>
          <span class="muted">Gateway {view.runtimeStatus.gatewayUrl}</span>
        </div>
        <div class="route-card tone-worker">
          <span class="runtime-chip">Transport</span>
          <strong>{view.runtimeStatus.transportUrl}</strong>
          <span class="muted">Panel source {view.runtimeTransportState}</span>
        </div>
        <div class="route-card tone-provider">
          <span class="runtime-chip">Provider Source</span>
          <strong>{view.runtimeStatus.providerSourceLabel}</strong>
          <span class="muted">Manual UI, simulator process, or provider container.</span>
        </div>
        {view.runtimeStatus.metrics.map((metric) => (
          <div class="route-card tone-local">
            <span class="runtime-chip">{metric.label}</span>
            <strong>{metric.value}</strong>
            <span class="muted">
              {metric.unavailable ? 'Runtime status does not expose this counter yet.' : ''}
            </span>
          </div>
        ))}
      </div>
      {view.runtimeStatus.pollingError ? (
        <div class="runtime-alert">{view.runtimeStatus.pollingError}</div>
      ) : null}
      <ul class="list runtime-status-list">
        {view.runtimeStatus.nodes.map((node) => (
          <li class={`item runtime-node ${node.chipToneClass}`}>
            <div class="item-heading">
              <span class="runtime-chip">{node.chipLabel}</span>
              <strong>{node.title}</strong>
              <span class={node.statusBadgeClass}>{node.statusLabel}</span>
            </div>
            <div class="route-meta">
              <span>{node.processLabel}</span>
              <span>{node.detail}</span>
            </div>
            <div class="runtime-node-grid">
              <div>
                <div class="label">Node Identity</div>
                <div class="value">
                  <code>{node.nodeAddress}</code>
                </div>
              </div>
              <div>
                <div class="label">Peer State</div>
                <div class="value">{node.peerState}</div>
              </div>
              <div>
                <div class="label">Connected</div>
                <div class="value">{node.connectedLabel}</div>
              </div>
              <div>
                <div class="label">Fresh</div>
                <div class="value">{node.freshLabel}</div>
              </div>
              <div>
                <div class="label">Last Seen</div>
                <div class="value">{node.lastSeenAt}</div>
              </div>
              <div>
                <div class="label">Disconnected At</div>
                <div class="value">{node.disconnectedAt}</div>
              </div>
              <div>
                <div class="label">Stale Reason</div>
                <div class="value">{node.staleReason}</div>
              </div>
              <div>
                <div class="label">Rejected Reason</div>
                <div class="value">{node.rejectedReason}</div>
              </div>
            </div>
            <div class="field">
              <span class="label">Actor Addresses</span>
              {node.actorAddresses.length > 0 ? (
                <ul class="runtime-actor-list">
                  {node.actorAddresses.map((actorAddress) => (
                    <li>
                      <code>{actorAddress}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <span class="muted">Display-only browser host. No actor address.</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
});
