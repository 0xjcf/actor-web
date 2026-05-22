/** @jsxImportSource ignite-element/jsx */

import 'ignite-element/renderers/ignite-jsx';

import { igniteCore } from 'ignite-element/actor-web';
import { logisticsClient } from './logistics-browser-client';
import type { ProviderSignal, ProviderSignalCommand } from './logistics-contract';
import {
  createInitialProviderHqContext,
  expectedProviderSignal,
  isTerminalShipment,
  PROVIDER_QUEUE_PAGE_SIZE,
  providerSignalCommandType,
  providerSignalExpectationLabel,
  providerSignalMatchesExpected,
} from './logistics-provider-hq';
import styles from './provider-console.css?raw';

export const PROVIDER_CONSOLE_ELEMENT_NAME = 'aw-provider-console';

const signals: Array<{
  signal: ProviderSignal;
  command: ProviderSignalCommand['type'];
  label: string;
  note: string;
}> = [
  {
    signal: 'LABEL_SCANNED',
    command: 'LABEL_SCANNED',
    label: 'Scan Label',
    note: 'Label barcode matched shipment manifest.',
  },
  {
    signal: 'PACKED_INTO_TRUCK',
    command: 'PACKED_INTO_TRUCK',
    label: 'Pack Truck',
    note: 'Shipment was packed into the assigned truck load.',
  },
  {
    signal: 'OUTBOUND_SCAN',
    command: 'OUTBOUND_SCAN',
    label: 'Outbound Scan',
    note: 'Carrier accepted handoff and outbound scan was recorded.',
  },
  {
    signal: 'DELIVERY_CONFIRMED',
    command: 'DELIVERY_CONFIRMED',
    label: 'Confirm Delivery',
    note: 'Destination dock confirmed delivery.',
  },
  {
    signal: 'RETURN_EXCEPTION',
    command: 'RETURN_EXCEPTION',
    label: 'Report Return',
    note: 'Return exception triggered by address validation hold.',
  },
];

const registerProviderConsole = igniteCore({
  source: logisticsClient.actors.providerHq,
  states: ({ context }) => {
    const providerContext = context ?? createInitialProviderHqContext();
    const queuePageCount = Math.max(
      1,
      Math.ceil(providerContext.status.queue.length / PROVIDER_QUEUE_PAGE_SIZE)
    );
    const visibleQueue = providerContext.status.queue.slice(
      providerContext.queuePage * PROVIDER_QUEUE_PAGE_SIZE,
      providerContext.queuePage * PROVIDER_QUEUE_PAGE_SIZE + PROVIDER_QUEUE_PAGE_SIZE
    );
    const selectedItem = providerContext.status.queue.find(
      (item) => item.shipmentId === providerContext.selectedShipmentId
    );
    const selectedShipment = providerContext.selectedShipmentId
      ? providerContext.shipmentContexts[providerContext.selectedShipmentId]
      : undefined;
    const selectedIsTerminal = isTerminalShipment(selectedItem?.status);
    const expectedSignal = expectedProviderSignal(selectedShipment);
    const expectedSignalLabel = providerSignalExpectationLabel(expectedSignal);

    return {
      status: providerContext.status,
      providerSourceLabel: providerContext.status.sourceLabel,
      selectedShipmentId: providerContext.selectedShipmentId,
      queuePage: providerContext.queuePage,
      queuePageCount,
      visibleQueue: visibleQueue.map((item) => ({
        item,
        isTerminal: isTerminalShipment(item.status),
        isSelected:
          item.shipmentId === context.selectedShipmentId && !isTerminalShipment(item.status),
      })),
      selectedItem,
      selectedIsTerminal,
      expectedSignal,
      expectedSignalLabel,
      signalControls: signals.map((entry) => ({
        ...entry,
        isNext: providerSignalMatchesExpected(selectedShipment, entry.signal),
      })),
      busy: providerContext.busy,
      message: providerContext.message,
      messageTone: providerContext.message.includes('rejected') ? 'error' : 'info',
    };
  },
  events: (eventBuilder) => ({
    'provider-console-alert': eventBuilder<{
      tone: 'error' | 'info';
      message: string;
    }>(),
  }),
  commands: ({ actor, command }) => ({
    refresh: command(() => actor.send({ type: 'REFRESH_PROVIDER_STATUS' }), {
      description: 'Refresh the Provider HQ status from the actor-owned queue state.',
    }),
    setMode: command(
      (mode: 'simulation' | 'manual') => actor.send({ type: 'SET_PROVIDER_MODE', mode }),
      {
        description: 'Switch the Provider HQ between simulation and manual operator mode.',
      }
    ),
    selectShipment: command(
      (shipmentId: string) => actor.send({ type: 'SELECT_PROVIDER_SHIPMENT', shipmentId }),
      {
        description: 'Select the active shipment in the Provider HQ queue.',
      }
    ),
    previousQueuePage: command(() => actor.send({ type: 'PROVIDER_QUEUE_PREV' }), {
      description: 'Move to the previous Provider HQ queue page.',
    }),
    nextQueuePage: command(() => actor.send({ type: 'PROVIDER_QUEUE_NEXT' }), {
      description: 'Move to the next Provider HQ queue page.',
    }),
    sendSignal: command(
      (signal: ProviderSignal, note: string) =>
        actor.send({ type: providerSignalCommandType(signal), note }),
      {
        description:
          'Send the selected provider lifecycle signal to the actor-owned Provider HQ workflow.',
      }
    ),
  }),
  effects: (snapshot, prevSnapshot, { emit }) => {
    const message = snapshot.context?.message;
    const previousMessage = prevSnapshot.context?.message;

    if (!message || message === previousMessage) {
      return;
    }

    emit('provider-console-alert', {
      tone: message.includes('rejected') ? 'error' : 'info',
      message,
    });
  },
});

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
              disabled={view.busy}
              onClick={() => void view.setMode('simulation')}
            >
              Live Simulation
            </button>
            <button
              type="button"
              class={view.status.mode === 'manual' ? 'active' : 'secondary'}
              disabled={view.busy}
              onClick={() => void view.setMode('manual')}
            >
              Manual Provider
            </button>
          </div>
          <p class="copy">
            Simulation lets the server advance shipments. Manual mode lets this provider console
            process the queue one shipment at a time. Current signal source:{' '}
            {view.providerSourceLabel}.
          </p>
        </section>

        <section class="panel">
          <h2>Provider Queue</h2>
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
              <span class="label">Signal Source</span>
              <span class="value">{view.providerSourceLabel}</span>
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
              <span class="value">{view.selectedItem?.facility ?? 'select a shipment first'}</span>
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
          <div class={`workflow-alert ${view.messageTone}`}>
            Next required signal: {view.expectedSignalLabel}
          </div>
          <div class="actions">
            {view.signalControls.map((entry) => (
              <button
                type="button"
                class={entry.isNext ? 'next' : ''}
                disabled={view.busy || !view.selectedShipmentId || view.selectedIsTerminal}
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
            disabled={view.busy}
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
