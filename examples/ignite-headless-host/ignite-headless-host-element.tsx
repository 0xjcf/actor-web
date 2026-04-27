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
const IGNITE_ROUTING_SOURCE_ELEMENT_NAME = 'aw-logistics-routing-source';

interface LogisticsElementState extends LogisticsHostState {
  address: string;
}

interface LogisticsElementLocalState {
  eventLog: LogisticsEventLog[];
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

function createRoutingSourceHandle(): ActorWebSourceHandle<
  ShipmentContext,
  ShipmentCommand,
  ShipmentEvent
> {
  const runtimeSources = createLogisticsTopologySources();

  return {
    source: runtimeSources.routingSource ?? runtimeSources.source,
    stop: runtimeSources.destroy,
  };
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
    } satisfies LogisticsElementState;
  },
  commands: ({ actor, host }) => {
    const address = actor.address.path;

    if (!eventSubscriptionsByHost.has(host)) {
      eventSubscriptionsByHost.add(host);
      actor.subscribeEvent?.(
        (event) => {
          const nextLocal = localStateFor(address);
          nextLocal.eventLog = [
            projectEventLogItem(event, actor.address.id),
            ...nextLocal.eventLog,
          ];
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

    const readInputValue = (selector: string): string => {
      return host.shadowRoot?.querySelector<HTMLInputElement>(selector)?.value ?? '';
    };

    return {
      createShipment(): void {
        const destination = readInputValue('#shipment-destination');
        const reference = readInputValue('#shipment-reference');
        const trimmedDestination = destination.trim();
        if (trimmedDestination.length === 0) {
          return;
        }
        void createShipment(actor, trimmedDestination, reference.trim() || undefined);
      },
      createQuickShipment(destination: string, reference: string): void {
        const destinationInput =
          host.shadowRoot?.querySelector<HTMLInputElement>('#shipment-destination');
        const referenceInput =
          host.shadowRoot?.querySelector<HTMLInputElement>('#shipment-reference');
        if (destinationInput) {
          destinationInput.value = destination;
        }
        if (referenceInput) {
          referenceInput.value = reference;
        }
        void createShipment(actor, destination, reference);
      },
      resetShipment(): void {
        void actor.send({ type: 'RESET_SHIPMENT' });
      },
    };
  },
  cleanup: true,
});

const registerRoutingSource = igniteCore({
  source: createRoutingSourceHandle,
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

  registerRoutingSource(IGNITE_ROUTING_SOURCE_ELEMENT_NAME, (args) => {
    const view = args;

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

  registerIgniteHeadlessHost(IGNITE_HEADLESS_HOST_ELEMENT_NAME, (args) => {
    const view = args;
    const canReset = view.shipmentCount > 0 || view.eventLog.length > 0;
    const statusClass = `badge status-${view.status}`;
    const transportClass = `badge transport-${view.transportState}`;
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
                      <span class={statusClass}>{view.status}</span>
                    </div>
                  </div>
                  <div>
                    <div class="label">Shipments</div>
                    <div class="value">{view.shipmentCount}</div>
                  </div>
                  <div>
                    <div class="label">Transport</div>
                    <div class="value">
                      <span class={transportClass}>{view.transportState}</span>
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
                  <label class="field">
                    <span class="label">Destination</span>
                    <div class="toolbar">
                      <input
                        id="shipment-destination"
                        value="Chicago warehouse"
                        placeholder="Chicago warehouse"
                      />
                      <button
                        type="button"
                        id="create-shipment"
                        onClick={() => view.createShipment()}
                      >
                        Create
                      </button>
                    </div>
                  </label>
                  <label class="field">
                    <span class="label">Reference</span>
                    <input id="shipment-reference" value="REF-1001" placeholder="REF-1001" />
                  </label>
                  <div class="quick-grid">
                    <button
                      type="button"
                      class="secondary"
                      onClick={() => view.createQuickShipment('Dallas cross-dock', 'REF-2002')}
                    >
                      Dallas
                    </button>
                    <button
                      type="button"
                      class="secondary"
                      onClick={() => view.createQuickShipment('International hub', 'REF-3003')}
                    >
                      International
                    </button>
                    <button
                      type="button"
                      class="danger"
                      disabled={!canReset}
                      onClick={() => view.resetShipment()}
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
