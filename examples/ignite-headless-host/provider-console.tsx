/** @jsxImportSource ignite-element/jsx */

import 'ignite-element/renderers/ignite-jsx';

import { igniteCore } from 'ignite-element/actor-web';
import type { ProviderSignal } from './logistics-contract';
import {
  createProviderConsoleSource,
  isTerminalShipment,
  PROVIDER_QUEUE_PAGE_SIZE,
} from './provider-console-adapter';

export const PROVIDER_CONSOLE_ELEMENT_NAME = 'aw-provider-console';

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

const registerProviderConsole = igniteCore({
  source: createProviderConsoleSource,
  states: ({ context }) => {
    const queuePageCount = Math.max(
      1,
      Math.ceil(context.status.queue.length / PROVIDER_QUEUE_PAGE_SIZE)
    );
    const visibleQueue = context.status.queue.slice(
      context.queuePage * PROVIDER_QUEUE_PAGE_SIZE,
      context.queuePage * PROVIDER_QUEUE_PAGE_SIZE + PROVIDER_QUEUE_PAGE_SIZE
    );
    const selectedItem = context.status.queue.find(
      (item) => item.shipmentId === context.selectedShipmentId
    );
    const selectedIsTerminal = isTerminalShipment(selectedItem?.status);

    return {
      restUrl: context.restUrl,
      status: context.status,
      selectedShipmentId: context.selectedShipmentId,
      queuePage: context.queuePage,
      queuePageCount,
      visibleQueue: visibleQueue.map((item) => ({
        item,
        isTerminal: isTerminalShipment(item.status),
        isSelected:
          item.shipmentId === context.selectedShipmentId && !isTerminalShipment(item.status),
      })),
      selectedItem,
      selectedIsTerminal,
      busy: context.busy,
      message: context.message,
    };
  },
  commands: ({ actor }) => ({
    refresh() {
      return actor.send({ type: 'refresh' });
    },
    setMode(mode: 'simulation' | 'manual') {
      return actor.send({ type: 'mode', mode });
    },
    selectShipment(shipmentId: string) {
      return actor.send({ type: 'queue.select', shipmentId });
    },
    previousQueuePage() {
      return actor.send({ type: 'queue.prev' });
    },
    nextQueuePage() {
      return actor.send({ type: 'queue.next' });
    },
    sendSignal(signal: ProviderSignal, note: string) {
      return actor.send({ type: 'signal', signal, note });
    },
  }),
});

export function defineProviderConsoleElement(): void {
  if (customElements.get(PROVIDER_CONSOLE_ELEMENT_NAME)) {
    return;
  }

  registerProviderConsole(PROVIDER_CONSOLE_ELEMENT_NAME, (view) => {
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
                class={view.status.mode === 'simulation' ? 'active' : 'secondary'}
                disabled={view.busy || !view.restUrl}
                onClick={() => void view.setMode('simulation')}
              >
                Live Simulation
              </button>
              <button
                type="button"
                class={view.status.mode === 'manual' ? 'active' : 'secondary'}
                disabled={view.busy || !view.restUrl}
                onClick={() => void view.setMode('manual')}
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
                {view.selectedItem?.shipmentId ?? view.selectedShipmentId ?? 'none selected'}
              </strong>
              <span class="queue-meta">
                {view.selectedItem
                  ? `${view.selectedItem.destination ?? 'destination pending'} / ${
                      view.selectedItem.status
                    }`
                  : 'Select a queued shipment before sending provider signals.'}
              </span>
            </div>
            {view.visibleQueue.length > 0 ? (
              view.visibleQueue.map(({ item, isSelected, isTerminal }) => {
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
                          disabled={view.busy}
                          onClick={() => void view.selectShipment(item.shipmentId)}
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
                disabled={view.queuePage === 0}
                onClick={() => void view.previousQueuePage()}
              >
                Previous
              </button>
              <span class="queue-meta">
                Page {view.queuePage + 1} of {view.queuePageCount}
              </span>
              <button
                type="button"
                class="secondary"
                disabled={view.queuePage + 1 >= view.queuePageCount}
                onClick={() => void view.nextQueuePage()}
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
                <span class="value">{view.status.mode}</span>
              </div>
              <div class="metric">
                <span class="label">Shipment</span>
                <span class="value">{view.selectedItem?.shipmentId ?? 'select from queue'}</span>
              </div>
              <div class="metric">
                <span class="label">Status</span>
                <span class="value">{view.selectedItem?.status ?? 'none selected'}</span>
              </div>
              <div class="metric">
                <span class="label">Facility</span>
                <span class="value">
                  {view.selectedItem?.facility ?? 'select a shipment first'}
                </span>
              </div>
              <div class="metric">
                <span class="label">Latest Signal</span>
                <span class="value">{view.selectedItem?.signal ?? 'none selected'}</span>
              </div>
              <div class="metric">
                <span class="label">Truck Load</span>
                <span class="value">{view.selectedItem?.loadId ?? 'select a shipment first'}</span>
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
                    view.busy ||
                    !view.restUrl ||
                    !view.selectedShipmentId ||
                    view.selectedIsTerminal
                  }
                  onClick={() => void view.sendSignal(entry.signal, entry.note)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <p class="copy">{view.selectedItem?.note ?? view.status.note ?? view.message}</p>
            <button
              type="button"
              class="secondary"
              disabled={view.busy || !view.restUrl}
              onClick={() => void view.refresh()}
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
