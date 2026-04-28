/// <reference types="vite/client" />

import type {
  ActorWebAddress,
  ActorWebSourceHandle,
  ActorWebSourceSnapshot,
  ActorWebTransportStatus,
} from 'ignite-element/actor-web';
import type { ProviderSignal, ShipmentStatus } from './logistics-contract';
import type { LifecycleMode, ProviderQueueItem, ProviderStatus } from './logistics-provider-hq';
import { isProviderSignal } from './logistics-provider-hq';

export const PROVIDER_QUEUE_PAGE_SIZE = 5;

export type ProviderConsoleEvent =
  | { type: 'refresh' }
  | { type: 'mode'; mode: LifecycleMode }
  | { type: 'queue.select'; shipmentId: string }
  | { type: 'queue.next' }
  | { type: 'queue.prev' }
  | { type: 'signal'; signal: ProviderSignal; note: string };

export type ProviderConsoleStatus = Omit<ProviderStatus, 'mode'> & {
  mode: LifecycleMode | 'unknown';
};

export interface ProviderConsoleState {
  restUrl: string | null;
  status: ProviderConsoleStatus;
  selectedShipmentId: string | null;
  queuePage: number;
  busy: boolean;
  message: string;
}

const providerConsoleAddress: ActorWebAddress = {
  id: 'provider-console',
  type: 'actor',
  node: 'browser-host',
  path: 'actor://browser-host/actor/provider-console',
};

function configuredRestUrl(): string | undefined {
  const configuredUrl = import.meta.env.VITE_ACTOR_WEB_REST_URL;
  return typeof configuredUrl === 'string' && configuredUrl.trim().length > 0
    ? configuredUrl.replace(/\/$/, '')
    : undefined;
}

export function isTerminalShipment(status: ShipmentStatus | null | undefined): boolean {
  return status === 'delivered' || status === 'returned';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isShipmentStatus(value: unknown): value is ShipmentStatus {
  return (
    value === 'idle' ||
    value === 'accepted' ||
    value === 'route-requested' ||
    value === 'route-assigned' ||
    value === 'in-transit' ||
    value === 'delivered' ||
    value === 'returned'
  );
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseProviderQueueItem(value: unknown): ProviderQueueItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const shipmentId = value.shipmentId;
  const status = value.status;
  const facility = value.facility;
  const loadId = value.loadId;
  const updatedAt = value.updatedAt;

  if (
    typeof shipmentId !== 'string' ||
    !isShipmentStatus(status) ||
    typeof facility !== 'string' ||
    typeof loadId !== 'string' ||
    typeof updatedAt !== 'number'
  ) {
    return null;
  }

  return {
    shipmentId,
    destination: optionalString(value.destination),
    reference: optionalString(value.reference),
    status,
    facility,
    signal: isProviderSignal(value.signal) ? value.signal : null,
    loadId,
    note: optionalString(value.note),
    updatedAt,
  };
}

function parseProviderQueue(value: unknown): ProviderQueueItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const parsed = parseProviderQueueItem(item);
    return parsed ? [parsed] : [];
  });
}

function parseProviderStatus(value: unknown): ProviderStatus | null {
  if (!isRecord(value)) {
    return null;
  }

  const mode = value.mode;
  if (mode !== 'simulation' && mode !== 'manual') {
    return null;
  }

  const statusValue = value.status;
  return {
    mode,
    shipmentId: optionalString(value.shipmentId),
    status: isShipmentStatus(statusValue) ? statusValue : null,
    facility: optionalString(value.facility),
    signal: isProviderSignal(value.signal) ? value.signal : null,
    loadId: optionalString(value.loadId),
    note: optionalString(value.note),
    queue: parseProviderQueue(value.queue),
  };
}

function parseErrorMessage(value: unknown): string {
  if (isRecord(value) && typeof value.error === 'string') {
    return value.error;
  }

  return 'Provider server returned an invalid response.';
}

function emptyStatus(): ProviderConsoleStatus {
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

function cloneState(state: ProviderConsoleState): ProviderConsoleState {
  return {
    ...state,
    status: {
      ...state.status,
      queue: state.status.queue.map((item) => ({ ...item })),
    },
  };
}

function clampQueuePage(page: number, queueLength: number): number {
  return Math.min(page, Math.max(0, Math.ceil(queueLength / PROVIDER_QUEUE_PAGE_SIZE) - 1));
}

function preserveSelected(
  status: ProviderStatus,
  selectedShipmentId: string | null
): string | null {
  if (
    selectedShipmentId &&
    status.queue.some(
      (item) => item.shipmentId === selectedShipmentId && !isTerminalShipment(item.status)
    )
  ) {
    return selectedShipmentId;
  }

  return null;
}

export function createProviderConsoleSource(): ActorWebSourceHandle<
  ProviderConsoleState,
  ProviderConsoleEvent,
  ProviderConsoleEvent
> {
  const restUrl = configuredRestUrl() ?? null;
  const listeners = new Set<(snapshot: ActorWebSourceSnapshot<ProviderConsoleState>) => void>();
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

  const snapshot = (): ActorWebSourceSnapshot<ProviderConsoleState> => ({
    address: providerConsoleAddress,
    context: cloneState(state),
    phase: state.status.mode,
    toJSON: () => ({
      address: providerConsoleAddress,
      context: cloneState(state),
      phase: state.status.mode,
    }),
  });

  const transportStatus = (): ActorWebTransportStatus => ({
    state: restUrl ? 'connected' : 'degraded',
    updatedAt: Date.now(),
    ...(restUrl ? {} : { reason: 'Provider REST URL is not configured.' }),
  });

  const notify = (): void => {
    const nextSnapshot = snapshot();
    for (const listener of Array.from(listeners)) {
      listener(nextSnapshot);
    }
  };

  const refresh = async (): Promise<void> => {
    if (!restUrl) {
      return;
    }

    const response = await fetch(`${restUrl}/provider/status`);
    const body: unknown = await response.json();
    const status = parseProviderStatus(body);
    if (!response.ok || !status) {
      state = {
        ...state,
        message: parseErrorMessage(body),
      };
      notify();
      return;
    }

    state = {
      ...state,
      status,
      selectedShipmentId: preserveSelected(status, state.selectedShipmentId),
      queuePage: clampQueuePage(state.queuePage, status.queue.length),
      message: 'Provider status refreshed.',
    };
    notify();
  };

  const setMode = async (mode: LifecycleMode): Promise<void> => {
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
      const body: unknown = await response.json();
      const status = parseProviderStatus(body);

      state = {
        ...state,
        ...(response.ok && status
          ? {
              status,
              selectedShipmentId: preserveSelected(status, state.selectedShipmentId),
              message: `Provider mode set to ${mode}.`,
            }
          : {
              selectedShipmentId: null,
              message: parseErrorMessage(body),
            }),
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
      const body: unknown = await response.json();
      const status = parseProviderStatus(body);

      state = {
        ...state,
        ...(response.ok && status
          ? {
              status,
              selectedShipmentId: preserveSelected(status, state.selectedShipmentId),
              message: `${signal} accepted by server runtime.`,
            }
          : {
              message: parseErrorMessage(body),
            }),
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
    source: {
      address: providerConsoleAddress,
      snapshot,
      subscribe(listener: (nextSnapshot: ActorWebSourceSnapshot<ProviderConsoleState>) => void) {
        listeners.add(listener);
        listener(snapshot());
        return () => {
          listeners.delete(listener);
        };
      },
      transportStatus,
      async send(event: ProviderConsoleEvent): Promise<void> {
        if (event.type === 'refresh') {
          await refresh();
          return;
        }

        if (event.type === 'mode') {
          await setMode(event.mode);
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
            queuePage: clampQueuePage(state.queuePage + 1, state.status.queue.length),
          };
          notify();
          return;
        }

        await sendSignal(event.signal, event.note);
      },
    },
    stop(): void {
      window.clearInterval(refreshTimer);
      listeners.clear();
    },
  };
}
