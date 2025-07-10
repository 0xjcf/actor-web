// CustomerActorUI refactored to use Actor-SPA Framework API
import { assign, type SnapshotFrom, setup } from 'xstate';
import { createComponent, css, html, type RawHTML } from '../../../framework/core/index.js';
import '../../ui/loading-state.js';

// ✅ Type-safe interfaces following framework patterns
interface CustomerOrder {
  id: string;
  items: string[];
  status: 'pending' | 'in-progress' | 'completed';
  total: number;
}

interface CustomerPreferences {
  favoriteItems: string[];
  dietaryRestrictions: string[];
  preferredPaymentMethod: string;
}

interface ActorSnapshot {
  value: string;
  context: Record<string, unknown>;
  matches: (state: string) => boolean;
  can: (event: Record<string, unknown>) => boolean;
}

interface Actor {
  getSnapshot(): ActorSnapshot;
  send(event: Record<string, unknown>): void;
  subscribe(observer: (snapshot: ActorSnapshot) => void): { unsubscribe(): void };
}

interface CustomerContext {
  customerName?: string;
  currentOrder?: CustomerOrder | null;
  satisfaction?: number;
  waitingTime?: number;
  orderHistory?: CustomerOrder[];
  preferences?: CustomerPreferences;
}

// ✅ State machine context interface
interface CustomerActorUIContext {
  connectedActor: Actor | null;
  actorState: string;
  actorContext: CustomerContext;
  showDetails: boolean;
  subscription: { unsubscribe(): void } | null;
  lastUpdateTime: number;
}

// ✅ Event types for type safety
type CustomerActorUIEvent =
  | { type: 'CONNECT_ACTOR'; actor: Actor }
  | { type: 'DISCONNECT_ACTOR' }
  | { type: 'TOGGLE_DETAILS' }
  | { type: 'SHOW_DETAILS'; show: boolean }
  | { type: 'UPDATE_ACTOR_STATE'; state: string; context: CustomerContext }
  | { type: 'SEND_TO_ACTOR'; event: Record<string, unknown> };

// ✅ Helper functions
const formatState = (state: string): string => {
  return state.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());
};

const formatContext = (context: CustomerContext): string => {
  const details = [];

  if (context.customerName) {
    details.push(`Name: ${context.customerName}`);
  }

  if (context.satisfaction !== undefined) {
    details.push(`Satisfaction: ${context.satisfaction}%`);
  }

  if (context.waitingTime !== undefined) {
    details.push(`Wait Time: ${context.waitingTime}s`);
  }

  if (context.orderHistory && context.orderHistory.length > 0) {
    details.push(`Orders: ${context.orderHistory.length}`);
  }

  return details.length > 0 ? details.join('<br>') : 'No additional details';
};

const formatOrderStatus = (context: CustomerContext): RawHTML => {
  if (context.currentOrder) {
    const order = context.currentOrder;
    const itemsText = order.items.length > 0 ? order.items.join(', ') : 'Coffee';
    return html`
      <div class="current-order">
        <strong>Current Order:</strong><br>
        ${itemsText}<br>
        <span class="order-price">$${order.total.toFixed(2)}</span>
      </div>
    `;
  }
  return html`<div class="no-order">No current order</div>`;
};

const getIndicatorClass = (state: string): string => {
  const stateClasses: { [key: string]: string } = {
    idle: 'idle',
    browsing: 'browsing',
    ordering: 'ordering',
    waiting: 'waiting',
    receiving: 'receiving',
    enjoying: 'enjoying',
    leaving: 'leaving',
  };

  return stateClasses[state] || 'unknown';
};

// ✅ XState machine for component state management
const customerActorUIMachine = setup({
  types: {
    context: {} as CustomerActorUIContext,
    events: {} as CustomerActorUIEvent,
  },
  actions: {
    connectActor: assign({
      connectedActor: ({ event }) => (event.type === 'CONNECT_ACTOR' ? event.actor : null),
      actorState: ({ event }) =>
        event.type === 'CONNECT_ACTOR' ? event.actor.getSnapshot().value : 'idle',
      actorContext: ({ event }) =>
        event.type === 'CONNECT_ACTOR'
          ? (event.actor.getSnapshot().context as CustomerContext)
          : {},
      lastUpdateTime: Date.now(),
    }),
    disconnectActor: assign({
      connectedActor: null,
      actorState: 'idle',
      actorContext: {},
      subscription: ({ context }) => {
        if (context.subscription) {
          context.subscription.unsubscribe();
        }
        return null;
      },
      lastUpdateTime: Date.now(),
    }),
    toggleDetails: assign({
      showDetails: ({ context }) => !context.showDetails,
    }),
    showDetails: assign({
      showDetails: ({ event }) => (event.type === 'SHOW_DETAILS' ? event.show : true),
    }),
    updateActorState: assign({
      actorState: ({ event }) => (event.type === 'UPDATE_ACTOR_STATE' ? event.state : 'idle'),
      actorContext: ({ event }) => (event.type === 'UPDATE_ACTOR_STATE' ? event.context : {}),
      lastUpdateTime: Date.now(),
    }),
    sendToActor: ({ context, event }) => {
      if (event.type === 'SEND_TO_ACTOR' && context.connectedActor) {
        context.connectedActor.send(event.event);
      }
    },
  },
}).createMachine({
  id: 'customerActorUI',
  initial: 'disconnected',
  context: {
    connectedActor: null,
    actorState: 'idle',
    actorContext: {},
    showDetails: true,
    subscription: null,
    lastUpdateTime: Date.now(),
  },
  states: {
    disconnected: {
      on: {
        CONNECT_ACTOR: { target: 'connected', actions: 'connectActor' },
        TOGGLE_DETAILS: { actions: 'toggleDetails' },
        SHOW_DETAILS: { actions: 'showDetails' },
      },
    },
    connected: {
      on: {
        DISCONNECT_ACTOR: { target: 'disconnected', actions: 'disconnectActor' },
        UPDATE_ACTOR_STATE: { actions: 'updateActorState' },
        SEND_TO_ACTOR: { actions: 'sendToActor' },
        TOGGLE_DETAILS: { actions: 'toggleDetails' },
        SHOW_DETAILS: { actions: 'showDetails' },
      },
    },
  },
});

// Helper templates to fix nesting violations
const renderDisconnectButton = (state: string): RawHTML => {
  if (state === 'disconnected') return html``;
  return html`
    <button send="DISCONNECT_ACTOR" class="btn-disconnect">
      Disconnect Actor
    </button>
  `;
};

const renderDetailsSection = (
  showDetails: boolean,
  actorContext: CustomerContext,
  lastUpdateTime: number
): RawHTML => {
  if (!showDetails) return html``;
  return html`
    <div class="actor-context">
      ${formatContext(actorContext)}
    </div>
    
    <div class="debug-info">
      <small>Last Update: ${new Date(lastUpdateTime).toLocaleTimeString()}</small>
    </div>
  `;
};

const renderActorCommunication = (state: string): RawHTML => {
  if (state === 'disconnected') return html``;
  return html`
    <div class="actor-communication">
      <h4>Send Events to Actor:</h4>
      <div class="event-buttons">
        <button send="SEND_TO_ACTOR" event=${{ type: 'START_BROWSING' }} class="btn-event">
          Start Browsing
        </button>
        <button send="SEND_TO_ACTOR" event=${{ type: 'PLACE_ORDER' }} class="btn-event">
          Place Order
        </button>
        <button send="SEND_TO_ACTOR" event=${{ type: 'CANCEL_ORDER' }} class="btn-event">
          Cancel Order
        </button>
      </div>
    </div>
  `;
};

// ✅ Pure template function using framework patterns
const customerActorUITemplate = (state: SnapshotFrom<typeof customerActorUIMachine>): RawHTML => {
  const { actorState, actorContext, showDetails, lastUpdateTime } = state.context;
  const isConnected = state.value !== 'disconnected';

  return html`
    <div class="customer-actor">
      <div class="actor-header">
        <div class="actor-icon">👤</div>
        <div class="actor-title">
          <h3 class="actor-name">Customer</h3>
          <p class="actor-role">Orders coffee and experiences the service</p>
        </div>
        <div class="actor-indicator ${getIndicatorClass(actorState)}"></div>
      </div>

      <!-- Connection Status -->
      <div class="connection-status ${isConnected ? 'connected' : 'disconnected'}">
        ${isConnected ? '🟢 Connected' : '🔴 Disconnected'}
      </div>

      <!-- Actor State -->
      <div class="actor-state state-${actorState.replace(/\./g, '-')}">
        ${formatState(actorState)}
      </div>

      <!-- Controls -->
      <div class="actor-controls">
        <button send="TOGGLE_DETAILS" class="btn-toggle">
          ${showDetails ? 'Hide Details' : 'Show Details'}
        </button>
        
        ${renderDisconnectButton(state.value)}
      </div>

      <!-- Content -->
      <div class="actor-content">
        <!-- Order Status -->
        <div class="order-status">
          ${formatOrderStatus(actorContext)}
        </div>

        <!-- Details -->
        ${renderDetailsSection(showDetails, actorContext, lastUpdateTime)}
      </div>
      
      <!-- Actor Communication -->
      ${renderActorCommunication(state.value)}
    </div>
  `;
};

// ✅ Component styles using framework patterns
const customerActorUIStyles = css`
  :host {
    display: block;
    position: relative;
  }

  .customer-actor {
    background: linear-gradient(135deg, rgba(34, 211, 153, 0.1) 0%, rgba(15, 17, 21, 0.9) 100%);
    border: 2px solid rgba(34, 211, 153, 0.3);
    border-radius: 16px;
    padding: 1.5rem;
    position: relative;
    transition: all 0.3s ease;
    min-height: 200px;
    color: var(--teagreen, #F5F5F5);
  }

  .customer-actor:hover {
    border-color: rgba(34, 211, 153, 0.6);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(34, 211, 153, 0.2);
  }

  .actor-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .actor-icon {
    font-size: 2.5rem;
    filter: drop-shadow(0 0 8px rgba(34, 211, 153, 0.4));
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
    color: rgba(34, 211, 153, 0.8);
    font-size: 0.9rem;
    margin: 0.25rem 0 0 0;
    font-weight: 500;
  }

  .connection-status {
    text-align: center;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 600;
    margin-bottom: 1rem;
  }

  .connection-status.connected {
    background: rgba(16, 185, 129, 0.2);
    color: rgb(16, 185, 129);
    border: 1px solid rgba(16, 185, 129, 0.3);
  }

  .connection-status.disconnected {
    background: rgba(239, 68, 68, 0.2);
    color: rgb(239, 68, 68);
    border: 1px solid rgba(239, 68, 68, 0.3);
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

  .actor-indicator.idle {
    background: #6B7280;
  }

  .actor-indicator.browsing {
    background: #F59E0B;
    animation: pulse 2s infinite;
  }

  .actor-indicator.ordering {
    background: #3B82F6;
    animation: pulse 1.5s infinite;
  }

  .actor-indicator.waiting {
    background: #EF4444;
    animation: pulse 1s infinite;
  }

  .actor-indicator.receiving {
    background: #10B981;
    animation: pulse 0.8s infinite;
  }

  .actor-indicator.enjoying {
    background: #8B5CF6;
  }

  .actor-indicator.leaving {
    background: #6B7280;
    opacity: 0.5;
  }

  @keyframes pulse {
    0%, 100% {
      transform: scale(1);
      opacity: 1;
    }
    50% {
      transform: scale(1.2);
      opacity: 0.7;
    }
  }

  .actor-state {
    background: rgba(34, 211, 153, 0.1);
    color: rgb(34, 211, 153);
    padding: 0.5rem 1rem;
    border-radius: 8px;
    font-size: 0.85rem;
    font-weight: 600;
    text-align: center;
    margin-bottom: 1rem;
    border: 1px solid rgba(34, 211, 153, 0.3);
    text-transform: capitalize;
  }

  .state-idle {
    background: rgba(107, 114, 128, 0.1);
    color: rgb(107, 114, 128);
    border-color: rgba(107, 114, 128, 0.3);
  }

  .state-browsing {
    background: rgba(245, 158, 11, 0.1);
    color: rgb(245, 158, 11);
    border-color: rgba(245, 158, 11, 0.3);
  }

  .state-ordering {
    background: rgba(59, 130, 246, 0.1);
    color: rgb(59, 130, 246);
    border-color: rgba(59, 130, 246, 0.3);
  }

  .state-waiting {
    background: rgba(239, 68, 68, 0.1);
    color: rgb(239, 68, 68);
    border-color: rgba(239, 68, 68, 0.3);
  }

  .state-receiving {
    background: rgba(16, 185, 129, 0.1);
    color: rgb(16, 185, 129);
    border-color: rgba(16, 185, 129, 0.3);
  }

  .state-enjoying {
    background: rgba(139, 92, 246, 0.1);
    color: rgb(139, 92, 246);
    border-color: rgba(139, 92, 246, 0.3);
  }

  .state-leaving {
    background: rgba(107, 114, 128, 0.1);
    color: rgb(107, 114, 128);
    border-color: rgba(107, 114, 128, 0.3);
    opacity: 0.7;
  }

  .actor-controls {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }

  .btn-toggle, .btn-disconnect {
    padding: 0.25rem 0.75rem;
    border: 1px solid rgba(34, 211, 153, 0.3);
    background: rgba(34, 211, 153, 0.1);
    color: rgb(34, 211, 153);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8rem;
    transition: all 0.2s;
  }

  .btn-disconnect {
    border-color: rgba(239, 68, 68, 0.3);
    background: rgba(239, 68, 68, 0.1);
    color: rgb(239, 68, 68);
  }

  .btn-toggle:hover, .btn-disconnect:hover {
    opacity: 0.8;
    transform: translateY(-1px);
  }

  .actor-content {
    display: grid;
    gap: 1rem;
  }

  .order-status {
    background: rgba(15, 17, 21, 0.6);
    border: 1px solid rgba(34, 211, 153, 0.2);
    border-radius: 8px;
    padding: 1rem;
  }

  .current-order {
    color: var(--teagreen, #F5F5F5);
    font-size: 0.9rem;
    line-height: 1.4;
  }

  .order-price {
    color: rgb(34, 211, 153);
    font-weight: 600;
    font-size: 1.1rem;
  }

  .no-order {
    color: rgba(107, 114, 128, 0.8);
    font-style: italic;
    text-align: center;
    padding: 0.5rem;
  }

  .actor-context {
    background: rgba(15, 17, 21, 0.6);
    border: 1px solid rgba(34, 211, 153, 0.2);
    border-radius: 8px;
    padding: 1rem;
    color: var(--teagreen, #F5F5F5);
    font-size: 0.85rem;
    line-height: 1.4;
  }

  .debug-info {
    background: rgba(107, 114, 128, 0.1);
    padding: 0.5rem;
    border-radius: 4px;
    text-align: center;
  }

  .debug-info small {
    color: rgba(107, 114, 128, 0.8);
  }

  .actor-communication {
    background: rgba(15, 17, 21, 0.4);
    border: 1px solid rgba(34, 211, 153, 0.2);
    border-radius: 8px;
    padding: 1rem;
    margin-top: 1rem;
  }

  .actor-communication h4 {
    color: rgb(34, 211, 153);
    margin: 0 0 0.5rem 0;
    font-size: 0.9rem;
  }

  .event-buttons {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .btn-event {
    padding: 0.25rem 0.5rem;
    border: 1px solid rgba(59, 130, 246, 0.3);
    background: rgba(59, 130, 246, 0.1);
    color: rgb(59, 130, 246);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.75rem;
    transition: all 0.2s;
  }

  .btn-event:hover {
    opacity: 0.8;
    transform: translateY(-1px);
  }

  @media (max-width: 768px) {
    .customer-actor {
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

    .actor-controls {
      flex-direction: column;
    }

    .event-buttons {
      flex-direction: column;
    }
  }
`;

// ✅ Create the component using the Actor-SPA framework
const CustomerActorUIComponent = createComponent({
  machine: customerActorUIMachine,
  template: customerActorUITemplate,
  styles: customerActorUIStyles,
  tagName: 'customer-actor-ui',
});

// ✅ Public API for external interactions (maintained for backward compatibility)
export const connectActor = (component: HTMLElement, actor: Actor): void => {
  const customComponent = component as HTMLElement & {
    send: (event: CustomerActorUIEvent) => void;
  };
  if (customComponent.send) {
    customComponent.send({ type: 'CONNECT_ACTOR', actor });
  }
};

export const disconnectActor = (component: HTMLElement): void => {
  const customComponent = component as HTMLElement & {
    send: (event: CustomerActorUIEvent) => void;
  };
  if (customComponent.send) {
    customComponent.send({ type: 'DISCONNECT_ACTOR' });
  }
};

export const showDetails = (component: HTMLElement, show: boolean): void => {
  const customComponent = component as HTMLElement & {
    send: (event: CustomerActorUIEvent) => void;
  };
  if (customComponent.send) {
    customComponent.send({ type: 'SHOW_DETAILS', show });
  }
};

// Export for manual registration if needed
export { CustomerActorUIComponent };
export default CustomerActorUIComponent;
export type {
  CustomerOrder,
  CustomerPreferences,
  CustomerContext,
  CustomerActorUIContext,
  CustomerActorUIEvent,
};
