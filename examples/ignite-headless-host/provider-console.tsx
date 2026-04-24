/** @jsxImportSource ignite-element/jsx */
/// <reference types="vite/client" />

import 'ignite-element/renderers/ignite-jsx';

import { igniteElementFactory, StateScope } from 'ignite-element';
import type { ProviderSignal, ShipmentStatus } from './checkout-contract';

export const PROVIDER_CONSOLE_ELEMENT_NAME = 'aw-provider-console';

type ProviderConsoleEvent =
  | { type: 'refresh' }
  | { type: 'signal'; signal: ProviderSignal; note: string };

interface ProviderStatus {
  mode: string;
  shipmentId: string | null;
  status: ShipmentStatus | null;
  facility: string | null;
  signal: ProviderSignal | null;
  loadId: string | null;
  note: string | null;
}

interface ProviderConsoleState {
  restUrl: string | null;
  status: ProviderStatus;
  busy: boolean;
  message: string;
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
  };
}

function createProviderConsoleAdapter() {
  const restUrl = configuredRestUrl() ?? null;
  const listeners = new Set<(state: ProviderConsoleState) => void>();
  let state: ProviderConsoleState = {
    restUrl,
    status: emptyStatus(),
    busy: false,
    message: restUrl
      ? 'Provider console ready.'
      : 'Start with pnpm examples:logistics to enable provider REST controls.',
  };

  const clone = (): ProviderConsoleState => ({
    ...state,
    status: { ...state.status },
  });

  const notify = (): void => {
    const snapshot = clone();
    for (const listener of Array.from(listeners)) {
      listener(snapshot);
    }
  };

  const refresh = async (): Promise<void> => {
    if (!restUrl) {
      return;
    }

    const response = await fetch(`${restUrl}/provider/status`);
    state = {
      ...state,
      status: (await response.json()) as ProviderStatus,
      message: 'Provider status refreshed.',
    };
    notify();
  };

  const sendSignal = async (signal: ProviderSignal, note: string): Promise<void> => {
    if (!restUrl || state.busy) {
      return;
    }

    state = { ...state, busy: true, message: `Sending ${signal}` };
    notify();

    try {
      const response = await fetch(`${restUrl}/provider/signals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signal, note }),
      });
      const body = (await response.json()) as ProviderStatus & { error?: string };
      state = {
        ...state,
        status: response.ok ? body : state.status,
        message: response.ok ? `${signal} accepted by server runtime.` : String(body.error),
      };
    } finally {
      state = { ...state, busy: false };
      notify();
    }
  };

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

      void sendSignal(event.signal, event.note);
    },
    getState(): ProviderConsoleState {
      return clone();
    },
    stop(): void {
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

  registerProviderConsole(PROVIDER_CONSOLE_ELEMENT_NAME, ({ state, send }) => (
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
          <h2>Current Shipment</h2>
          <div class="grid">
            <div class="metric">
              <span class="label">Lifecycle Mode</span>
              <span class="value">{state.status.mode}</span>
            </div>
            <div class="metric">
              <span class="label">Shipment</span>
              <span class="value">{state.status.shipmentId ?? 'none'}</span>
            </div>
            <div class="metric">
              <span class="label">Status</span>
              <span class="value">{state.status.status ?? 'none'}</span>
            </div>
            <div class="metric">
              <span class="label">Facility</span>
              <span class="value">{state.status.facility ?? 'waiting for scan'}</span>
            </div>
            <div class="metric">
              <span class="label">Latest Signal</span>
              <span class="value">{state.status.signal ?? 'none'}</span>
            </div>
            <div class="metric">
              <span class="label">Truck Load</span>
              <span class="value">{state.status.loadId ?? 'unassigned'}</span>
            </div>
          </div>
        </section>

        <section class="panel">
          <h2>Provider Signals</h2>
          <div class="actions">
            {signals.map((entry) => (
              <button
                type="button"
                disabled={state.busy || !state.restUrl}
                onClick={() => send({ type: 'signal', signal: entry.signal, note: entry.note })}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <p class="copy">{state.status.note ?? state.message}</p>
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
  ));
}

defineProviderConsoleElement();
