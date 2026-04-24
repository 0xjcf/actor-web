/** @jsxImportSource ignite-element/jsx */

import 'ignite-element/renderers/ignite-jsx';

import { type ActorWebExtendedState, createActorWebAdapter } from 'ignite-adapters/actor-web';
import { igniteElementFactory, StateScope } from 'ignite-element';
import type { LogisticsEventLog, LogisticsHostState } from './headless-host';
import {
  createLogisticsRuntimeHarness,
  type ShipmentCommand,
  type ShipmentContext,
  type ShipmentEvent,
} from './runtime-harness';

export const IGNITE_HEADLESS_HOST_ELEMENT_NAME = 'aw-ignite-headless-host';

type LogisticsElementEvent =
  | { type: 'draft.destination'; value: string }
  | { type: 'draft.reference'; value: string }
  | { type: 'create' }
  | { type: 'create.quick'; destination: string; reference: string }
  | { type: 'reset' };

interface LogisticsElementState extends LogisticsHostState {
  address: string;
  busy: boolean;
  draftDestination: string;
  draftReference: string;
}

type LogisticsActorState = ActorWebExtendedState<ShipmentContext>;
type LogisticsCommandActor = ReturnType<typeof createBaseLogisticsAdapter.resolveCommandActor>;
type TransportAwareActor = {
  transportStatus?: () => { state: LogisticsHostState['transportState']; reason?: string };
  subscribeTransportStatus?: (
    listener: (status: { state: LogisticsHostState['transportState']; reason?: string }) => void
  ) => () => void;
};

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
  .muted { color: #8da1af; font-size: 13px; line-height: 1.45; }

  @media (max-width: 900px) {
    .header, .layout, .grid, .toolbar, .quick-grid { grid-template-columns: 1fr; }
    .shell { padding: 18px; }
  }
`;

const createBaseLogisticsAdapter = createActorWebAdapter<
  ShipmentContext,
  ShipmentCommand,
  ShipmentEvent
>(() => {
  const harness = createLogisticsRuntimeHarness();
  return {
    source: harness.source,
    stop: () => harness.destroy(),
  };
});

function cloneState(state: LogisticsElementState): LogisticsElementState {
  return {
    ...state,
    timeline: state.timeline.map((entry) => ({ ...entry })),
    eventLog: state.eventLog.map((event) => ({ ...event })),
  };
}

function renderEvent(event: LogisticsEventLog) {
  return (
    <li class="item">
      <strong>{event.type}</strong>
      <span class="muted">
        Actor {event.actorId}
        {event.shipmentId ? ` / ${event.shipmentId}` : ''}
      </span>
    </li>
  );
}

function projectElementState(
  actorState: LogisticsActorState,
  current?: LogisticsElementState
): LogisticsElementState {
  return {
    phase: actorState.phase,
    shipmentId: actorState.shipmentId,
    destination: actorState.destination,
    reference: actorState.reference,
    status: actorState.status,
    carrier: actorState.carrier,
    eta: actorState.eta,
    routeNotes: actorState.routeNotes,
    shipmentCount: actorState.shipmentCount,
    timeline: actorState.timeline.map((entry) => ({ ...entry })),
    eventLog: current?.eventLog ?? [],
    transportState: current?.transportState ?? 'replaying',
    transportReason: current?.transportReason ?? null,
    address: actorState.address.path,
    busy: current?.busy ?? false,
    draftDestination: current?.draftDestination ?? 'Chicago warehouse',
    draftReference: current?.draftReference ?? 'REF-1001',
  };
}

function createLogisticsAdapter() {
  const actorAdapter = createBaseLogisticsAdapter();
  const actor = createBaseLogisticsAdapter.resolveCommandActor(
    actorAdapter
  ) as LogisticsCommandActor & TransportAwareActor;
  const listeners = new Set<(state: LogisticsElementState) => void>();
  let stopped = false;
  let state = projectElementState(actorAdapter.getState());

  const notify = (): void => {
    if (stopped) {
      return;
    }
    const snapshot = cloneState(state);
    for (const listener of Array.from(listeners)) {
      listener(snapshot);
    }
  };

  const unsubscribeSnapshot = actorAdapter.subscribe((nextState) => {
    state = projectElementState(nextState, state);
    notify();
  });

  const unsubscribeEvent = actor.subscribeEvent
    ? actor.subscribeEvent(
        (event) => {
          state = {
            ...state,
            eventLog: [
              {
                type: event.type,
                shipmentId: 'shipmentId' in event ? event.shipmentId : null,
                actorId: actor.address.id,
              },
              ...state.eventLog,
            ].slice(0, 10),
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
            'SHIPMENT_RESET',
          ],
        }
      )
    : () => {};

  const unsubscribeTransportStatus =
    typeof actor.subscribeTransportStatus === 'function'
      ? actor.subscribeTransportStatus((status) => {
          state = {
            ...state,
            transportState: status.state,
            transportReason: status.reason ?? null,
          };
          notify();
        })
      : () => {};

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

    await actor.send({
      type: 'CREATE_SHIPMENT',
      shipmentId: `shipment-${Date.now().toString(36)}`,
      destination,
      reference,
    });
  };

  return {
    scope: StateScope.Isolated,
    subscribe(listener: (nextState: LogisticsElementState) => void) {
      listeners.add(listener);
      listener(cloneState(state));
      return {
        unsubscribe: () => {
          listeners.delete(listener);
        },
      };
    },
    send(event: LogisticsElementEvent): void {
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
          void run(async () => {
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
          void run(() => createShipment(event.destination, event.reference));
          return;
        case 'reset':
          void run(() => actor.send({ type: 'RESET_SHIPMENT' }));
          return;
      }
    },
    getState(): LogisticsElementState {
      return cloneState(state);
    },
    stop(): void {
      stopped = true;
      unsubscribeTransportStatus();
      unsubscribeEvent();
      unsubscribeSnapshot.unsubscribe();
      listeners.clear();
      actorAdapter.stop();
    },
  };
}

const registerIgniteHeadlessHost = igniteElementFactory<
  LogisticsElementState,
  LogisticsElementEvent
>(createLogisticsAdapter, { scope: StateScope.Isolated });

export function defineIgniteHeadlessHostElement(): void {
  if (customElements.get(IGNITE_HEADLESS_HOST_ELEMENT_NAME)) {
    return;
  }

  registerIgniteHeadlessHost(IGNITE_HEADLESS_HOST_ELEMENT_NAME, ({ state, send }) => {
    const canCreate = !state.busy && state.draftDestination.trim().length > 0;
    const canReset = !state.busy && (state.shipmentCount > 0 || state.eventLog.length > 0);
    const statusClass = state.busy ? 'badge status-busy' : `badge status-${state.status}`;
    const transportClass = `badge transport-${state.transportState}`;

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
                    <li class="item">
                      <strong>Browser Host</strong>
                      <span class="muted">Ignite thin projection host</span>
                    </li>
                    <li class="item">
                      <strong>Server Runtime</strong>
                      <span class="muted">REST, gateway, shipment actor</span>
                    </li>
                    <li class="item">
                      <strong>WebWorker Runtime</strong>
                      <span class="muted">Routing actor over Actor-Web transport</span>
                    </li>
                    <li class="item">
                      <strong>Service Worker Runtime</strong>
                      <span class="muted">Browser-local MessagePort topology proof</span>
                    </li>
                  </ul>
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
                  <h3>Message Routes</h3>
                  <ul class="list">
                    <li class="item">
                      <strong>REST browser/client {'->'} server runtime</strong>
                      <span class="muted">POST /shipments accepts command ingress</span>
                    </li>
                    <li class="item">
                      <strong>WS gateway server runtime {'->'} browser host</strong>
                      <span class="muted">Snapshots, events, status, replies</span>
                    </li>
                    <li class="item">
                      <strong>Actor-Web server runtime {'->'} worker runtime</strong>
                      <span class="muted">PLAN_ROUTE ask over MessageTransport</span>
                    </li>
                    <li class="item">
                      <strong>Actor-Web worker runtime {'->'} server runtime</strong>
                      <span class="muted">Route plan reply</span>
                    </li>
                    <li class="item">
                      <strong>Server runtime {'->'} gateway subscribers</strong>
                      <span class="muted">Lifecycle updates: in transit, delivered, returned</span>
                    </li>
                    <li class="item">
                      <strong>MessagePort browser host {'<->'} service worker runtime</strong>
                      <span class="muted">Browser-local topology proof</span>
                    </li>
                  </ul>
                </section>

                <section class="panel">
                  <h3>Timeline</h3>
                  <ol class="list">
                    {state.timeline.length > 0 ? (
                      state.timeline.map((entry) => (
                        <li class="item">
                          <strong>{entry.label}</strong>
                          <span class="muted">{entry.detail}</span>
                        </li>
                      ))
                    ) : (
                      <li class="item">
                        <span class="muted">No shipment activity yet.</span>
                      </li>
                    )}
                  </ol>
                </section>

                <section class="panel">
                  <h3>Gateway Event Stream</h3>
                  <ol class="list">
                    {state.eventLog.length > 0 ? (
                      state.eventLog.map((event) => renderEvent(event))
                    ) : (
                      <li class="item">
                        <span class="muted">No emitted events yet.</span>
                      </li>
                    )}
                  </ol>
                </section>
              </div>
            </section>
          </div>
        </main>
      </>
    );
  });
}
