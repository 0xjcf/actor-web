/** @jsxImportSource ignite-element/jsx */

import { type ActorAddress, parse } from '@actor-web/runtime';
import { type ActorWebAddress, igniteCore } from 'ignite-element/actor-web';
import styles from './ignite-headless-host-element.css?raw';
import { logisticsClient } from './logistics-browser-client';
import { createInitialShipmentContext, type ShipmentContext } from './logistics-contract';
import { createInitialProviderHqContext } from './logistics-provider-hq';
import './logistics-runtime-status-panel';
import {
  type LogisticsEventLog,
  type ProjectedLogisticsEventLog,
  type ProjectedTimelineEntry,
  paginateItems,
  projectEventLogItem,
  projectEventLogViewItem,
  projectTimeline,
} from './logistics-view-model';

export const IGNITE_HEADLESS_HOST_ELEMENT_NAME = 'aw-ignite-headless-host';
const IGNITE_ROUTING_SOURCE_ELEMENT_NAME = 'aw-logistics-routing-source';
const IGNITE_PROVIDER_HQ_SOURCE_ELEMENT_NAME = 'aw-logistics-provider-hq-source';

// Actor-Web addresses are opaque branded path strings: the address string IS
// the path, and structured fields are read back through parse() at the boundary.
// ignite types snapshot/actor `address` as the tolerant union
// `string | { id; path; ... }`, so normalize both shapes here instead of
// scattering casts. At runtime an Actor-Web address is always the branded string.
const addressPath = (address: ActorWebAddress): string =>
  typeof address === 'string' ? address : address.path;

const addressId = (address: ActorWebAddress): string =>
  typeof address === 'string' ? parse(address as ActorAddress).id : address.id;

interface LogisticsElementState {
  address: string;
  carrier: string | null;
  canReset: boolean;
  canGoToNextEventLogPage: boolean;
  canGoToNextTimelinePage: boolean;
  canGoToPreviousEventLogPage: boolean;
  canGoToPreviousTimelinePage: boolean;
  destination: string | null;
  eventLog: ProjectedLogisticsEventLog[];
  eventLogPage: number;
  eventLogPageCount: number;
  eventLogTotal: number;
  eta: string | null;
  pageSize: number;
  phase: string;
  reference: string | null;
  routeNotes: string | null;
  shipmentCount: number;
  shipmentId: string | null;
  status: ShipmentContext['status'];
  statusBadgeClass: string;
  timeline: ProjectedTimelineEntry[];
  timelinePage: number;
  timelinePageCount: number;
  timelineTotal: number;
  transportBadgeClass: string;
  transportReason: string | null;
  transportState: string;
  visibleEventLog: ProjectedLogisticsEventLog[];
  visibleTimeline: ProjectedTimelineEntry[];
}

interface LogisticsElementLocalState {
  eventLog: LogisticsEventLog[];
  eventLogPage: number;
  timelinePage: number;
}

const PAGE_SIZE = 5;
const localStateByAddress = new Map<string, LogisticsElementLocalState>();
const eventSubscriptionsByHost = new WeakSet<HTMLElement>();

interface CreateShipmentInput {
  destination: string;
  reference?: string | null;
  shipmentId?: string;
}

function createShipmentId(): string {
  return `shipment-${Date.now().toString(36)}`;
}

function configuredRestUrl(): string | null {
  const configuredUrl = import.meta.env.VITE_ACTOR_WEB_REST_URL;

  return typeof configuredUrl === 'string' && configuredUrl.trim().length > 0
    ? configuredUrl
    : null;
}

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
      eventLogPage: 0,
      timelinePage: 0,
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
  source: () => logisticsClient.actors.shipment,
  view: ({ snapshot }) => {
    const shipmentContext = snapshot.context ?? createInitialShipmentContext();
    const local = localStateFor(addressPath(snapshot.address));
    const timeline = projectTimeline(shipmentContext.timeline);
    const eventLog = local.eventLog.map((event) => projectEventLogViewItem(event));
    const timelinePage = paginateItems(timeline, local.timelinePage, PAGE_SIZE);
    const eventLogPage = paginateItems(eventLog, local.eventLogPage, PAGE_SIZE);
    local.timelinePage = timelinePage.page;
    local.eventLogPage = eventLogPage.page;

    return {
      phase: snapshot.phase,
      shipmentId: shipmentContext.shipmentId,
      destination: shipmentContext.destination,
      reference: shipmentContext.reference,
      status: shipmentContext.status,
      carrier: shipmentContext.carrier,
      eta: shipmentContext.eta,
      routeNotes: shipmentContext.routeNotes,
      shipmentCount: shipmentContext.shipmentCount,
      canReset: shipmentContext.shipmentCount > 0 || eventLog.length > 0,
      timeline,
      timelinePage: timelinePage.page,
      timelinePageCount: timelinePage.pageCount,
      timelineTotal: timelinePage.total,
      visibleTimeline: timelinePage.items,
      eventLog,
      eventLogPage: eventLogPage.page,
      eventLogPageCount: eventLogPage.pageCount,
      eventLogTotal: eventLogPage.total,
      visibleEventLog: eventLogPage.items,
      pageSize: PAGE_SIZE,
      canGoToPreviousTimelinePage: timelinePage.canGoToPreviousPage,
      canGoToNextTimelinePage: timelinePage.canGoToNextPage,
      canGoToPreviousEventLogPage: eventLogPage.canGoToPreviousPage,
      canGoToNextEventLogPage: eventLogPage.canGoToNextPage,
      transportState: snapshot.transport.state,
      transportReason: snapshot.transport.reason ?? null,
      address: addressPath(snapshot.address),
      statusBadgeClass: `badge status-${shipmentContext.status}`,
      transportBadgeClass: `badge transport-${snapshot.transport.state}`,
    } satisfies LogisticsElementState;
  },
  commands: ({ actor, command, host }) => {
    const address = addressPath(actor.address);
    const requestViewRefresh = () => actor.send({ type: 'GET_SHIPMENT_COUNT' });

    if (!eventSubscriptionsByHost.has(host)) {
      eventSubscriptionsByHost.add(host);
      actor.subscribeEvent?.((event) => {
        const nextLocal = localStateFor(address);
        nextLocal.eventLog = [
          projectEventLogItem(event, addressId(actor.address)),
          ...nextLocal.eventLog,
        ];
      });
    }

    return {
      createShipment: command(
        (input: CreateShipmentInput) => {
          const destination = input.destination.trim();
          const shipmentId = input.shipmentId ?? createShipmentId();
          const reference = input.reference?.trim() || undefined;

          const restUrl = configuredRestUrl();
          if (restUrl) {
            return fetch(`${restUrl}/shipments`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                shipmentId,
                destination,
                reference,
              }),
            }).then((response) => {
              if (!response.ok) {
                throw new Error(`Shipment ingress failed with ${response.status}`);
              }
            });
          }

          return actor.send({
            type: 'CREATE_SHIPMENT',
            shipmentId,
            destination,
            reference,
          });
        },
        {
          description:
            'Create a shipment through REST ingress when available, or send the actor command directly for local proof mode.',
        }
      ),

      resetShipment: command(
        () => {
          const local = localStateFor(address);
          local.timelinePage = 0;
          local.eventLogPage = 0;
          const restUrl = configuredRestUrl();
          if (restUrl) {
            return fetch(`${restUrl}/shipments/current/reset`, {
              method: 'POST',
            }).then((response) => {
              if (!response.ok) {
                throw new Error(`Shipment reset failed with ${response.status}`);
              }
            });
          }

          return actor.send({ type: 'RESET_SHIPMENT' });
        },
        {
          description:
            'Reset the active shipment and clear the local timeline and event-log pagination state.',
        }
      ),

      previousTimelinePage: command(
        () => {
          const local = localStateFor(address);
          local.timelinePage = Math.max(0, local.timelinePage - 1);
          return requestViewRefresh();
        },
        {
          description: 'Show the previous page of shipment timeline entries.',
        }
      ),

      nextTimelinePage: command(
        () => {
          const local = localStateFor(address);
          local.timelinePage += 1;
          return requestViewRefresh();
        },
        {
          description: 'Show the next page of shipment timeline entries.',
        }
      ),

      previousEventLogPage: command(
        () => {
          const local = localStateFor(address);
          local.eventLogPage = Math.max(0, local.eventLogPage - 1);
          return requestViewRefresh();
        },
        {
          description: 'Show the previous page of gateway event-log entries.',
        }
      ),

      nextEventLogPage: command(
        () => {
          const local = localStateFor(address);
          local.eventLogPage += 1;
          return requestViewRefresh();
        },
        {
          description: 'Show the next page of gateway event-log entries.',
        }
      ),
    };
  },
  cleanup: true,
});

const registerProviderHqSource = igniteCore({
  source: () => logisticsClient.actors.providerHq,
  view: ({ snapshot }) => {
    const providerContext = snapshot.context ?? createInitialProviderHqContext();
    const providerItem = providerContext.status.shipmentId
      ? providerContext.status.queue.find(
          (item) => item.shipmentId === providerContext.status.shipmentId
        )
      : undefined;
    return {
      providerTransportState: snapshot.transport.state,
      providerTransportReason: snapshot.transport.reason ?? null,
      providerMode: providerContext.status.mode,
      providerSourceLabel: providerContext.status.sourceLabel,
      providerShipmentId: providerContext.status.shipmentId,
      providerDestination: providerItem?.destination ?? null,
      providerReference: providerItem?.reference ?? null,
      providerShipmentStatus: providerContext.status.status,
      providerFacility: providerContext.status.facility,
      providerSignal: providerContext.status.signal,
      providerLoadId: providerContext.status.loadId,
      providerNote: providerContext.status.note,
      providerQueueCount: providerContext.status.queue.length,
    };
  },
  cleanup: true,
});

registerProviderHqSource(IGNITE_PROVIDER_HQ_SOURCE_ELEMENT_NAME, (view) => {
  return (
    <section class="panel">
      <style>{styles}</style>
      <div class="section-head">
        <h3>Remote Provider HQ</h3>
        <span class={`badge transport-${view.providerTransportState}`}>
          {view.providerTransportState}
        </span>
      </div>
      <div class="grid">
        <div>
          <div class="label">Mode</div>
          <div class="value">{view.providerMode}</div>
        </div>
        <div>
          <div class="label">Source</div>
          <div class="value">{view.providerSourceLabel}</div>
        </div>
        <div>
          <div class="label">Queue</div>
          <div class="value">{view.providerQueueCount}</div>
        </div>
        <div>
          <div class="label">Shipment</div>
          <div class="value">{view.providerShipmentId ?? 'waiting for shipment'}</div>
        </div>
        <div>
          <div class="label">Status</div>
          <div class="value">{view.providerShipmentStatus ?? 'none'}</div>
        </div>
        <div>
          <div class="label">Destination</div>
          <div class="value">{view.providerDestination ?? 'none'}</div>
        </div>
        <div>
          <div class="label">Reference</div>
          <div class="value">{view.providerReference ?? 'none'}</div>
        </div>
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
        <div>
          <div class="label">Transport Reason</div>
          <div class="value">{view.providerTransportReason ?? 'none'}</div>
        </div>
      </div>
      <a href="./provider.html">Open Provider HQ Console</a>
    </section>
  );
});

const registerRoutingSource = igniteCore({
  source: () => logisticsClient.actors.routing,
  view: ({ snapshot }) => {
    const routingContext = snapshot.context ?? createInitialShipmentContext();
    return {
      routingAddress: addressPath(snapshot.address),
      routingTransportState: snapshot.transport.state,
      routingTransportReason: snapshot.transport.reason ?? null,
      routingShipmentId: routingContext.shipmentId,
      routingCarrier: routingContext.carrier,
      routingEta: routingContext.eta,
      routingRouteNotes: routingContext.routeNotes,
    };
  },
  cleanup: true,
});

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

registerIgniteHeadlessHost(IGNITE_HEADLESS_HOST_ELEMENT_NAME, (view) => {
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
                    disabled={!view.canReset}
                    onClick={() => void view.resetShipment()}
                  >
                    Reset
                  </button>
                </div>
              </section>

              <aw-logistics-runtime-status-panel />

              <aw-logistics-provider-hq-source />
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
                    <span class="muted">Carrier, ETA, and route notes return to server actor.</span>
                  </div>
                  <div class="route-card tone-lifecycle">
                    <span class="runtime-chip">4 Dispatcher {'->'} Driver</span>
                    <strong>Driver assignment</strong>
                    <span class="muted">
                      Dispatcher records route and driver directory assigns a driver.
                    </span>
                  </div>
                  <div class="route-card tone-lifecycle">
                    <span class="runtime-chip">5 Shipment actor</span>
                    <strong>Shipped / delivered / returned</strong>
                    <span class="muted">
                      Per-shipment lifecycle actors own status and timeline.
                    </span>
                  </div>
                  <div class="route-card tone-provider">
                    <span class="runtime-chip">Provider HQ</span>
                    <strong>Label, truck, and exception scans</strong>
                    <span class="muted">
                      Provider HQ routes signals to per-shipment provider FSM actors.
                    </span>
                  </div>
                  <div class="route-card tone-server">
                    <span class="runtime-chip">6 Server {'->'} Browser</span>
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
                  <span class="muted">
                    Page {view.timelinePage + 1} of {view.timelinePageCount}
                  </span>
                </div>
                <ol class="list">
                  {view.visibleTimeline.length > 0 ? (
                    view.visibleTimeline.map((entry) => renderTimelineEntry(entry))
                  ) : (
                    <li class="item">
                      <span class="muted">No shipment activity yet.</span>
                    </li>
                  )}
                </ol>
                <div class="pager">
                  <button
                    type="button"
                    class="secondary"
                    disabled={!view.canGoToPreviousTimelinePage}
                    onClick={() => void view.previousTimelinePage()}
                  >
                    Previous
                  </button>
                  <span class="muted">{view.timelineTotal} total timeline entries</span>
                  <button
                    type="button"
                    class="secondary"
                    disabled={!view.canGoToNextTimelinePage}
                    onClick={() => void view.nextTimelinePage()}
                  >
                    Next
                  </button>
                </div>
              </section>

              <section class="panel">
                <div class="section-head">
                  <h3>Gateway Event Stream</h3>
                  <span class="muted">
                    Page {view.eventLogPage + 1} of {view.eventLogPageCount}
                  </span>
                </div>
                <ol class="list">
                  {view.visibleEventLog.length > 0 ? (
                    view.visibleEventLog.map((event) => renderEvent(event))
                  ) : (
                    <li class="item">
                      <span class="muted">No emitted events yet.</span>
                    </li>
                  )}
                </ol>
                <div class="pager">
                  <button
                    type="button"
                    class="secondary"
                    disabled={!view.canGoToPreviousEventLogPage}
                    onClick={() => void view.previousEventLogPage()}
                  >
                    Previous
                  </button>
                  <span class="muted">{view.eventLogTotal} total gateway events</span>
                  <button
                    type="button"
                    class="secondary"
                    disabled={!view.canGoToNextEventLogPage}
                    onClick={() => void view.nextEventLogPage()}
                  >
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
