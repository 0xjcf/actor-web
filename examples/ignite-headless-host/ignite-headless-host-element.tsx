/** @jsxImportSource ignite-element/jsx */

import 'ignite-element/renderers/ignite-jsx';

import { type ActorWebSourceHandle, igniteCore } from 'ignite-element/actor-web';
import type { LogisticsEventLog, LogisticsHostState } from './headless-host';
import {
  cloneTimeline,
  eventRuntime,
  projectEventLogItem,
  timelineRuntime,
} from './logistics-view-model';
import {
  createLogisticsTopologySources,
  type LogisticsRuntimeHarness,
  type ShipmentContext,
} from './runtime-harness';

export const IGNITE_HEADLESS_HOST_ELEMENT_NAME = 'aw-ignite-headless-host';

type LogisticsElementEvent =
  | { type: 'draft.destination'; value: string }
  | { type: 'draft.reference'; value: string }
  | { type: 'create' }
  | { type: 'create.quick'; destination: string; reference: string }
  | { type: 'timeline.next' }
  | { type: 'timeline.prev' }
  | { type: 'events.next' }
  | { type: 'events.prev' }
  | { type: 'reset' };

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

const PAGE_SIZE = 5;

function configuredRestUrl(): string | undefined {
  const configuredUrl = import.meta.env.VITE_ACTOR_WEB_REST_URL;
  return typeof configuredUrl === 'string' && configuredUrl.trim().length > 0
    ? configuredUrl.replace(/\/$/, '')
    : undefined;
}

const styles = `
  :host {
    display: block;
    color: #e5eef5;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  * { box-sizing: border-box; }
  button, input, code { font: inherit; }

  .shell {
    min-height: 100vh;
    padding: 32px;
    background:
      linear-gradient(180deg, rgba(15, 23, 32, 0.96), rgba(8, 12, 18, 0.98)),
      #081018;
  }

  .frame {
    width: min(1220px, 100%);
    margin: 0 auto;
    display: grid;
    gap: 24px;
  }

  .header {
    display: grid;
    gap: 20px;
    grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.9fr);
    align-items: start;
  }

  .eyebrow {
    margin: 0 0 10px;
    color: #5eead4;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  h1, h2, h3, p { margin: 0; }
  h1 { color: #f3f7fa; font-size: clamp(38px, 6vw, 64px); line-height: 1; }
  h2, h3 { color: #f3f7fa; font-size: 20px; line-height: 1.2; }

  .copy {
    max-width: 760px;
    margin-top: 16px;
    color: #9db0be;
    font-size: 17px;
    line-height: 1.55;
  }

  .summary, .panel {
    display: grid;
    gap: 16px;
    padding: 20px;
    border: 1px solid rgba(120, 142, 156, 0.18);
    border-radius: 8px;
    background: rgba(20, 27, 33, 0.84);
  }

  .grid {
    display: grid;
    gap: 14px 18px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .layout {
    display: grid;
    gap: 24px;
    grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
    align-items: start;
  }

  .stack { display: grid; gap: 24px; }
  .label {
    color: #7e95a5;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .value {
    margin-top: 6px;
    color: #f3f7fa;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  code {
    color: #cbe7f2;
    font-family:
      "SFMono-Regular", SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono",
      "Courier New", monospace;
    font-size: 13px;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    min-height: 28px;
    padding: 0 12px;
    border-radius: 999px;
    background: rgba(94, 234, 212, 0.13);
    color: #5eead4;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .status-idle { background: rgba(96, 165, 250, 0.14); color: #93c5fd; }
  .status-route-assigned, .status-delivered { background: rgba(16, 185, 129, 0.16); color: #34d399; }
  .status-route-requested, .status-in-transit { background: rgba(45, 212, 191, 0.14); color: #5eead4; }
  .status-returned { background: rgba(251, 146, 60, 0.16); color: #fb923c; }
  .status-busy { background: rgba(245, 158, 11, 0.16); color: #fbbf24; }
  .transport-disconnected, .transport-degraded { background: rgba(248, 113, 113, 0.16); color: #f87171; }

  .field { display: grid; gap: 8px; }
  .toolbar { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr) auto; }
  input {
    width: 100%;
    min-width: 0;
    height: 44px;
    padding: 0 14px;
    border: 1px solid rgba(120, 142, 156, 0.24);
    border-radius: 8px;
    background: rgba(10, 14, 18, 0.9);
    color: #f3f7fa;
    outline: none;
  }

  button {
    min-height: 42px;
    padding: 0 14px;
    border: 1px solid rgba(94, 234, 212, 0.22);
    border-radius: 8px;
    background: #0f766e;
    color: #eff7ff;
    cursor: pointer;
    font-weight: 600;
  }

  button.secondary { background: rgba(38, 48, 57, 0.96); border-color: rgba(120, 142, 156, 0.2); }
  button.danger { background: rgba(127, 29, 29, 0.22); border-color: rgba(248, 113, 113, 0.18); }
  button:disabled { cursor: wait; opacity: 0.56; }

  .quick-grid { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .list { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
  .item {
    display: grid;
    gap: 6px;
    padding: 12px 14px;
    border: 1px solid rgba(120, 142, 156, 0.14);
    border-radius: 8px;
    background: rgba(10, 14, 18, 0.72);
  }
  .event-item { border-left: 3px solid rgba(120, 142, 156, 0.32); }
  .tone-server { border-left-color: #2dd4bf; }
  .tone-worker { border-left-color: #60a5fa; }
  .tone-lifecycle { border-left-color: #f59e0b; }
  .tone-provider { border-left-color: #fb7185; }
  .tone-local { border-left-color: #a78bfa; }
  .item-heading {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .runtime-chip {
    display: inline-flex;
    min-height: 22px;
    align-items: center;
    padding: 0 8px;
    border-radius: 999px;
    background: rgba(120, 142, 156, 0.14);
    color: #cbe7f2;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .route-meta {
    display: grid;
    gap: 2px;
    color: #8da1af;
    font-size: 13px;
    line-height: 1.45;
  }
  .route-grid {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .route-card {
    display: grid;
    gap: 8px;
    min-height: 118px;
    padding: 12px 14px;
    border: 1px solid rgba(120, 142, 156, 0.14);
    border-left: 3px solid rgba(120, 142, 156, 0.32);
    border-radius: 8px;
    background: rgba(10, 14, 18, 0.72);
  }
  .section-head {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
  }
  .pager { display: flex; gap: 10px; align-items: center; justify-content: space-between; }
  .pager button { min-height: 34px; padding: 0 10px; }
  .muted { color: #8da1af; font-size: 13px; line-height: 1.45; }
  a { color: #5eead4; font-weight: 700; text-decoration: none; }

  @media (max-width: 900px) {
    .header, .layout, .grid, .toolbar, .quick-grid, .route-grid { grid-template-columns: 1fr; }
    .shell { padding: 18px; }
  }
`;

function cloneState(state: LogisticsElementState): LogisticsElementState {
  return {
    ...state,
    timeline: state.timeline.map((entry) => ({ ...entry })),
    eventLog: state.eventLog.map((event) => ({ ...event })),
  };
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

function projectElementState(
  context: ShipmentContext,
  source: LogisticsRuntimeHarness['source'],
  current?: LogisticsElementState
): LogisticsElementState {
  const transport = source.transportStatus();

  return {
    phase: context.status,
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
    eventLog: current?.eventLog ?? [],
    transportState: transport.state,
    transportReason: transport.reason ?? null,
    address: source.address.path,
    busy: current?.busy ?? false,
    draftDestination: current?.draftDestination ?? 'Chicago warehouse',
    draftReference: current?.draftReference ?? 'REF-1001',
    routingAddress: current?.routingAddress ?? null,
    routingTransportState: current?.routingTransportState ?? 'replaying',
    routingTransportReason: current?.routingTransportReason ?? null,
    routingShipmentId: current?.routingShipmentId ?? null,
    routingCarrier: current?.routingCarrier ?? null,
    routingEta: current?.routingEta ?? null,
    routingRouteNotes: current?.routingRouteNotes ?? null,
    timelinePage: current?.timelinePage ?? 0,
    eventPage: current?.eventPage ?? 0,
  };
}

function createLogisticsSnapshot(
  source: LogisticsRuntimeHarness['source'],
  state: LogisticsElementState
) {
  return {
    address: source.address,
    context: cloneState(state),
    phase: state.phase,
    toJSON: () => ({
      address: source.address,
      context: cloneState(state),
      phase: state.phase,
    }),
  };
}

function clampPage(page: number, itemCount: number): number {
  return Math.min(Math.max(0, Math.ceil(itemCount / PAGE_SIZE) - 1), Math.max(0, page));
}

function createLogisticsControlTowerViewSource(): ActorWebSourceHandle<
  LogisticsElementState,
  LogisticsElementEvent
> {
  const runtimeSources = createLogisticsTopologySources();
  const { source, routingSource } = runtimeSources;
  const listeners = new Set<(snapshot: ReturnType<typeof createLogisticsSnapshot>) => void>();
  let stopped = false;
  let state = projectElementState(source.snapshot().context, source);

  const notify = (): void => {
    if (stopped) {
      return;
    }
    const snapshot = cloneState(state);
    for (const listener of Array.from(listeners)) {
      listener(createLogisticsSnapshot(source, snapshot));
    }
  };

  const unsubscribeSnapshot = source.subscribe((snapshot) => {
    state = projectElementState(snapshot.context, source, state);
    notify();
  });

  const unsubscribeEvent = source.subscribeEvent(
    (event) => {
      state = {
        ...state,
        eventLog: [projectEventLogItem(event, source.address.id), ...state.eventLog],
      };
      notify();
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

  const unsubscribeTransportStatus = source.subscribeTransportStatus((status) => {
    state = {
      ...state,
      transportState: status.state,
      transportReason: status.reason ?? null,
    };
    notify();
  });

  let unsubscribeRoutingSnapshot = () => {};
  let unsubscribeRoutingTransportStatus = () => {};
  let unsubscribeRoutingEvent = () => {};

  if (routingSource) {
    const projectRoutingSource = (): void => {
      const snapshot = routingSource.snapshot();
      const status = routingSource.transportStatus();
      state = {
        ...state,
        routingAddress: routingSource.address.path,
        routingTransportState: status.state,
        routingTransportReason: status.reason ?? null,
        routingShipmentId: snapshot.context.shipmentId,
        routingCarrier: snapshot.context.carrier,
        routingEta: snapshot.context.eta,
        routingRouteNotes: snapshot.context.routeNotes,
      };
    };

    projectRoutingSource();

    unsubscribeRoutingSnapshot = routingSource.subscribe((snapshot) => {
      state = {
        ...state,
        routingAddress: routingSource.address.path,
        routingShipmentId: snapshot.context.shipmentId,
        routingCarrier: snapshot.context.carrier,
        routingEta: snapshot.context.eta,
        routingRouteNotes: snapshot.context.routeNotes,
      };
      notify();
    });

    unsubscribeRoutingTransportStatus = routingSource.subscribeTransportStatus((status) => {
      state = {
        ...state,
        routingAddress: routingSource.address.path,
        routingTransportState: status.state,
        routingTransportReason: status.reason ?? null,
      };
      notify();
    });

    unsubscribeRoutingEvent = routingSource.subscribeEvent(
      (event) => {
        state = {
          ...state,
          eventLog: [projectEventLogItem(event, routingSource.address.id), ...state.eventLog],
        };
        notify();
      },
      {
        types: ['ROUTE_ASSIGNED', 'SHIPMENT_RESET'],
      }
    );
  }

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    if (state.busy || stopped) {
      return;
    }
    state = { ...state, busy: true };
    notify();
    try {
      await action();
    } finally {
      state = { ...state, busy: false };
      notify();
    }
  };

  const createShipment = async (destination: string, reference?: string): Promise<void> => {
    const restUrl = configuredRestUrl();
    if (restUrl) {
      const response = await fetch(`${restUrl}/shipments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shipmentId: `shipment-${Date.now().toString(36)}`,
          destination,
          reference,
        }),
      });
      if (!response.ok) {
        throw new Error(`Shipment REST ingress failed with ${response.status}.`);
      }
      return;
    }

    await source.send({
      type: 'CREATE_SHIPMENT',
      shipmentId: `shipment-${Date.now().toString(36)}`,
      destination,
      reference,
    });
  };

  return {
    source: {
      address: source.address,
      snapshot() {
        return createLogisticsSnapshot(source, state);
      },
      subscribe(listener) {
        listeners.add(listener);
        listener(createLogisticsSnapshot(source, state));

        return () => {
          listeners.delete(listener);
        };
      },
      transportStatus: source.transportStatus.bind(source),
      subscribeTransportStatus: source.subscribeTransportStatus.bind(source),
      async send(event): Promise<void> {
        switch (event.type) {
          case 'draft.destination':
            state = { ...state, draftDestination: event.value };
            notify();
            return;
          case 'draft.reference':
            state = { ...state, draftReference: event.value };
            notify();
            return;
          case 'create':
            await run(async () => {
              const destination = state.draftDestination.trim();
              if (destination.length === 0) {
                return;
              }
              await createShipment(destination, state.draftReference.trim() || undefined);
            });
            return;
          case 'create.quick':
            state = {
              ...state,
              draftDestination: event.destination,
              draftReference: event.reference,
            };
            notify();
            await run(() => createShipment(event.destination, event.reference));
            return;
          case 'timeline.prev':
            state = { ...state, timelinePage: Math.max(0, state.timelinePage - 1) };
            notify();
            return;
          case 'timeline.next':
            state = {
              ...state,
              timelinePage: Math.min(
                Math.max(0, Math.ceil(state.timeline.length / PAGE_SIZE) - 1),
                state.timelinePage + 1
              ),
            };
            notify();
            return;
          case 'events.prev':
            state = { ...state, eventPage: Math.max(0, state.eventPage - 1) };
            notify();
            return;
          case 'events.next':
            state = {
              ...state,
              eventPage: Math.min(
                Math.max(0, Math.ceil(state.eventLog.length / PAGE_SIZE) - 1),
                state.eventPage + 1
              ),
            };
            notify();
            return;
          case 'reset':
            await run(() => source.send({ type: 'RESET_SHIPMENT' }));
            return;
        }
      },
    },
    async stop(): Promise<void> {
      stopped = true;
      unsubscribeRoutingEvent();
      unsubscribeRoutingTransportStatus();
      unsubscribeRoutingSnapshot();
      unsubscribeTransportStatus();
      unsubscribeEvent();
      unsubscribeSnapshot();
      listeners.clear();
      await runtimeSources.destroy();
    },
  };
}

const registerIgniteHeadlessHost = igniteCore<LogisticsElementState, LogisticsElementEvent>({
  source: createLogisticsControlTowerViewSource,
  cleanup: true,
});

export function defineIgniteHeadlessHostElement(): void {
  if (customElements.get(IGNITE_HEADLESS_HOST_ELEMENT_NAME)) {
    return;
  }

  registerIgniteHeadlessHost(IGNITE_HEADLESS_HOST_ELEMENT_NAME, ({ state, send }) => {
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
                          send({
                            type: 'draft.destination',
                            value: (event.currentTarget as HTMLInputElement).value,
                          })
                        }
                      />
                      <button
                        type="button"
                        id="create-shipment"
                        disabled={!canCreate}
                        onClick={() => send({ type: 'create' })}
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
                        send({
                          type: 'draft.reference',
                          value: (event.currentTarget as HTMLInputElement).value,
                        })
                      }
                    />
                  </label>
                  <div class="quick-grid">
                    <button
                      type="button"
                      class="secondary"
                      disabled={state.busy}
                      onClick={() =>
                        send({
                          type: 'create.quick',
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
                      disabled={state.busy}
                      onClick={() =>
                        send({
                          type: 'create.quick',
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
                      onClick={() => send({ type: 'reset' })}
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
                      onClick={() => send({ type: 'timeline.prev' })}
                    >
                      Previous
                    </button>
                    <span class="muted">{state.timeline.length} total timeline entries</span>
                    <button
                      type="button"
                      class="secondary"
                      disabled={timelinePage + 1 >= timelinePageCount}
                      onClick={() => send({ type: 'timeline.next' })}
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
                      onClick={() => send({ type: 'events.prev' })}
                    >
                      Previous
                    </button>
                    <span class="muted">{state.eventLog.length} total gateway events</span>
                    <button
                      type="button"
                      class="secondary"
                      disabled={eventPage + 1 >= eventPageCount}
                      onClick={() => send({ type: 'events.next' })}
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
