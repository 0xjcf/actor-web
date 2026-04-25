/** @jsxImportSource ignite-element/jsx */
/// <reference types="vite/client" />

import 'ignite-element/renderers/ignite-jsx';

import { igniteElementFactory, StateScope } from 'ignite-element';
import type { ProviderSignal, ShipmentStatus } from './logistics-contract';

export const PROVIDER_CONSOLE_ELEMENT_NAME = 'aw-provider-console';

type ProviderConsoleEvent =
  | { type: 'refresh' }
  | { type: 'mode'; mode: 'simulation' | 'manual' }
  | { type: 'queue.select'; shipmentId: string }
  | { type: 'queue.next' }
  | { type: 'queue.prev' }
  | { type: 'signal'; signal: ProviderSignal; note: string };

interface ProviderQueueItem {
  shipmentId: string;
  destination: string | null;
  reference: string | null;
  status: ShipmentStatus;
  facility: string;
  signal: ProviderSignal | null;
  loadId: string;
  note: string | null;
  updatedAt: number;
}

interface ProviderStatus {
  mode: 'simulation' | 'manual' | 'unknown';
  shipmentId: string | null;
  status: ShipmentStatus | null;
  facility: string | null;
  signal: ProviderSignal | null;
  loadId: string | null;
  note: string | null;
  queue: ProviderQueueItem[];
}

interface ProviderConsoleState {
  restUrl: string | null;
  status: ProviderStatus;
  selectedShipmentId: string | null;
  queuePage: number;
  busy: boolean;
  message: string;
}

const PAGE_SIZE = 5;

function isTerminalShipment(status: ShipmentStatus | null | undefined): boolean {
  return status === 'delivered' || status === 'returned';
}

const signals: Array<{ signal: ProviderSignal; label: string; note: string }> = [
  {
    signal: 'LABEL_SCANNED',
    label: 'Scan Label',
    note: 'Label barcode matched shipment manifest.',
  },
  {
    signal: 'PACKED_INTO_TRUCK',
    label: 'Pack Truck',
    note: 'Shipment was packed into the assigned truck load.',
  },
  {
    signal: 'OUTBOUND_SCAN',
    label: 'Outbound Scan',
    note: 'Carrier accepted handoff and outbound scan was recorded.',
  },
  {
    signal: 'DELIVERY_CONFIRMED',
    label: 'Confirm Delivery',
    note: 'Destination dock confirmed delivery.',
  },
  {
    signal: 'RETURN_EXCEPTION',
    label: 'Report Return',
    note: 'Return exception triggered by address validation hold.',
  },
];

const styles = `
  :host {
    display: block;
    min-height: 100vh;
    padding: 32px;
    color: #e5eef5;
    background:
      linear-gradient(180deg, rgba(15, 23, 32, 0.96), rgba(8, 12, 18, 0.98)),
      #081018;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  main { width: min(920px, 100%); margin: 0 auto; display: grid; gap: 24px; }
  h1, h2, p { margin: 0; }
  h1 { color: #f8fafc; font-size: clamp(36px, 6vw, 64px); line-height: 1; }
  h2 { color: #f8fafc; font-size: 20px; }
  .eyebrow {
    color: #fb7185;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .copy { color: #9db0be; font-size: 17px; line-height: 1.55; }
  .panel {
    display: grid;
    gap: 16px;
    padding: 20px;
    border: 1px solid rgba(120, 142, 156, 0.18);
    border-radius: 8px;
    background: rgba(20, 27, 33, 0.84);
  }
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .metric {
    display: grid;
    gap: 6px;
    padding: 12px 14px;
    border: 1px solid rgba(120, 142, 156, 0.14);
    border-radius: 8px;
    background: rgba(10, 14, 18, 0.72);
  }
  .label {
    color: #7e95a5;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .value { color: #f3f7fa; font-weight: 700; overflow-wrap: anywhere; }
  .actions { display: grid; gap: 10px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .mode-toggle { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .queue-item {
    display: grid;
    gap: 8px;
    padding: 12px 14px;
    border: 1px solid rgba(120, 142, 156, 0.14);
    border-radius: 8px;
    background: rgba(10, 14, 18, 0.72);
  }
  .queue-item.active {
    border-color: rgba(94, 234, 212, 0.74);
    background: rgba(15, 118, 110, 0.2);
    box-shadow: inset 3px 0 0 rgba(94, 234, 212, 0.72);
  }
  .queue-state {
    display: inline-flex;
    align-items: center;
    min-height: 36px;
    padding: 0 12px;
    border: 1px solid rgba(120, 142, 156, 0.18);
    border-radius: 8px;
    color: #9db0be;
    background: rgba(38, 48, 57, 0.72);
    font-size: 13px;
    font-weight: 800;
    text-transform: uppercase;
  }
  .queue-head { display: flex; gap: 10px; align-items: center; justify-content: space-between; }
  .queue-meta { color: #8da1af; font-size: 13px; line-height: 1.45; }
  .selection-banner {
    display: grid;
    gap: 4px;
    padding: 12px 14px;
    border: 1px solid rgba(94, 234, 212, 0.26);
    border-radius: 8px;
    background: rgba(15, 118, 110, 0.16);
  }
  .pager { display: flex; gap: 10px; align-items: center; justify-content: space-between; }
  button {
    min-height: 48px;
    padding: 0 14px;
    border: 1px solid rgba(251, 113, 133, 0.22);
    border-radius: 8px;
    background: rgba(190, 18, 60, 0.58);
    color: #fff1f2;
    cursor: pointer;
    font: inherit;
    font-weight: 800;
  }
  button.secondary { background: rgba(38, 48, 57, 0.96); border-color: rgba(120, 142, 156, 0.2); }
  button.active { background: #0f766e; border-color: rgba(94, 234, 212, 0.42); }
  button:disabled { cursor: wait; opacity: 0.56; }
  a { color: #5eead4; font-weight: 800; text-decoration: none; }
  @media (max-width: 760px) { :host { padding: 18px; } .grid, .actions { grid-template-columns: 1fr; } }
`;

function configuredRestUrl(): string | undefined {
  const configuredUrl = import.meta.env.VITE_ACTOR_WEB_REST_URL;
  return typeof configuredUrl === 'string' && configuredUrl.trim().length > 0
    ? configuredUrl.replace(/\/$/, '')
    : undefined;
}

function emptyStatus(): ProviderStatus {
  return {
    mode: 'unknown',
    shipmentId: null,
    status: null,
    facility: null,
    signal: null,
    loadId: null,
    note: null,
    queue: [],
  };
}

function createProviderConsoleAdapter() {
  const restUrl = configuredRestUrl() ?? null;
  const listeners = new Set<(state: ProviderConsoleState) => void>();
  let state: ProviderConsoleState = {
    restUrl,
    status: emptyStatus(),
    selectedShipmentId: null,
    queuePage: 0,
    busy: false,
    message: restUrl
      ? 'Provider console ready.'
      : 'Start with pnpm examples:logistics to enable provider REST controls.',
  };

  const clone = (): ProviderConsoleState => ({
    ...state,
    status: {
      ...state.status,
      queue: state.status.queue.map((item) => ({ ...item })),
    },
  });

  const notify = (): void => {
    const snapshot = clone();
    for (const listener of Array.from(listeners)) {
      listener(snapshot);
    }
  };

  const preserveSelected = (
    status: ProviderStatus,
    selectedShipmentId: string | null
  ): string | null => {
    if (
      selectedShipmentId &&
      status.queue.some(
        (item) => item.shipmentId === selectedShipmentId && !isTerminalShipment(item.status)
      )
    ) {
      return selectedShipmentId;
    }

    return null;
  };

  const refresh = async (): Promise<void> => {
    if (!restUrl) {
      return;
    }

    const response = await fetch(`${restUrl}/provider/status`);
    const status = (await response.json()) as ProviderStatus;
    state = {
      ...state,
      status,
      selectedShipmentId: preserveSelected(status, state.selectedShipmentId),
      queuePage: Math.min(
        state.queuePage,
        Math.max(0, Math.ceil(status.queue.length / PAGE_SIZE) - 1)
      ),
      message: 'Provider status refreshed.',
    };
    notify();
  };

  const setMode = async (mode: 'simulation' | 'manual'): Promise<void> => {
    if (!restUrl || state.busy) {
      return;
    }

    state = { ...state, busy: true, message: `Switching provider mode to ${mode}.` };
    notify();

    try {
      const response = await fetch(`${restUrl}/provider/mode`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const body = (await response.json()) as ProviderStatus & { error?: string };
      state = {
        ...state,
        status: response.ok ? body : state.status,
        selectedShipmentId: response.ok ? preserveSelected(body, state.selectedShipmentId) : null,
        message: response.ok ? `Provider mode set to ${mode}.` : String(body.error),
      };
    } finally {
      state = { ...state, busy: false };
      notify();
    }
  };

  const sendSignal = async (signal: ProviderSignal, note: string): Promise<void> => {
    if (!restUrl || state.busy || !state.selectedShipmentId) {
      return;
    }

    state = { ...state, busy: true, message: `Sending ${signal}` };
    notify();

    try {
      const response = await fetch(`${restUrl}/provider/signals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shipmentId: state.selectedShipmentId, signal, note }),
      });
      const body = (await response.json()) as ProviderStatus & { error?: string };
      state = {
        ...state,
        status: response.ok ? body : state.status,
        selectedShipmentId: response.ok
          ? preserveSelected(body, state.selectedShipmentId)
          : state.selectedShipmentId,
        message: response.ok ? `${signal} accepted by server runtime.` : String(body.error),
      };
    } finally {
      state = { ...state, busy: false };
      notify();
    }
  };

  const refreshTimer = window.setInterval(() => {
    void refresh();
  }, 2_000);

  void refresh();

  return {
    scope: StateScope.Isolated,
    subscribe(listener: (nextState: ProviderConsoleState) => void) {
      listeners.add(listener);
      listener(clone());
      return {
        unsubscribe: () => {
          listeners.delete(listener);
        },
      };
    },
    send(event: ProviderConsoleEvent): void {
      if (event.type === 'refresh') {
        void refresh();
        return;
      }

      if (event.type === 'mode') {
        void setMode(event.mode);
        return;
      }

      if (event.type === 'queue.select') {
        const selected = state.status.queue.find((item) => item.shipmentId === event.shipmentId);
        if (isTerminalShipment(selected?.status)) {
          state = {
            ...state,
            selectedShipmentId: null,
            message: `${event.shipmentId} is complete and no longer needs provider processing.`,
          };
          notify();
          return;
        }

        state = {
          ...state,
          selectedShipmentId: event.shipmentId,
          message: `Selected ${event.shipmentId} for provider processing.`,
        };
        notify();
        return;
      }

      if (event.type === 'queue.prev') {
        state = { ...state, queuePage: Math.max(0, state.queuePage - 1) };
        notify();
        return;
      }

      if (event.type === 'queue.next') {
        state = {
          ...state,
          queuePage: Math.min(
            Math.max(0, Math.ceil(state.status.queue.length / PAGE_SIZE) - 1),
            state.queuePage + 1
          ),
        };
        notify();
        return;
      }

      void sendSignal(event.signal, event.note);
    },
    getState(): ProviderConsoleState {
      return clone();
    },
    stop(): void {
      window.clearInterval(refreshTimer);
      listeners.clear();
    },
  };
}

const registerProviderConsole = igniteElementFactory<ProviderConsoleState, ProviderConsoleEvent>(
  createProviderConsoleAdapter,
  { scope: StateScope.Isolated }
);

export function defineProviderConsoleElement(): void {
  if (customElements.get(PROVIDER_CONSOLE_ELEMENT_NAME)) {
    return;
  }

  registerProviderConsole(PROVIDER_CONSOLE_ELEMENT_NAME, ({ state, send }) => {
    const queuePageCount = Math.max(1, Math.ceil(state.status.queue.length / PAGE_SIZE));
    const visibleQueue = state.status.queue.slice(
      state.queuePage * PAGE_SIZE,
      state.queuePage * PAGE_SIZE + PAGE_SIZE
    );
    const selectedItem = state.status.queue.find(
      (item) => item.shipmentId === state.selectedShipmentId
    );
    const selectedIsTerminal = isTerminalShipment(selectedItem?.status);

    return (
      <>
        <style>{styles}</style>
        <main>
          <header>
            <p class="eyebrow">Remote Provider HQ</p>
            <h1>Provider scan console</h1>
            <p class="copy">
              Manually send label, truck, outbound, delivery, and return signals to the server
              runtime. The control tower stays updated through the gateway WebSocket.
            </p>
          </header>

          <section class="panel">
            <h2>Operating Mode</h2>
            <div class="mode-toggle">
              <button
                type="button"
                class={state.status.mode === 'simulation' ? 'active' : 'secondary'}
                disabled={state.busy || !state.restUrl}
                onClick={() => send({ type: 'mode', mode: 'simulation' })}
              >
                Live Simulation
              </button>
              <button
                type="button"
                class={state.status.mode === 'manual' ? 'active' : 'secondary'}
                disabled={state.busy || !state.restUrl}
                onClick={() => send({ type: 'mode', mode: 'manual' })}
              >
                Manual Provider
              </button>
            </div>
            <p class="copy">
              Simulation lets the server advance shipments. Manual mode lets this provider console
              process the queue one shipment at a time.
            </p>
          </section>

          <section class="panel">
            <h2>Provider Queue</h2>
            <div class="selection-banner">
              <span class="label">Selected Shipment</span>
              <strong>
                {selectedItem?.shipmentId ?? state.selectedShipmentId ?? 'none selected'}
              </strong>
              <span class="queue-meta">
                {selectedItem
                  ? `${selectedItem.destination ?? 'destination pending'} / ${selectedItem.status}`
                  : 'Select a queued shipment before sending provider signals.'}
              </span>
            </div>
            {visibleQueue.length > 0 ? (
              visibleQueue.map((item) => {
                const isTerminal = isTerminalShipment(item.status);
                const isSelected =
                  item.shipmentId === state.selectedShipmentId && !isTerminalShipment(item.status);

                return (
                  <article class={`queue-item ${isSelected ? 'active' : ''}`}>
                    <div class="queue-head">
                      <strong>{item.shipmentId}</strong>
                      {isTerminal ? (
                        <span class="queue-state">{item.status}</span>
                      ) : (
                        <button
                          type="button"
                          class={isSelected ? 'active' : 'secondary'}
                          disabled={state.busy}
                          onClick={() =>
                            send({ type: 'queue.select', shipmentId: item.shipmentId })
                          }
                        >
                          {isSelected ? 'Selected' : 'Select'}
                        </button>
                      )}
                    </div>
                    <div class="queue-meta">
                      <div>{item.destination ?? 'destination pending'}</div>
                      <div>
                        {item.reference ?? 'no reference'} / {item.status}
                      </div>
                      <div>
                        {item.signal ?? 'awaiting provider scan'} / {item.loadId}
                      </div>
                    </div>
                  </article>
                );
              })
            ) : (
              <div class="queue-item">
                <span class="queue-meta">No shipments are waiting at provider HQ.</span>
              </div>
            )}
            <div class="pager">
              <button
                type="button"
                class="secondary"
                disabled={state.queuePage === 0}
                onClick={() => send({ type: 'queue.prev' })}
              >
                Previous
              </button>
              <span class="queue-meta">
                Page {state.queuePage + 1} of {queuePageCount}
              </span>
              <button
                type="button"
                class="secondary"
                disabled={state.queuePage + 1 >= queuePageCount}
                onClick={() => send({ type: 'queue.next' })}
              >
                Next
              </button>
            </div>
          </section>

          <section class="panel">
            <h2>Current Shipment</h2>
            <div class="grid">
              <div class="metric">
                <span class="label">Lifecycle Mode</span>
                <span class="value">{state.status.mode}</span>
              </div>
              <div class="metric">
                <span class="label">Shipment</span>
                <span class="value">{selectedItem?.shipmentId ?? 'select from queue'}</span>
              </div>
              <div class="metric">
                <span class="label">Status</span>
                <span class="value">{selectedItem?.status ?? 'none selected'}</span>
              </div>
              <div class="metric">
                <span class="label">Facility</span>
                <span class="value">{selectedItem?.facility ?? 'select a shipment first'}</span>
              </div>
              <div class="metric">
                <span class="label">Latest Signal</span>
                <span class="value">{selectedItem?.signal ?? 'none selected'}</span>
              </div>
              <div class="metric">
                <span class="label">Truck Load</span>
                <span class="value">{selectedItem?.loadId ?? 'select a shipment first'}</span>
              </div>
            </div>
          </section>

          <section class="panel">
            <h2>Provider Signals</h2>
            <div class="actions">
              {signals.map((entry) => (
                <button
                  type="button"
                  disabled={
                    state.busy || !state.restUrl || !state.selectedShipmentId || selectedIsTerminal
                  }
                  onClick={() => send({ type: 'signal', signal: entry.signal, note: entry.note })}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <p class="copy">{selectedItem?.note ?? state.status.note ?? state.message}</p>
            <button
              type="button"
              class="secondary"
              disabled={state.busy || !state.restUrl}
              onClick={() => send({ type: 'refresh' })}
            >
              Refresh Provider Status
            </button>
          </section>

          <p class="copy">
            <a href="./">Return to Logistics Control Tower</a>
          </p>
        </main>
      </>
    );
  });
}

defineProviderConsoleElement();
