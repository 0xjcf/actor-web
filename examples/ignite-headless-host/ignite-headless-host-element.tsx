/** @jsxImportSource ignite-element/jsx */

import 'ignite-element/renderers/ignite-jsx';

import { igniteCore } from 'ignite-element/actor-web';
import type { LogisticsEventLog, LogisticsHostState } from './headless-host';
import styles from './ignite-headless-host-element.css?raw';
import { type CreateShipmentInput, createShipmentId, logisticsSources } from './logistics-ui-ports';
import {
  type ProjectedLogisticsEventLog,
  type ProjectedTimelineEntry,
  projectEventLogItem,
  projectEventLogViewItem,
  projectTimeline,
} from './logistics-view-model';

export const IGNITE_HEADLESS_HOST_ELEMENT_NAME = 'aw-ignite-headless-host';
const IGNITE_ROUTING_SOURCE_ELEMENT_NAME = 'aw-logistics-routing-source';

interface LogisticsElementState extends Omit<LogisticsHostState, 'eventLog' | 'timeline'> {
  address: string;
  eventLog: ProjectedLogisticsEventLog[];
  statusBadgeClass: string;
  timeline: ProjectedTimelineEntry[];
  transportBadgeClass: string;
}

interface LogisticsElementLocalState {
  eventLog: LogisticsEventLog[];
}

const PAGE_SIZE = 5;
const localStateByAddress = new Map<string, LogisticsElementLocalState>();
const eventSubscriptionsByHost = new WeakSet<HTMLElement>();

function renderEvent(event: ProjectedLogisticsEventLog) {
  return (
    <li class={`item event-item ${event.runtime.tone}`}>
      <div class="item-heading">
        <span class="runtime-chip">{event.runtime.source}</span>
        <strong>{event.type}</strong>
      </div>
      <div class="route-meta">
        <span>{event.runtime.via}</span>
        <span>{event.actorLabel}</span>
      </div>
    </li>
  );
}

function renderTimelineEntry(entry: ProjectedTimelineEntry) {
  return (
    <li class={`item event-item ${entry.runtime.tone}`}>
      <div class="item-heading">
        <span class="runtime-chip">{entry.runtime.source}</span>
        <strong>{entry.label}</strong>
      </div>
      <div class="route-meta">
        <span>{entry.channel ?? entry.runtime.via}</span>
        <span>{entry.detail}</span>
        {entry.facility ? <span>Facility {entry.facility}</span> : null}
        {entry.loadId ? <span>Load {entry.loadId}</span> : null}
        {entry.note ? <span>{entry.note}</span> : null}
      </div>
    </li>
  );
}

function localStateFor(address: string): LogisticsElementLocalState {
  let state = localStateByAddress.get(address);
  if (!state) {
    state = {
      eventLog: [],
    };
    localStateByAddress.set(address, state);
  }

  return state;
}

function shipmentInputFromFormEvent(event: Event): CreateShipmentInput | null {
  event.preventDefault();
  if (!(event.currentTarget instanceof HTMLFormElement)) {
    return null;
  }

  const formData = new FormData(event.currentTarget);
  const destination = String(formData.get('destination') ?? '').trim();
  if (destination.length === 0) {
    return null;
  }

  return {
    destination,
    reference: String(formData.get('reference') ?? '').trim() || undefined,
  };
}

const registerIgniteHeadlessHost = igniteCore({
  source: logisticsSources.shipment,
  states: ({ address, context, phase, transport }) => {
    const local = localStateFor(address.path);
    return {
      phase,
      shipmentId: context.shipmentId,
      destination: context.destination,
      reference: context.reference,
      status: context.status,
      carrier: context.carrier,
      eta: context.eta,
      routeNotes: context.routeNotes,
      providerFacility: context.providerFacility,
      providerSignal: context.providerSignal,
      providerLoadId: context.providerLoadId,
      providerNote: context.providerNote,
      shipmentCount: context.shipmentCount,
      timeline: projectTimeline(context.timeline),
      eventLog: local.eventLog.map((event) => projectEventLogViewItem(event)),
      transportState: transport.state,
      transportReason: transport.reason ?? null,
      address: address.path,
      statusBadgeClass: `badge status-${context.status}`,
      transportBadgeClass: `badge transport-${transport.state}`,
    } satisfies LogisticsElementState;
  },
  commands: ({ actor, host }) => {
    const address = actor.address.path;

    if (!eventSubscriptionsByHost.has(host)) {
      eventSubscriptionsByHost.add(host);
      actor.subscribeEvent?.((event) => {
        const nextLocal = localStateFor(address);
        nextLocal.eventLog = [projectEventLogItem(event, actor.address.id), ...nextLocal.eventLog];
      });
    }

    return {
      createShipment(input: CreateShipmentInput): Promise<unknown> {
        const destination = input.destination.trim();
        if (destination.length === 0) {
          return Promise.resolve();
        }

        return actor.send({
          type: 'CREATE_SHIPMENT',
          shipmentId: input.shipmentId ?? createShipmentId(),
          destination,
          reference: input.reference?.trim() || undefined,
        });
      },

      resetShipment(): Promise<unknown> {
        return actor.send({ type: 'RESET_SHIPMENT' });
      },
    };
  },
  cleanup: true,
});

const registerRoutingSource = igniteCore({
  source: logisticsSources.routing,
  states: ({ address, context, transport }) => ({
    routingAddress: address.path,
    routingTransportState: transport.state,
    routingTransportReason: transport.reason ?? null,
    routingShipmentId: context.shipmentId,
    routingCarrier: context.carrier,
    routingEta: context.eta,
    routingRouteNotes: context.routeNotes,
  }),
  cleanup: true,
});

function defineRoutingSourceElement(): void {
  if (customElements.get(IGNITE_ROUTING_SOURCE_ELEMENT_NAME)) {
    return;
  }

  registerRoutingSource(IGNITE_ROUTING_SOURCE_ELEMENT_NAME, (view) => {
    return (
      <section class="panel">
        <style>{styles}</style>
        <div class="section-head">
          <h3>Worker Routing Source</h3>
          <span class={`badge transport-${view.routingTransportState}`}>
            {view.routingTransportState}
          </span>
        </div>
        <div class="grid">
          <div>
            <div class="label">Actor</div>
            <div class="value">
              <code>{view.routingAddress ?? 'not connected'}</code>
            </div>
          </div>
          <div>
            <div class="label">Shipment</div>
            <div class="value">{view.routingShipmentId ?? 'no route requested'}</div>
          </div>
          <div>
            <div class="label">Carrier</div>
            <div class="value">{view.routingCarrier ?? 'pending worker plan'}</div>
          </div>
          <div>
            <div class="label">ETA</div>
            <div class="value">{view.routingEta ?? 'pending'}</div>
          </div>
          <div>
            <div class="label">Route Notes</div>
            <div class="value">{view.routingRouteNotes ?? 'worker-owned actor source'}</div>
          </div>
          <div>
            <div class="label">Transport Reason</div>
            <div class="value">{view.routingTransportReason ?? 'none'}</div>
          </div>
        </div>
      </section>
    );
  });
}

export function defineIgniteHeadlessHostElement(): void {
  defineRoutingSourceElement();

  if (customElements.get(IGNITE_HEADLESS_HOST_ELEMENT_NAME)) {
    return;
  }

  registerIgniteHeadlessHost(IGNITE_HEADLESS_HOST_ELEMENT_NAME, (view) => {
    const canReset = view.shipmentCount > 0 || view.eventLog.length > 0;
    const visibleTimeline = view.timeline.slice(0, PAGE_SIZE);
    const visibleEvents = view.eventLog.slice(0, PAGE_SIZE);

    return (
      <>
        <style>{styles}</style>
        <main class="shell">
          <div class="frame">
            <header class="header">
              <div>
                <p class="eyebrow">Actor-Web Logistics Control Tower</p>
                <h1>REST ingress, live WebSocket projections, runtime transport</h1>
                <p class="copy">
                  Create a shipment through the thin Ignite host, watch gateway updates arrive live,
                  and route work to a WebWorker-owned Actor-Web runtime over WebSocket transport.
                </p>
              </div>

              <section class="summary">
                <div class="grid">
                  <div>
                    <div class="label">Shipment Status</div>
                    <div class="value">
                      <span class={view.statusBadgeClass}>{view.status}</span>
                    </div>
                  </div>
                  <div>
                    <div class="label">Shipments</div>
                    <div class="value">{view.shipmentCount}</div>
                  </div>
                  <div>
                    <div class="label">Transport</div>
                    <div class="value">
                      <span class={view.transportBadgeClass}>{view.transportState}</span>
                    </div>
                  </div>
                  <div>
                    <div class="label">Actor</div>
                    <div class="value">
                      <code>{view.address}</code>
                    </div>
                  </div>
                </div>
              </section>
            </header>

            <section class="layout">
              <aside class="stack">
                <section class="panel">
                  <h2>Create Shipment</h2>
                  <form
                    onSubmit={(event: Event) => {
                      const input = shipmentInputFromFormEvent(event);
                      if (input) {
                        void view.createShipment(input);
                      }
                    }}
                  >
                    <label class="field">
                      <span class="label">Destination</span>
                      <div class="toolbar">
                        <input
                          id="shipment-destination"
                          name="destination"
                          value="Chicago warehouse"
                          placeholder="Chicago warehouse"
                        />
                        <button type="submit" id="create-shipment">
                          Create
                        </button>
                      </div>
                    </label>
                    <label class="field">
                      <span class="label">Reference</span>
                      <input
                        id="shipment-reference"
                        name="reference"
                        value="REF-1001"
                        placeholder="REF-1001"
                      />
                    </label>
                  </form>
                  <div class="quick-grid">
                    <button
                      type="button"
                      class="secondary"
                      onClick={() =>
                        void view.createShipment({
                          destination: 'Dallas cross-dock',
                          reference: 'REF-2002',
                        })
                      }
                    >
                      Dallas
                    </button>
                    <button
                      type="button"
                      class="secondary"
                      onClick={() =>
                        void view.createShipment({
                          destination: 'International hub',
                          reference: 'REF-3003',
                        })
                      }
                    >
                      International
                    </button>
                    <button
                      type="button"
                      class="danger"
                      disabled={!canReset}
                      onClick={() => void view.resetShipment()}
                    >
                      Reset
                    </button>
                  </div>
                </section>

                <section class="panel">
                  <h3>Runtime Topology</h3>
                  <ul class="list">
                    <li class="item event-item tone-local">
                      <div class="item-heading">
                        <span class="runtime-chip">Browser</span>
                        <strong>Browser Host</strong>
                      </div>
                      <span class="muted">Ignite thin projection host; submits REST intent.</span>
                    </li>
                    <li class="item event-item tone-server">
                      <div class="item-heading">
                        <span class="runtime-chip">Server</span>
                        <strong>Server Runtime</strong>
                      </div>
                      <span class="muted">Owns shipment actor, REST ingress, gateway updates.</span>
                    </li>
                    <li class="item event-item tone-worker">
                      <div class="item-heading">
                        <span class="runtime-chip">Worker</span>
                        <strong>WebWorker Runtime</strong>
                      </div>
                      <span class="muted">Owns routing actor over Actor-Web transport.</span>
                    </li>
                    <li class="item event-item tone-local">
                      <div class="item-heading">
                        <span class="runtime-chip">Fallback</span>
                        <strong>Service Worker Runtime</strong>
                      </div>
                      <span class="muted">Browser-local MessagePort topology proof.</span>
                    </li>
                  </ul>
                </section>

                <section class="panel">
                  <h3>Remote Provider HQ</h3>
                  <div class="grid">
                    <div>
                      <div class="label">Facility</div>
                      <div class="value">{view.providerFacility ?? 'waiting for scan'}</div>
                    </div>
                    <div>
                      <div class="label">Signal</div>
                      <div class="value">{view.providerSignal ?? 'none'}</div>
                    </div>
                    <div>
                      <div class="label">Truck Load</div>
                      <div class="value">{view.providerLoadId ?? 'unassigned'}</div>
                    </div>
                    <div>
                      <div class="label">Provider Note</div>
                      <div class="value">{view.providerNote ?? 'No provider update yet.'}</div>
                    </div>
                  </div>
                  <a href="./provider.html">Open Provider HQ Console</a>
                </section>
              </aside>

              <div class="stack">
                <section class="panel">
                  <h3>Live Shipment Projection</h3>
                  <div class="grid">
                    <div>
                      <div class="label">Shipment</div>
                      <div class="value">{view.shipmentId ?? 'none'}</div>
                    </div>
                    <div>
                      <div class="label">Destination</div>
                      <div class="value">{view.destination ?? 'none'}</div>
                    </div>
                    <div>
                      <div class="label">Carrier</div>
                      <div class="value">{view.carrier ?? 'pending'}</div>
                    </div>
                    <div>
                      <div class="label">ETA</div>
                      <div class="value">{view.eta ?? 'pending'}</div>
                    </div>
                    <div>
                      <div class="label">Route Notes</div>
                      <div class="value">{view.routeNotes ?? 'pending route plan'}</div>
                    </div>
                    <div>
                      <div class="label">Transport Reason</div>
                      <div class="value">{view.transportReason ?? 'none'}</div>
                    </div>
                  </div>
                </section>

                <aw-logistics-routing-source />

                <section class="panel">
                  <h3>Message Routes</h3>
                  <div class="route-grid">
                    <div class="route-card tone-server">
                      <span class="runtime-chip">1 Browser {'->'} Server</span>
                      <strong>REST command ingress</strong>
                      <span class="muted">POST /shipments creates shipment intent.</span>
                    </div>
                    <div class="route-card tone-worker">
                      <span class="runtime-chip">2 Server {'->'} Worker</span>
                      <strong>Route planning ask</strong>
                      <span class="muted">PLAN_ROUTE over Actor-Web MessageTransport.</span>
                    </div>
                    <div class="route-card tone-worker">
                      <span class="runtime-chip">3 Worker {'->'} Server</span>
                      <strong>Route plan reply</strong>
                      <span class="muted">
                        Carrier, ETA, and route notes return to server actor.
                      </span>
                    </div>
                    <div class="route-card tone-lifecycle">
                      <span class="runtime-chip">4 Server lifecycle</span>
                      <strong>Shipped / delivered / returned</strong>
                      <span class="muted">Server-owned timed lifecycle signals.</span>
                    </div>
                    <div class="route-card tone-provider">
                      <span class="runtime-chip">Provider HQ</span>
                      <strong>Label, truck, and exception scans</strong>
                      <span class="muted">
                        External provider signals applied by server runtime.
                      </span>
                    </div>
                    <div class="route-card tone-server">
                      <span class="runtime-chip">5 Server {'->'} Browser</span>
                      <strong>Gateway WebSocket projection</strong>
                      <span class="muted">Snapshots, events, status, and replies stream live.</span>
                    </div>
                    <div class="route-card tone-local">
                      <span class="runtime-chip">Fallback</span>
                      <strong>MessagePort service worker proof</strong>
                      <span class="muted">Browser-local topology only, not server transport.</span>
                    </div>
                  </div>
                </section>

                <section class="panel">
                  <div class="section-head">
                    <h3>Timeline</h3>
                    <span class="muted">Latest {PAGE_SIZE}</span>
                  </div>
                  <ol class="list">
                    {visibleTimeline.length > 0 ? (
                      visibleTimeline.map((entry) => renderTimelineEntry(entry))
                    ) : (
                      <li class="item">
                        <span class="muted">No shipment activity yet.</span>
                      </li>
                    )}
                  </ol>
                  <div class="pager">
                    <button type="button" class="secondary" disabled={true}>
                      Previous
                    </button>
                    <span class="muted">{view.timeline.length} total timeline entries</span>
                    <button type="button" class="secondary" disabled={true}>
                      Next
                    </button>
                  </div>
                </section>

                <section class="panel">
                  <div class="section-head">
                    <h3>Gateway Event Stream</h3>
                    <span class="muted">Latest {PAGE_SIZE}</span>
                  </div>
                  <ol class="list">
                    {visibleEvents.length > 0 ? (
                      visibleEvents.map((event) => renderEvent(event))
                    ) : (
                      <li class="item">
                        <span class="muted">No emitted events yet.</span>
                      </li>
                    )}
                  </ol>
                  <div class="pager">
                    <button type="button" class="secondary" disabled={true}>
                      Previous
                    </button>
                    <span class="muted">{view.eventLog.length} total gateway events</span>
                    <button type="button" class="secondary" disabled={true}>
                      Next
                    </button>
                  </div>
                </section>
              </div>
            </section>
          </div>
        </main>
      </>
    );
  });
}
