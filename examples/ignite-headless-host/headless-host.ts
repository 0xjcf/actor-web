import type {
  IgniteActorSource,
  IgniteActorSourceEvent,
  ProjectionTransportState,
} from '@actor-core/runtime/browser';
import type { CheckoutCommand, CheckoutContext, CheckoutEvent } from './runtime-harness';
import { createCheckoutRuntimeHarness } from './runtime-harness';

export interface HeadlessCheckoutEventLog {
  type: CheckoutEvent['type'];
  orderId: string | null;
  actorId: string;
}

export interface HeadlessCheckoutHostState {
  phase: string;
  submittedOrders: string[];
  lastSubmittedOrderId: string | null;
  eventLog: HeadlessCheckoutEventLog[];
  transportState: ProjectionTransportState;
  transportReason: string | null;
}

export interface HeadlessCheckoutHost {
  readonly address: string;
  getState(): HeadlessCheckoutHostState;
  subscribe(listener: (state: HeadlessCheckoutHostState) => void): () => void;
  submit(orderId: string): Promise<void>;
  reset(): Promise<void>;
  destroy(): Promise<void>;
}

interface CreateHeadlessCheckoutHostOptions {
  destroy?: () => Promise<void>;
}

function cloneState(state: HeadlessCheckoutHostState): HeadlessCheckoutHostState {
  return {
    phase: state.phase,
    submittedOrders: [...state.submittedOrders],
    lastSubmittedOrderId: state.lastSubmittedOrderId,
    eventLog: state.eventLog.map((event) => ({ ...event })),
    transportState: state.transportState,
    transportReason: state.transportReason,
  };
}

function toEventLogEntry(event: IgniteActorSourceEvent<CheckoutEvent>): HeadlessCheckoutEventLog {
  return {
    type: event.type,
    orderId: 'orderId' in event ? event.orderId : null,
    actorId: event.address.id,
  };
}

export function createHeadlessCheckoutHostFromSource(
  source: IgniteActorSource<CheckoutContext, CheckoutCommand, CheckoutEvent>,
  options: CreateHeadlessCheckoutHostOptions = {}
): HeadlessCheckoutHost {
  const listeners = new Set<(state: HeadlessCheckoutHostState) => void>();
  let state: HeadlessCheckoutHostState = {
    phase: source.snapshot().phase,
    submittedOrders: [...source.snapshot().context.submittedOrders],
    lastSubmittedOrderId: source.snapshot().context.lastSubmittedOrderId,
    eventLog: [],
    transportState: source.transportStatus().state,
    transportReason: source.transportStatus().reason ?? null,
  };

  const notify = (): void => {
    const snapshot = cloneState(state);
    for (const listener of Array.from(listeners)) {
      listener(snapshot);
    }
  };

  const unsubscribeSnapshot = source.subscribe((snapshot) => {
    state = {
      ...state,
      phase: snapshot.phase,
      submittedOrders: [...snapshot.context.submittedOrders],
      lastSubmittedOrderId: snapshot.context.lastSubmittedOrderId,
    };
    notify();
  });

  const unsubscribeEvent = source.subscribeEvent(
    (event) => {
      state = {
        ...state,
        eventLog: [toEventLogEntry(event), ...state.eventLog].slice(0, 8),
      };
      notify();
    },
    { types: ['CHECKOUT_SUBMITTED', 'CHECKOUT_RESET'] }
  );

  const unsubscribeTransportStatus = source.subscribeTransportStatus((status) => {
    state = {
      ...state,
      transportState: status.state,
      transportReason: status.reason ?? null,
    };
    notify();
  });

  return {
    address: source.address.path,
    getState(): HeadlessCheckoutHostState {
      return cloneState(state);
    },
    subscribe(listener: (nextState: HeadlessCheckoutHostState) => void): () => void {
      listeners.add(listener);
      listener(cloneState(state));

      return () => {
        listeners.delete(listener);
      };
    },
    async submit(orderId: string): Promise<void> {
      const normalizedOrderId = orderId.trim();
      if (normalizedOrderId.length === 0) {
        return;
      }

      await source.send({
        type: 'SUBMIT',
        orderId: normalizedOrderId,
      });
    },
    async reset(): Promise<void> {
      await source.send({ type: 'RESET' });
    },
    async destroy(): Promise<void> {
      unsubscribeTransportStatus();
      unsubscribeEvent();
      unsubscribeSnapshot();
      listeners.clear();
      await options.destroy?.();
    },
  };
}

export function createHeadlessCheckoutHost(): HeadlessCheckoutHost {
  const runtimeHarness = createCheckoutRuntimeHarness();
  return createHeadlessCheckoutHostFromSource(runtimeHarness.source, {
    destroy: runtimeHarness.destroy,
  });
}
