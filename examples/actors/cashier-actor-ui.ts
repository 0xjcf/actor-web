import { type SnapshotFrom, assign, setup } from 'xstate';
import type { RawHTML } from '../../../framework/core/index.js';
import { createComponent, css, html } from '../../../framework/core/index.js';

// ✅ FRAMEWORK: Enhanced type definitions following Actor-SPA patterns
interface OrderDetails {
  beverage?: string;
  size?: 'small' | 'medium' | 'large';
  price?: number;
  customerId?: string;
  timestamp?: number;
  customerName?: string;
  item?: string;
  paymentMethod?: string;
}

interface CustomerInfo {
  id: string;
  name?: string;
  order?: OrderDetails;
}

interface ActorSnapshot {
  value: string;
  context: Record<string, unknown>;
  [key: string]: unknown;
}

interface Actor {
  getSnapshot(): ActorSnapshot;
  send(event: Record<string, unknown>): void;
  subscribe(observer: (snapshot: ActorSnapshot) => void): { unsubscribe(): void };
}

// ✅ FRAMEWORK: Machine context with proper typing
interface CashierUIContext {
  currentOrder?: OrderDetails;
  ordersProcessed: number;
  totalRevenue: number;
  customerQueue: CustomerInfo[];
  paymentMethod?: string;
  shift?: string;
  showDetails: boolean;
  connectedActor?: Actor;
  actorState: string;
  actorContext: Record<string, unknown>;
}

// ✅ FRAMEWORK: Machine events with proper typing
type CashierUIEvent =
  | { type: 'CONNECT_ACTOR'; actor: Actor }
  | { type: 'DISCONNECT_ACTOR' }
  | { type: 'TOGGLE_DETAILS' }
  | { type: 'SHOW_DETAILS'; show: boolean }
  | { type: 'ACTOR_STATE_UPDATED'; state: string; context: Record<string, unknown> }
  | { type: 'SEND_TO_ACTOR'; event: Record<string, unknown> };

// ✅ FRAMEWORK: XState machine replacing legacy class logic
const cashierUIMachine = setup({
  types: {
    context: {} as CashierUIContext,
    events: {} as CashierUIEvent,
  },
  actions: {
    connectActor: assign({
      connectedActor: ({ event }) => {
        if (event.type === 'CONNECT_ACTOR') {
          return event.actor;
        }
        return undefined;
      },
    }),
    disconnectActor: assign({
      connectedActor: undefined,
      actorState: 'disconnected',
      actorContext: {},
    }),
    toggleDetails: assign({
      showDetails: ({ context }) => !context.showDetails,
    }),
    setDetailsVisibility: assign({
      showDetails: ({ event }) => {
        if (event.type === 'SHOW_DETAILS') {
          return event.show;
        }
        return false;
      },
    }),
    updateActorState: assign({
      actorState: ({ event }) => {
        if (event.type === 'ACTOR_STATE_UPDATED') {
          return event.state;
        }
        return 'idle';
      },
      actorContext: ({ event }) => {
        if (event.type === 'ACTOR_STATE_UPDATED') {
          return event.context;
        }
        return {};
      },
    }),
    forwardToActor: ({ context, event }) => {
      if (event.type === 'SEND_TO_ACTOR' && context.connectedActor) {
        context.connectedActor.send(event.event);
      }
    },
  },
}).createMachine({
  id: 'cashier-ui',
  initial: 'idle',
  context: {
    ordersProcessed: 0,
    totalRevenue: 0,
    customerQueue: [],
    showDetails: true,
    actorState: 'idle',
    actorContext: {},
  },
  states: {
    idle: {
      on: {
        CONNECT_ACTOR: {
          target: 'connected',
          actions: 'connectActor',
        },
        TOGGLE_DETAILS: { actions: 'toggleDetails' },
        SHOW_DETAILS: { actions: 'setDetailsVisibility' },
      },
    },
    connected: {
      on: {
        DISCONNECT_ACTOR: {
          target: 'idle',
          actions: 'disconnectActor',
        },
        ACTOR_STATE_UPDATED: { actions: 'updateActorState' },
        SEND_TO_ACTOR: { actions: 'forwardToActor' },
        TOGGLE_DETAILS: { actions: 'toggleDetails' },
        SHOW_DETAILS: { actions: 'setDetailsVisibility' },
      },
    },
  },
});

// ✅ FRAMEWORK: Pure utility functions (no DOM queries)
const formatState = (state: string): string => {
  return state.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());
};

const formatContext = (context: Record<string, unknown>): string => {
  const details = [];
  const cashierContext = context as Partial<CashierUIContext>;

  if (cashierContext.ordersProcessed !== undefined) {
    details.push(`Orders Processed: ${cashierContext.ordersProcessed}`);
  }

  if (cashierContext.totalRevenue !== undefined) {
    details.push(`Revenue: $${cashierContext.totalRevenue.toFixed(2)}`);
  }

  if (cashierContext.customerQueue && cashierContext.customerQueue.length > 0) {
    details.push(`Queue Length: ${cashierContext.customerQueue.length}`);
  }

  if (cashierContext.shift) {
    details.push(`Shift: ${cashierContext.shift}`);
  }

  return details.length > 0 ? details.join('<br>') : 'No additional details';
};

// ✅ FRAMEWORK: Extracted template function to fix nesting violation
const orderPaymentTemplate = (paymentMethod?: string): RawHTML => {
  return paymentMethod ? html`<br>Payment: ${paymentMethod}` : html``;
};

const formatOrderProcessing = (context: Record<string, unknown>): RawHTML => {
  const cashierContext = context as Partial<CashierUIContext>;

  if (cashierContext.currentOrder) {
    const order = cashierContext.currentOrder;
    return html`
      <div class="current-processing">
        <strong>Processing Order:</strong><br>
        Customer: ${order.customerName || 'Unknown'}<br>
        Item: ${order.item || 'Coffee'}<br>
        <span class="order-total">Total: $${(order.price || 4.5).toFixed(2)}</span>
        ${orderPaymentTemplate(order.paymentMethod)}
      </div>
    `;
  }
  return html`<div class="no-processing">Ready to take orders</div>`;
};

const getIndicatorClass = (state: string): string => {
  const stateClasses: { [key: string]: string } = {
    idle: 'idle',
    takingOrder: 'taking-order',
    processingPayment: 'processing-payment',
    confirmingOrder: 'confirming-order',
    waitingForBarista: 'waiting',
    orderComplete: 'complete',
  };

  return stateClasses[state] || 'unknown';
};

// ✅ FRAMEWORK: Extracted template function to fix nesting violation
const actorDetailsTemplate = (
  showDetails: boolean,
  actorContext: Record<string, unknown>
): RawHTML => {
  return showDetails
    ? html`
    <div class="actor-context">
      ${formatContext(actorContext)}
    </div>
  `
    : html``;
};

// ✅ FRAMEWORK: Pure template function (no DOM manipulation)
const cashierUITemplate = (state: SnapshotFrom<typeof cashierUIMachine>): RawHTML => {
  const { actorState, actorContext, showDetails } = state.context;

  return html`
    <div class="cashier-actor">
      <div class="actor-header">
        <div class="actor-icon">💼</div>
        <div class="actor-title">
          <h3 class="actor-name">Cashier</h3>
          <p class="actor-role">Processes orders and handles payments</p>
        </div>
        <div class="actor-indicator ${getIndicatorClass(actorState)}"></div>
      </div>

      <div class="actor-state state-${actorState.replace(/\./g, '-')}">
        ${formatState(actorState)}
      </div>

      <div class="actor-content">
        <div class="order-processing">
          ${formatOrderProcessing(actorContext)}
        </div>

        ${actorDetailsTemplate(showDetails, actorContext)}
      </div>

      <!-- ✅ FRAMEWORK: Declarative event handling with send attributes -->
      <div class="actor-controls">
        <button send="TOGGLE_DETAILS" class="btn btn-outline">
          ${showDetails ? 'Hide Details' : 'Show Details'}
        </button>
      </div>
    </div>
  `;
};

// ✅ FRAMEWORK: CSS styles extracted and clean
const cashierUIStyles = css`
  :host {
    display: block;
    position: relative;
  }

  .cashier-actor {
    background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(15, 17, 21, 0.9) 100%);
    border: 2px solid rgba(59, 130, 246, 0.3);
    border-radius: 16px;
    padding: 1.5rem;
    position: relative;
    transition: all 0.3s ease;
    min-height: 200px;
  }

  .cashier-actor:hover {
    border-color: rgba(59, 130, 246, 0.6);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(59, 130, 246, 0.2);
  }

  .actor-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .actor-icon {
    font-size: 2.5rem;
    filter: drop-shadow(0 0 8px rgba(59, 130, 246, 0.4));
  }

  .actor-title {
    flex: 1;
  }

  .actor-name {
    color: var(--teagreen, #F5F5F5);
    font-size: 1.3rem;
    font-weight: 700;
    margin: 0;
  }

  .actor-role {
    color: rgba(59, 130, 246, 0.8);
    font-size: 0.9rem;
    margin: 0.25rem 0 0 0;
    font-weight: 500;
  }

  .actor-indicator {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #6B7280;
    transition: all 0.3s ease;
    position: relative;
  }

  .actor-indicator::after {
    content: '';
    position: absolute;
    top: -2px;
    left: -2px;
    right: -2px;
    bottom: -2px;
    border-radius: 50%;
    border: 2px solid transparent;
    transition: all 0.3s ease;
  }

  .actor-indicator.idle { background: #6B7280; }
  .actor-indicator.taking-order { background: #F59E0B; animation: pulse 1.5s infinite; }
  .actor-indicator.processing-payment { background: #3B82F6; animation: pulse 1s infinite; }
  .actor-indicator.confirming-order { background: #8B5CF6; animation: pulse 1.2s infinite; }
  .actor-indicator.waiting { background: #EF4444; animation: pulse 2s infinite; }
  .actor-indicator.complete { background: #10B981; }

  @keyframes pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.2); opacity: 0.7; }
  }

  .actor-state {
    background: rgba(59, 130, 246, 0.1);
    color: rgb(59, 130, 246);
    padding: 0.5rem 1rem;
    border-radius: 8px;
    font-size: 0.85rem;
    font-weight: 600;
    text-align: center;
    margin-bottom: 1rem;
    border: 1px solid rgba(59, 130, 246, 0.3);
    text-transform: capitalize;
  }

  .state-idle {
    background: rgba(107, 114, 128, 0.1);
    color: rgb(107, 114, 128);
    border-color: rgba(107, 114, 128, 0.3);
  }

  .state-taking-order {
    background: rgba(245, 158, 11, 0.1);
    color: rgb(245, 158, 11);
    border-color: rgba(245, 158, 11, 0.3);
  }

  .state-processing-payment {
    background: rgba(59, 130, 246, 0.1);
    color: rgb(59, 130, 246);
    border-color: rgba(59, 130, 246, 0.3);
  }

  .state-confirming-order {
    background: rgba(139, 92, 246, 0.1);
    color: rgb(139, 92, 246);
    border-color: rgba(139, 92, 246, 0.3);
  }

  .state-waiting-for-barista {
    background: rgba(239, 68, 68, 0.1);
    color: rgb(239, 68, 68);
    border-color: rgba(239, 68, 68, 0.3);
  }

  .state-order-complete {
    background: rgba(16, 185, 129, 0.1);
    color: rgb(16, 185, 129);
    border-color: rgba(16, 185, 129, 0.3);
  }

  .actor-content {
    display: grid;
    gap: 1rem;
  }

  .order-processing {
    background: rgba(15, 17, 21, 0.6);
    border: 1px solid rgba(59, 130, 246, 0.2);
    border-radius: 8px;
    padding: 1rem;
  }

  .current-processing {
    color: var(--teagreen, #F5F5F5);
    font-size: 0.9rem;
    line-height: 1.4;
  }

  .order-total {
    color: rgb(59, 130, 246);
    font-weight: 600;
    font-size: 1.1rem;
  }

  .no-processing {
    color: rgba(107, 114, 128, 0.8);
    font-style: italic;
    text-align: center;
    padding: 0.5rem;
  }

  .actor-context {
    background: rgba(15, 17, 21, 0.6);
    border: 1px solid rgba(59, 130, 246, 0.2);
    border-radius: 8px;
    padding: 1rem;
    color: var(--teagreen, #F5F5F5);
    font-size: 0.85rem;
    line-height: 1.4;
  }

  .actor-controls {
    margin-top: 1rem;
    display: flex;
    gap: 0.5rem;
    justify-content: center;
  }

  .btn {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    border: 1px solid transparent;
  }

  .btn-outline {
    background: transparent;
    border-color: rgba(59, 130, 246, 0.3);
    color: rgb(59, 130, 246);
  }

  .btn-outline:hover {
    background: rgba(59, 130, 246, 0.1);
    border-color: rgba(59, 130, 246, 0.6);
  }

  @media (max-width: 768px) {
    .cashier-actor {
      padding: 1rem;
      min-height: 160px;
    }

    .actor-header {
      margin-bottom: 1rem;
    }

    .actor-icon {
      font-size: 2rem;
    }

    .actor-name {
      font-size: 1.1rem;
    }
  }
`;

// ✅ FRAMEWORK: Create component using Actor-SPA framework
const CashierActorUIComponent = createComponent({
  machine: cashierUIMachine,
  template: cashierUITemplate,
  styles: cashierUIStyles,
  tagName: 'cashier-actor-ui',
});

// ✅ FRAMEWORK: Public API for external interactions (backward compatibility)
export const connectActor = (component: HTMLElement, actor: Actor): void => {
  const customComponent = component as HTMLElement & {
    send: (event: CashierUIEvent) => void;
  };
  if (customComponent.send) {
    customComponent.send({ type: 'CONNECT_ACTOR', actor });
  }
};

export const disconnectActor = (component: HTMLElement): void => {
  const customComponent = component as HTMLElement & {
    send: (event: CashierUIEvent) => void;
  };
  if (customComponent.send) {
    customComponent.send({ type: 'DISCONNECT_ACTOR' });
  }
};

export const showDetails = (component: HTMLElement, show: boolean): void => {
  const customComponent = component as HTMLElement & {
    send: (event: CashierUIEvent) => void;
  };
  if (customComponent.send) {
    customComponent.send({ type: 'SHOW_DETAILS', show });
  }
};

// ✅ FRAMEWORK: Export the component and types
export default CashierActorUIComponent;
export type { Actor, CashierUIContext, CashierUIEvent, CustomerInfo, OrderDetails };
