/** @jsxImportSource ignite-element/jsx */

import 'ignite-element/renderers/ignite-jsx';

import { type ActorWebSourceHandle, igniteCore } from 'ignite-element/actor-web';
import type { LogisticsEventLog, LogisticsHostState } from './headless-host';
import styles from './ignite-headless-host-element.css?raw';
import {
  cloneTimeline,
  eventRuntime,
  projectEventLogItem,
  timelineRuntime,
} from './logistics-view-model';
import {
  createLogisticsTopologySources,
  type ShipmentCommand,
  type ShipmentContext,
  type ShipmentEvent,
} from './runtime-harness';

export const IGNITE_HEADLESS_HOST_ELEMENT_NAME = 'aw-ignite-headless-host';

interface LogisticsElementState extends LogisticsHostState {
  address: string;
  busy: boolean;
  draftDestination: string;
  draftReference: string;
  routingAddress: string | null;
  routingTransportState: LogisticsHostState['transportState'];
  routingTransportReason: string | null;
  routingShipmentId: string | null;
  routingCarrier: string | null;
  routingEta: string | null;
  routingRouteNotes: string | null;
  timelinePage: number;
  eventPage: number;
}

interface LogisticsControlTowerViewState extends LogisticsElementState {
  createShipment(destination?: string, reference?: string): void;
  updateDraftDestination(value: string): void;
  updateDraftReference(value: string): void;
  resetShipment(): void;
  nextTimelinePage(): void;
  previousTimelinePage(): void;
  nextEventPage(): void;
  previousEventPage(): void;
}

interface LogisticsElementLocalState {
  busy: boolean;
  draftDestination: string;
  draftReference: string;
  eventLog: LogisticsEventLog[];
  timelinePage: number;
  eventPage: number;
}

const PAGE_SIZE = 5;
const localStateByAddress = new Map<string, LogisticsElementLocalState>();
const eventSubscriptionsByHost = new WeakSet<HTMLElement>();

function configuredRestUrl(): string | undefined {
  const configuredUrl = import.meta.env.VITE_ACTOR_WEB_REST_URL;
  return typeof configuredUrl === 'string' && configuredUrl.trim().length > 0
    ? configuredUrl.replace(/\/$/, '')
    : undefined;
}

function renderEvent(event: LogisticsEventLog) {
  const runtime = eventRuntime(event.type);
  return (
    <li class={`item event-item ${runtime.tone}`}>
      <div class="item-heading">
        <span class="runtime-chip">{runtime.source}</span>
        <strong>{event.type}</strong>
      </div>
      <div class="route-meta">
        <span>{runtime.via}</span>
        <span>
          Actor {event.actorId}
          {event.shipmentId ? ` / ${event.shipmentId}` : ''}
        </span>
      </div>
    </li>
  );
}

function renderTimelineEntry(entry: ShipmentContext['timeline'][number]) {
  const runtime = timelineRuntime(entry.label);
  return (
    <li class={`item event-item ${runtime.tone}`}>
      <div class="item-heading">
        <span class="runtime-chip">{runtime.source}</span>
        <strong>{entry.label}</strong>
      </div>
      <div class="route-meta">
        <span>{entry.channel ?? runtime.via}</span>
        <span>{entry.detail}</span>
        {entry.facility ? <span>Facility {entry.facility}</span> : null}
        {entry.loadId ? <span>Load {entry.loadId}</span> : null}
        {entry.note ? <span>{entry.note}</span> : null}
      </div>
    </li>
  );
}

function clampPage(page: number, itemCount: number): number {
  return Math.min(Math.max(0, Math.ceil(itemCount / PAGE_SIZE) - 1), Math.max(0, page));
}

function localStateFor(address: string): LogisticsElementLocalState {
  let state = localStateByAddress.get(address);
  if (!state) {
    state = {
      busy: false,
      draftDestination: 'Chicago warehouse',
      draftReference: 'REF-1001',
      eventLog: [],
      timelinePage: 0,
      eventPage: 0,
    };
    localStateByAddress.set(address, state);
  }

  return state;
}

function createShipmentSourceHandle(): ActorWebSourceHandle<
  ShipmentContext,
  ShipmentCommand,
  ShipmentEvent
> {
  const runtimeSources = createLogisticsTopologySources();

  return {
    source: runtimeSources.source,
    stop: runtimeSources.destroy,
  };
}

function forceRender(host: HTMLElement): void {
  (host as HTMLElement & { forceRender?: () => void }).forceRender?.();
}

async function createShipment(
  actor: { send(message: ShipmentCommand): Promise<unknown> },
  destination: string,
  reference?: string
): Promise<void> {
  const restUrl = configuredRestUrl();
  const shipmentId = `shipment-${Date.now().toString(36)}`;
  if (restUrl) {
    const response = await fetch(`${restUrl}/shipments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId,
        destination,
        reference,
      }),
    });
    if (!response.ok) {
      throw new Error(`Shipment REST ingress failed with ${response.status}.`);
    }
    return;
  }

  await actor.send({
    type: 'CREATE_SHIPMENT',
    shipmentId,
    destination,
    reference,
  });
}

const registerIgniteHeadlessHost = igniteCore({
  source: createShipmentSourceHandle,
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
      timeline: cloneTimeline(context.timeline),
      eventLog: local.eventLog,
      transportState: transport.state,
      transportReason: transport.reason ?? null,
      address: address.path,
      routingAddress: null,
      routingTransportState: 'connected' as LogisticsHostState['transportState'],
      routingTransportReason: null,
      routingShipmentId: context.shipmentId,
      routingCarrier: context.carrier,
      routingEta: context.eta,
      routingRouteNotes: context.routeNotes,
      busy: local.busy,
      draftDestination: local.draftDestination,
      draftReference: local.draftReference,
      timelinePage: local.timelinePage,
      eventPage: local.eventPage,
    } satisfies LogisticsElementState;
  },
  commands: ({ actor, host }) => {
    const address = actor.address.path;
    const local = localStateFor(address);

    if (!eventSubscriptionsByHost.has(host)) {
      eventSubscriptionsByHost.add(host);
      actor.subscribeEvent?.(
        (event) => {
          const nextLocal = localStateFor(address);
          nextLocal.eventLog = [
            projectEventLogItem(event, actor.address.id),
            ...nextLocal.eventLog,
          ];
          forceRender(host);
        },
        {
          types: [
            'SHIPMENT_CREATED',
            'ROUTE_REQUESTED',
            'ROUTE_ASSIGNED',
            'SHIPMENT_IN_TRANSIT',
            'SHIPMENT_DELIVERED',
            'SHIPMENT_RETURNED',
            'PROVIDER_SIGNAL_RECORDED',
            'SHIPMENT_RESET',
          ],
        }
      );
    }

    const run = async (action: () => Promise<unknown>): Promise<void> => {
      if (local.busy) {
        return;
      }
      local.busy = true;
      forceRender(host);
      try {
        await action();
      } finally {
        local.busy = false;
        forceRender(host);
      }
    };

    return {
      updateDraftDestination(value: string): void {
        local.draftDestination = value;
        forceRender(host);
      },
      updateDraftReference(value: string): void {
        local.draftReference = value;
        forceRender(host);
      },
      createShipment(destination = local.draftDestination, reference = local.draftReference): void {
        const trimmedDestination = destination.trim();
        if (trimmedDestination.length === 0) {
          return;
        }
        local.draftDestination = destination;
        local.draftReference = reference;
        void run(() => createShipment(actor, trimmedDestination, reference.trim() || undefined));
      },
      resetShipment(): void {
        void run(() => actor.send({ type: 'RESET_SHIPMENT' }));
      },
      previousTimelinePage(): void {
        local.timelinePage = Math.max(0, local.timelinePage - 1);
        forceRender(host);
      },
      nextTimelinePage(): void {
        const itemCount = actor.snapshot().context.timeline.length;
        local.timelinePage = Math.min(
          Math.max(0, Math.ceil(itemCount / PAGE_SIZE) - 1),
          local.timelinePage + 1
        );
        forceRender(host);
      },
      previousEventPage(): void {
        local.eventPage = Math.max(0, local.eventPage - 1);
        forceRender(host);
      },
      nextEventPage(): void {
        local.eventPage = Math.min(
          Math.max(0, Math.ceil(local.eventLog.length / PAGE_SIZE) - 1),
          local.eventPage + 1
        );
        forceRender(host);
      },
    };
  },
  cleanup: true,
});

export function defineIgniteHeadlessHostElement(): void {
  if (customElements.get(IGNITE_HEADLESS_HOST_ELEMENT_NAME)) {
    return;
  }

  registerIgniteHeadlessHost(IGNITE_HEADLESS_HOST_ELEMENT_NAME, (args) => {
    const state = args as unknown as LogisticsControlTowerViewState;
    const canCreate = !state.busy && state.draftDestination.trim().length > 0;
    const canReset = !state.busy && (state.shipmentCount > 0 || state.eventLog.length > 0);
    const statusClass = state.busy ? 'badge status-busy' : `badge status-${state.status}`;
    const transportClass = `badge transport-${state.transportState}`;
    const timelinePage = clampPage(state.timelinePage, state.timeline.length);
    const timelinePageCount = Math.max(1, Math.ceil(state.timeline.length / PAGE_SIZE));
    const visibleTimeline = state.timeline.slice(
      timelinePage * PAGE_SIZE,
      timelinePage * PAGE_SIZE + PAGE_SIZE
    );
    const eventPage = clampPage(state.eventPage, state.eventLog.length);
    const eventPageCount = Math.max(1, Math.ceil(state.eventLog.length / PAGE_SIZE));
    const visibleEvents = state.eventLog.slice(
      eventPage * PAGE_SIZE,
      eventPage * PAGE_SIZE + PAGE_SIZE
    );

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
                      <span class={statusClass}>{state.busy ? 'dispatching' : state.status}</span>
                    </div>
                  </div>
                  <div>
                    <div class="label">Shipments</div>
                    <div class="value">{state.shipmentCount}</div>
                  </div>
                  <div>
                    <div class="label">Transport</div>
                    <div class="value">
                      <span class={transportClass}>{state.transportState}</span>
                    </div>
                  </div>
                  <div>
                    <div class="label">Actor</div>
                    <div class="value">
                      <code>{state.address}</code>
                    </div>
                  </div>
                </div>
              </section>
            </header>

            <section class="layout">
              <aside class="stack">
                <section class="panel">
                  <h2>Create Shipment</h2>
                  <label class="field">
                    <span class="label">Destination</span>
                    <div class="toolbar">
                      <input
                        value={state.draftDestination}
                        placeholder="Chicago warehouse"
                        disabled={state.busy}
                        onInput={(event: Event) =>
                          state.updateDraftDestination(
                            (event.currentTarget as HTMLInputElement).value
                          )
                        }
                      />
                      <button
                        type="button"
                        id="create-shipment"
                        disabled={!canCreate}
                        onClick={() => state.createShipment()}
                      >
                        Create
                      </button>
                    </div>
                  </label>
                  <label class="field">
                    <span class="label">Reference</span>
                    <input
                      value={state.draftReference}
                      placeholder="REF-1001"
                      disabled={state.busy}
                      onInput={(event: Event) =>
                        state.updateDraftReference((event.currentTarget as HTMLInputElement).value)
                      }
                    />
                  </label>
                  <div class="quick-grid">
                    <button
                      type="button"
                      class="secondary"
                      disabled={state.busy}
                      onClick={() => state.createShipment('Dallas cross-dock', 'REF-2002')}
                    >
                      Dallas
                    </button>
                    <button
                      type="button"
                      class="secondary"
                      disabled={state.busy}
                      onClick={() => state.createShipment('International hub', 'REF-3003')}
                    >
                      International
                    </button>
                    <button
                      type="button"
                      class="danger"
                      disabled={!canReset}
                      onClick={() => state.resetShipment()}
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
                      <div class="value">{state.providerFacility ?? 'waiting for scan'}</div>
                    </div>
                    <div>
                      <div class="label">Signal</div>
                      <div class="value">{state.providerSignal ?? 'none'}</div>
                    </div>
                    <div>
                      <div class="label">Truck Load</div>
                      <div class="value">{state.providerLoadId ?? 'unassigned'}</div>
                    </div>
                    <div>
                      <div class="label">Provider Note</div>
                      <div class="value">{state.providerNote ?? 'No provider update yet.'}</div>
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
                      <div class="value">{state.shipmentId ?? 'none'}</div>
                    </div>
                    <div>
                      <div class="label">Destination</div>
                      <div class="value">{state.destination ?? 'none'}</div>
                    </div>
                    <div>
                      <div class="label">Carrier</div>
                      <div class="value">{state.carrier ?? 'pending'}</div>
                    </div>
                    <div>
                      <div class="label">ETA</div>
                      <div class="value">{state.eta ?? 'pending'}</div>
                    </div>
                    <div>
                      <div class="label">Route Notes</div>
                      <div class="value">{state.routeNotes ?? 'pending route plan'}</div>
                    </div>
                    <div>
                      <div class="label">Transport Reason</div>
                      <div class="value">{state.transportReason ?? 'none'}</div>
                    </div>
                  </div>
                </section>

                <section class="panel">
                  <div class="section-head">
                    <h3>Worker Routing Source</h3>
                    <span class={`badge transport-${state.routingTransportState}`}>
                      {state.routingTransportState}
                    </span>
                  </div>
                  <div class="grid">
                    <div>
                      <div class="label">Actor</div>
                      <div class="value">
                        <code>{state.routingAddress ?? 'not connected'}</code>
                      </div>
                    </div>
                    <div>
                      <div class="label">Shipment</div>
                      <div class="value">{state.routingShipmentId ?? 'no route requested'}</div>
                    </div>
                    <div>
                      <div class="label">Carrier</div>
                      <div class="value">{state.routingCarrier ?? 'pending worker plan'}</div>
                    </div>
                    <div>
                      <div class="label">ETA</div>
                      <div class="value">{state.routingEta ?? 'pending'}</div>
                    </div>
                    <div>
                      <div class="label">Route Notes</div>
                      <div class="value">
                        {state.routingRouteNotes ?? 'worker-owned actor source'}
                      </div>
                    </div>
                    <div>
                      <div class="label">Transport Reason</div>
                      <div class="value">{state.routingTransportReason ?? 'none'}</div>
                    </div>
                  </div>
                </section>

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
                    <span class="muted">
                      Page {timelinePage + 1} of {timelinePageCount}
                    </span>
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
                    <button
                      type="button"
                      class="secondary"
                      disabled={timelinePage === 0}
                      onClick={() => state.previousTimelinePage()}
                    >
                      Previous
                    </button>
                    <span class="muted">{state.timeline.length} total timeline entries</span>
                    <button
                      type="button"
                      class="secondary"
                      disabled={timelinePage + 1 >= timelinePageCount}
                      onClick={() => state.nextTimelinePage()}
                    >
                      Next
                    </button>
                  </div>
                </section>

                <section class="panel">
                  <div class="section-head">
                    <h3>Gateway Event Stream</h3>
                    <span class="muted">
                      Page {eventPage + 1} of {eventPageCount}
                    </span>
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
                    <button
                      type="button"
                      class="secondary"
                      disabled={eventPage === 0}
                      onClick={() => state.previousEventPage()}
                    >
                      Previous
                    </button>
                    <span class="muted">{state.eventLog.length} total gateway events</span>
                    <button
                      type="button"
                      class="secondary"
                      disabled={eventPage + 1 >= eventPageCount}
                      onClick={() => state.nextEventPage()}
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
}
