/** @jsxImportSource ignite-element/jsx */

import 'ignite-element/renderers/ignite-jsx';

import { type ActorWebExtendedState, createActorWebAdapter } from 'ignite-adapters/actor-web';
import { igniteElementFactory, StateScope } from 'ignite-element';
import type { HeadlessCheckoutEventLog, HeadlessCheckoutHostState } from './headless-host';
import {
  type CheckoutCommand,
  type CheckoutContext,
  type CheckoutEvent,
  createCheckoutRuntimeHarness,
} from './runtime-harness';

export const IGNITE_HEADLESS_HOST_ELEMENT_NAME = 'aw-ignite-headless-host';

type CheckoutElementEvent =
  | { type: 'draft.change'; value: string }
  | { type: 'submit' }
  | { type: 'submit.quick'; orderId: string }
  | { type: 'reset' };

interface CheckoutElementState extends HeadlessCheckoutHostState {
  address: string;
  busy: boolean;
  draftOrderId: string;
}

type CheckoutActorState = ActorWebExtendedState<CheckoutContext>;
type CheckoutCommandActor = ReturnType<typeof createBaseCheckoutAdapter.resolveCommandActor>;
type TransportAwareActor = {
  transportStatus?: () => { state: HeadlessCheckoutHostState['transportState']; reason?: string };
  subscribeTransportStatus?: (
    listener: (status: {
      state: HeadlessCheckoutHostState['transportState'];
      reason?: string;
    }) => void
  ) => () => void;
};

const checkoutExampleStyles = `
  :host {
    display: block;
    color: #e5eef5;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  * {
    box-sizing: border-box;
  }

  button,
  input,
  code,
  pre {
    font: inherit;
  }

  .runtime-shell {
    min-height: 100vh;
    padding: 32px;
    background:
      linear-gradient(180deg, rgba(18, 24, 29, 0.94) 0%, rgba(11, 15, 20, 0.98) 100%),
      #0b0f14;
  }

  .runtime-frame {
    width: min(1180px, 100%);
    margin: 0 auto;
    display: grid;
    gap: 24px;
  }

  .runtime-header {
    display: grid;
    gap: 20px;
    grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.9fr);
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

  .runtime-header h1 {
    margin: 0;
    color: #f3f7fa;
    font-size: clamp(38px, 6vw, 64px);
    line-height: 1;
  }

  .runtime-copy {
    max-width: 760px;
    margin: 16px 0 0;
    color: #9db0be;
    font-size: 18px;
    line-height: 1.55;
  }

  .runtime-summary {
    display: grid;
    gap: 12px;
    padding: 18px 20px;
    border: 1px solid rgba(120, 142, 156, 0.22);
    border-radius: 8px;
    background: rgba(23, 31, 38, 0.82);
  }

  .summary-label {
    color: #7e95a5;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .summary-grid {
    display: grid;
    gap: 14px 18px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .summary-value {
    margin-top: 6px;
    color: #f3f7fa;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.4;
  }

  .summary-value code {
    display: inline-block;
    max-width: 100%;
    overflow-wrap: anywhere;
    color: #cbe7f2;
    font-family:
      "SFMono-Regular", SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono",
      "Courier New", monospace;
    font-size: 13px;
  }

  .phase-badge {
    display: inline-flex;
    align-items: center;
    min-height: 28px;
    padding: 0 12px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .phase-ready {
    background: rgba(245, 158, 11, 0.16);
    color: #fbbf24;
  }

  .phase-submitted {
    background: rgba(16, 185, 129, 0.16);
    color: #34d399;
  }

  .phase-busy {
    background: rgba(45, 212, 191, 0.16);
    color: #5eead4;
  }

  .transport-chip {
    display: inline-flex;
    align-items: center;
    min-height: 28px;
    padding: 0 12px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .transport-connected {
    background: rgba(16, 185, 129, 0.16);
    color: #34d399;
  }

  .transport-local {
    background: rgba(96, 165, 250, 0.14);
    color: #93c5fd;
  }

  .transport-replaying {
    background: rgba(45, 212, 191, 0.14);
    color: #5eead4;
  }

  .transport-degraded {
    background: rgba(245, 158, 11, 0.16);
    color: #fbbf24;
  }

  .transport-disconnected {
    background: rgba(248, 113, 113, 0.16);
    color: #f87171;
  }

  .runtime-layout {
    display: grid;
    gap: 24px;
    grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
    align-items: start;
  }

  .panel {
    display: grid;
    gap: 18px;
    padding: 20px;
    border: 1px solid rgba(120, 142, 156, 0.18);
    border-radius: 8px;
    background: rgba(20, 27, 33, 0.84);
  }

  .panel-header {
    display: grid;
    gap: 6px;
  }

  .panel-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .panel h2,
  .panel h3 {
    margin: 0;
    color: #f3f7fa;
    font-size: 20px;
    line-height: 1.2;
  }

  .panel-copy {
    margin: 0;
    color: #8da1af;
    font-size: 14px;
    line-height: 1.5;
  }

  .panel-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    height: 28px;
    padding: 0 10px;
    border-radius: 999px;
    background: rgba(94, 234, 212, 0.12);
    color: #5eead4;
    font-size: 12px;
    font-weight: 700;
  }

  .command-stack,
  .content-stack {
    display: grid;
    gap: 24px;
  }

  .field-label {
    color: #8da1af;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .command-group {
    display: grid;
    gap: 12px;
  }

  .toolbar {
    display: grid;
    gap: 10px;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .toolbar input {
    width: 100%;
    min-width: 0;
    height: 46px;
    padding: 0 14px;
    border: 1px solid rgba(120, 142, 156, 0.24);
    border-radius: 8px;
    background: rgba(10, 14, 18, 0.9);
    color: #f3f7fa;
    outline: none;
  }

  .toolbar input:focus {
    border-color: rgba(94, 234, 212, 0.72);
    box-shadow: 0 0 0 3px rgba(45, 212, 191, 0.14);
  }

  .button-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 42px;
    padding: 0 14px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: rgba(37, 99, 235, 0.18);
    color: #eff7ff;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    transition:
      background 120ms ease,
      border-color 120ms ease,
      color 120ms ease,
      transform 120ms ease;
  }

  .button:hover:enabled {
    transform: translateY(-1px);
  }

  .button:disabled {
    cursor: wait;
    opacity: 0.56;
    transform: none;
  }

  .button-primary {
    background: #0f766e;
    border-color: rgba(94, 234, 212, 0.22);
  }

  .button-primary:hover:enabled {
    background: #0d9488;
  }

  .button-secondary {
    background: rgba(38, 48, 57, 0.96);
    border-color: rgba(120, 142, 156, 0.2);
    color: #dbe7ef;
  }

  .button-secondary:hover:enabled {
    background: rgba(50, 63, 74, 0.96);
  }

  .button-danger {
    background: rgba(127, 29, 29, 0.22);
    border-color: rgba(248, 113, 113, 0.18);
    color: #fecaca;
  }

  .button-danger:hover:enabled {
    background: rgba(153, 27, 27, 0.32);
  }

  .quick-grid {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .helper-line {
    margin: 0;
    color: #708796;
    font-size: 13px;
    line-height: 1.5;
  }

  .state-grid {
    display: grid;
    gap: 12px 20px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .state-cell {
    min-width: 0;
    padding-bottom: 12px;
    border-bottom: 1px solid rgba(120, 142, 156, 0.12);
  }

  .state-cell:last-child,
  .state-cell:nth-last-child(2):nth-child(odd) {
    border-bottom: 0;
    padding-bottom: 0;
  }

  .state-cell dt {
    margin: 0 0 8px;
    color: #7e95a5;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .state-cell dd {
    margin: 0;
    color: #f3f7fa;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .state-cell code {
    color: #cbe7f2;
    font-family:
      "SFMono-Regular", SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono",
      "Courier New", monospace;
    font-size: 13px;
  }

  .order-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .order-chip {
    display: inline-flex;
    align-items: center;
    min-height: 28px;
    padding: 0 10px;
    border-radius: 999px;
    background: rgba(94, 234, 212, 0.1);
    color: #bff7ed;
    font-size: 12px;
    font-weight: 600;
  }

  .empty-value {
    color: #7e95a5;
    font-weight: 500;
  }

  .event-list {
    display: grid;
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .event-item {
    display: grid;
    gap: 8px;
    padding: 14px 16px;
    border: 1px solid rgba(120, 142, 156, 0.14);
    border-radius: 8px;
    background: rgba(10, 14, 18, 0.72);
  }

  .event-item strong {
    color: #f3f7fa;
    font-size: 14px;
    line-height: 1.35;
  }

  .event-meta {
    display: grid;
    gap: 4px;
    color: #a7bac7;
    font-size: 13px;
    line-height: 1.45;
  }

  .muted {
    color: #6f8797;
  }

  .code-note {
    margin: 0;
    padding: 14px 16px;
    border: 1px solid rgba(120, 142, 156, 0.16);
    border-radius: 8px;
    background: rgba(8, 12, 16, 0.92);
    color: #cbe7f2;
    font-family:
      "SFMono-Regular", SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono",
      "Courier New", monospace;
    font-size: 12px;
    line-height: 1.6;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  @media (max-width: 980px) {
    .runtime-shell {
      padding: 22px;
    }

    .runtime-header,
    .runtime-layout {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 720px) {
    .runtime-shell {
      padding: 16px;
    }

    .runtime-header h1 {
      font-size: clamp(34px, 11vw, 48px);
    }

    .runtime-copy {
      font-size: 16px;
    }

    .summary-grid,
    .state-grid,
    .toolbar,
    .quick-grid {
      grid-template-columns: 1fr;
    }
  }
`;

const createBaseCheckoutAdapter = createActorWebAdapter<
  CheckoutContext,
  CheckoutCommand,
  CheckoutEvent
>(() => {
  const harness = createCheckoutRuntimeHarness();

  return {
    source: harness.source,
    stop: () => harness.destroy(),
  };
});

function cloneState(state: CheckoutElementState): CheckoutElementState {
  return {
    ...state,
    submittedOrders: [...state.submittedOrders],
    eventLog: state.eventLog.map((event) => ({ ...event })),
  };
}

function renderEvent(event: HeadlessCheckoutEventLog) {
  return (
    <li class="event-item">
      <strong>{event.type}</strong>
      <div class="event-meta">
        <div>
          <span class="muted">Actor:</span> {event.actorId}
        </div>
        <div>
          {event.orderId ? (
            <>
              <span class="muted">Order:</span> {event.orderId}
            </>
          ) : (
            'Reset'
          )}
        </div>
      </div>
    </li>
  );
}

function projectElementState(
  actorState: CheckoutActorState,
  current?: CheckoutElementState
): CheckoutElementState {
  return {
    phase: actorState.phase,
    submittedOrders: [...actorState.submittedOrders],
    lastSubmittedOrderId: actorState.lastSubmittedOrderId,
    eventLog: current?.eventLog ?? [],
    transportState: current?.transportState ?? 'replaying',
    transportReason: current?.transportReason ?? null,
    address: actorState.address.path,
    busy: current?.busy ?? false,
    draftOrderId: current?.draftOrderId ?? 'order-1001',
  };
}

function createCheckoutAdapter() {
  const actorAdapter = createBaseCheckoutAdapter();
  const actor = createBaseCheckoutAdapter.resolveCommandActor(
    actorAdapter
  ) as CheckoutCommandActor & TransportAwareActor;
  const listeners = new Set<(state: CheckoutElementState) => void>();
  let stopped = false;
  let state = projectElementState(actorAdapter.getState());

  if (typeof actor.transportStatus === 'function') {
    const status = actor.transportStatus();
    state = {
      ...state,
      transportState: status.state,
      transportReason: status.reason ?? null,
    };
  }

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
                orderId: 'orderId' in event ? event.orderId : null,
                actorId: actor.address.id,
              },
              ...state.eventLog,
            ].slice(0, 8),
          };
          notify();
        },
        { types: ['CHECKOUT_SUBMITTED', 'CHECKOUT_RESET'] }
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

    state = {
      ...state,
      busy: true,
    };
    notify();

    try {
      await action();
    } finally {
      state = {
        ...state,
        busy: false,
      };
      notify();
    }
  };

  return {
    scope: StateScope.Isolated,
    subscribe(listener: (nextState: CheckoutElementState) => void) {
      listeners.add(listener);
      listener(cloneState(state));

      return {
        unsubscribe: () => {
          listeners.delete(listener);
        },
      };
    },
    send(event: CheckoutElementEvent): void {
      switch (event.type) {
        case 'draft.change':
          state = {
            ...state,
            draftOrderId: event.value,
          };
          notify();
          return;
        case 'submit':
          void run(async () => {
            const orderId = state.draftOrderId.trim();
            if (orderId.length === 0) {
              return;
            }

            await actor.send({
              type: 'SUBMIT',
              orderId,
            });
          });
          return;
        case 'submit.quick':
          state = {
            ...state,
            draftOrderId: event.orderId,
          };
          notify();
          void run(() =>
            actor.send({
              type: 'SUBMIT',
              orderId: event.orderId,
            })
          );
          return;
        case 'reset':
          void run(() => actor.send({ type: 'RESET' }));
          return;
      }
    },
    getState(): CheckoutElementState {
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

const registerIgniteHeadlessHost = igniteElementFactory<CheckoutElementState, CheckoutElementEvent>(
  createCheckoutAdapter,
  {
    scope: StateScope.Isolated,
  }
);

export function defineIgniteHeadlessHostElement(): void {
  if (customElements.get(IGNITE_HEADLESS_HOST_ELEMENT_NAME)) {
    return;
  }

  registerIgniteHeadlessHost(
    IGNITE_HEADLESS_HOST_ELEMENT_NAME,
    ({
      state,
      send,
    }: {
      state: CheckoutElementState;
      send: (event: CheckoutElementEvent) => void;
    }) => {
      const latestEvent = state.eventLog[0]?.type ?? 'none';
      const submittedCount = state.submittedOrders.length;
      const canSubmit = !state.busy && state.draftOrderId.trim().length > 0;
      const canReset = !state.busy && (submittedCount > 0 || state.eventLog.length > 0);
      const phaseClass = state.busy
        ? 'phase-badge phase-busy'
        : `phase-badge ${state.phase === 'submitted' ? 'phase-submitted' : 'phase-ready'}`;
      const transportClass = `transport-chip transport-${state.transportState}`;

      return (
        <>
          <style>{checkoutExampleStyles}</style>
          <main class="runtime-shell">
            <div class="runtime-frame">
              <header class="runtime-header">
                <div>
                  <p class="eyebrow">Ignite Headless Host</p>
                  <h1>Snapshot + Event Bridge</h1>
                  <p class="runtime-copy">
                    Actor-Web snapshots and emitted events rendered through Ignite with the shared{' '}
                    <code>ignite-adapters/actor-web</code> seam. This demo runs the remote runtime
                    inside a service worker so the UI and actor owner live in different browser
                    contexts.
                  </p>
                </div>

                <section class="runtime-summary">
                  <div class="summary-grid">
                    <div>
                      <div class="summary-label">Status</div>
                      <div class="summary-value">
                        <span class={phaseClass}>{state.busy ? 'dispatching' : state.phase}</span>
                      </div>
                    </div>
                    <div>
                      <div class="summary-label">Submitted</div>
                      <div class="summary-value">{submittedCount}</div>
                    </div>
                    <div>
                      <div class="summary-label">Last Event</div>
                      <div class="summary-value">{latestEvent}</div>
                    </div>
                    <div>
                      <div class="summary-label">Transport</div>
                      <div class="summary-value">
                        <span class={transportClass}>{state.transportState}</span>
                      </div>
                    </div>
                    <div>
                      <div class="summary-label">Address</div>
                      <div class="summary-value">
                        <code>{state.address}</code>
                      </div>
                    </div>
                  </div>
                </section>
              </header>

              <section class="runtime-layout">
                <aside class="command-stack">
                  <section class="panel">
                    <div class="panel-header">
                      <h2>Commands</h2>
                      <p class="panel-copy">Dispatch typed messages against the host actor.</p>
                    </div>

                    <label class="command-group">
                      <span class="field-label">Order ID</span>
                      <div class="toolbar">
                        <input
                          name="order-id"
                          value={state.draftOrderId}
                          placeholder="order-1001"
                          disabled={state.busy}
                          onInput={(event: Event) =>
                            send({
                              type: 'draft.change',
                              value: (event.currentTarget as HTMLInputElement).value,
                            })
                          }
                        />
                        <button
                          class="button button-primary"
                          id="submit-order"
                          type="button"
                          disabled={!canSubmit}
                          onClick={() => send({ type: 'submit' })}
                        >
                          Submit
                        </button>
                      </div>
                    </label>

                    <div class="quick-grid">
                      <button
                        class="button button-secondary"
                        type="button"
                        disabled={state.busy}
                        onClick={() => send({ type: 'submit.quick', orderId: 'order-2002' })}
                      >
                        Order 2002
                      </button>
                      <button
                        class="button button-secondary"
                        type="button"
                        disabled={state.busy}
                        onClick={() => send({ type: 'submit.quick', orderId: 'order-3003' })}
                      >
                        Order 3003
                      </button>
                      <button
                        class="button button-danger"
                        id="reset-orders"
                        type="button"
                        disabled={!canReset}
                        onClick={() => send({ type: 'reset' })}
                      >
                        Reset
                      </button>
                    </div>

                    <p class="helper-line">
                      Public runtime source: <code>@actor-core/runtime/browser</code>
                    </p>
                  </section>
                </aside>

                <div class="content-stack">
                  <section class="panel">
                    <div class="panel-header">
                      <div class="panel-title-row">
                        <h3>Projected Host State</h3>
                        <span class="panel-badge">{submittedCount}</span>
                      </div>
                    </div>

                    <dl class="state-grid">
                      <div class="state-cell">
                        <dt>Phase</dt>
                        <dd>
                          <span class={phaseClass}>{state.busy ? 'dispatching' : state.phase}</span>
                        </dd>
                      </div>

                      <div class="state-cell">
                        <dt>Last Submitted</dt>
                        <dd class={state.lastSubmittedOrderId ? '' : 'empty-value'}>
                          {state.lastSubmittedOrderId ?? 'none'}
                        </dd>
                      </div>

                      <div class="state-cell">
                        <dt>Submitted Orders</dt>
                        <dd>
                          {submittedCount > 0 ? (
                            <div class="order-list">
                              {state.submittedOrders.map((orderId) => (
                                <span class="order-chip">{orderId}</span>
                              ))}
                            </div>
                          ) : (
                            <span class="empty-value">none</span>
                          )}
                        </dd>
                      </div>

                      <div class="state-cell">
                        <dt>Transport</dt>
                        <dd>
                          <span class={transportClass}>{state.transportState}</span>
                          {state.transportReason ? (
                            <div class="helper-line">{state.transportReason}</div>
                          ) : null}
                        </dd>
                      </div>

                      <div class="state-cell">
                        <dt>Actor Path</dt>
                        <dd>
                          <code>{state.address}</code>
                        </dd>
                      </div>
                    </dl>
                  </section>

                  <section class="panel">
                    <div class="panel-header">
                      <div class="panel-title-row">
                        <h3>Emitted Event Log</h3>
                        <span class="panel-badge">{state.eventLog.length}</span>
                      </div>
                    </div>

                    <ol class="event-list">
                      {state.eventLog.length > 0 ? (
                        state.eventLog.map((event: HeadlessCheckoutEventLog) => renderEvent(event))
                      ) : (
                        <li class="event-item">
                          <div class="event-meta">No emitted events yet.</div>
                        </li>
                      )}
                    </ol>
                  </section>

                  <section class="panel">
                    <div class="panel-header">
                      <h3>Runtime Ownership</h3>
                      <p class="panel-copy">
                        The element is the client-side host. The remote actor runtime is owned by a
                        service worker in this demo. Production hosts usually consume the same
                        source from a server or worker-owned runtime.
                      </p>
                    </div>

                    <pre class="code-note">{`await navigator.serviceWorker.register("./ignite-headless-host.sw.js", {
  type: "module",
  scope: "./",
});

const remoteRef = await localSystem.lookup<CheckoutContext, CheckoutCommand>(
  "actor://node-b/actor/checkout"
);
const remoteSource = createIgniteActorSource(remoteRef);

remoteSource.subscribeTransportStatus((status) => {
  console.log(status.state);
});

// Local refs report "local" because there is no remote projection hop.
const localSource = createIgniteActorSource(localCheckoutRef);
console.log(localSource.transportStatus().state); // "local"

// Explicit overrides stay available for foreign transports or non-Actor-Web runtimes.
createIgniteActorSource(foreignRemoteRef, {
  getSnapshot: () => remoteSnapshotCache.read(),
  subscribeSnapshot: (listener) => remoteSnapshotStream.subscribe(listener),
  subscribeEvent: (listener, options) =>
    remoteEventStream.subscribe((event) => {
      if (!options?.types?.length || options.types.includes(event.type)) {
        listener(event);
      }
    }),
});`}</pre>
                  </section>
                </div>
              </section>
            </div>
          </main>
        </>
      );
    }
  );
}
