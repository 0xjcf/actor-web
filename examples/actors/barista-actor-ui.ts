// BaristaActorUI refactored to use Actor-SPA Framework API
import { type SnapshotFrom, assign, setup } from 'xstate';
import { type RawHTML, createComponent, html } from '../../../framework/core/index.js';
import '../../ui/loading-state.js';

// ✅ Type-safe interfaces following framework patterns
interface CoffeeOrder {
  beverageType?: string;
  prepTime?: number;
  specialty?: string;
  size?: 'small' | 'medium' | 'large';
  extras?: string[];
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

interface BaristaContext {
  currentOrder?: CoffeeOrder;
  ordersCompleted?: number;
  beverageType?: string;
  preparationTime?: number;
  specialty?: string;
  shift?: string;
}

// ✅ State machine context interface
interface BaristaActorUIContext {
  connectedActor: Actor | null;
  actorState: string;
  actorContext: BaristaContext;
  showDetails: boolean;
  subscription: { unsubscribe(): void } | null;
  lastUpdateTime: number;
}

// ✅ Event types for type safety
type BaristaActorUIEvent =
  | { type: 'CONNECT_ACTOR'; actor: Actor }
  | { type: 'DISCONNECT_ACTOR' }
  | { type: 'TOGGLE_DETAILS' }
  | { type: 'SHOW_DETAILS'; show: boolean }
  | { type: 'UPDATE_ACTOR_STATE'; state: string; context: BaristaContext }
  | { type: 'SEND_TO_ACTOR'; event: Record<string, unknown> }
  | { type: 'START_ANIMATION' }
  | { type: 'STOP_ANIMATION' };

// ✅ Helper functions
const formatState = (state: string): string => {
  return state.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());
};

const formatContext = (context: BaristaContext): string => {
  const details = [];

  if (context.ordersCompleted !== undefined) {
    details.push(`Orders Completed: ${context.ordersCompleted}`);
  }

  if (context.specialty) {
    details.push(`Specialty: ${context.specialty}`);
  }

  if (context.preparationTime !== undefined) {
    details.push(`Prep Time: ${context.preparationTime}s`);
  }

  if (context.shift) {
    details.push(`Shift: ${context.shift}`);
  }

  return details.length > 0 ? details.join('<br>') : 'No additional details';
};

const renderOrderSpecialty = (specialty: string | undefined): RawHTML => {
  if (!specialty) return html``;
  return html`<br>Special: ${specialty}`;
};

const renderOrderExtras = (extras: string[] | undefined): RawHTML => {
  if (!extras || extras.length === 0) return html``;
  return html`<br>Extras: ${extras.join(', ')}`;
};

const formatBrewingStatus = (context: BaristaContext): RawHTML => {
  if (context.currentOrder) {
    const order = context.currentOrder;
    return html`
      <div class="current-brewing">
        <strong>Now Brewing:</strong><br>
        ${order.beverageType || 'Coffee'}<br>
        <span class="brewing-time">Est. ${order.prepTime || 180}s</span>
        ${renderOrderSpecialty(order.specialty)}
        ${renderOrderExtras(order.extras)}
      </div>
    `;
  }
  return html`<div class="no-brewing">Ready to brew</div>`;
};

const getIndicatorClass = (state: string): string => {
  const stateClasses: { [key: string]: string } = {
    idle: 'idle',
    preparing: 'preparing',
    grinding: 'grinding',
    brewing: 'brewing',
    steaming: 'steaming',
    finishing: 'finishing',
    complete: 'complete',
  };

  return stateClasses[state] || 'unknown';
};

// ✅ XState machine for component state management
const baristaActorUIMachine = setup({
  types: {
    context: {} as BaristaActorUIContext,
    events: {} as BaristaActorUIEvent,
  },
  actions: {
    connectActor: assign({
      connectedActor: ({ event }) => (event.type === 'CONNECT_ACTOR' ? event.actor : null),
      actorState: ({ event }) =>
        event.type === 'CONNECT_ACTOR' ? event.actor.getSnapshot().value : 'idle',
      actorContext: ({ event }) =>
        event.type === 'CONNECT_ACTOR' ? (event.actor.getSnapshot().context as BaristaContext) : {},
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
  id: 'baristaActorUI',
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
      initial: 'idle',
      on: {
        DISCONNECT_ACTOR: { target: 'disconnected', actions: 'disconnectActor' },
        UPDATE_ACTOR_STATE: { actions: 'updateActorState' },
        SEND_TO_ACTOR: { actions: 'sendToActor' },
        TOGGLE_DETAILS: { actions: 'toggleDetails' },
        SHOW_DETAILS: { actions: 'showDetails' },
      },
      states: {
        idle: {
          on: {
            START_ANIMATION: 'animating',
          },
        },
        animating: {
          on: {
            STOP_ANIMATION: 'idle',
          },
        },
      },
    },
  },
});

// ✅ Pure template function using framework patterns
const renderConnectionStatus = (state: string | object): RawHTML => {
  const isConnected = typeof state === 'string' ? state !== 'disconnected' : 'connected' in state;
  return html`
    <div class="connection-status ${isConnected ? 'connected' : 'disconnected'}">
      ${isConnected ? '🟢 Connected' : '🔴 Disconnected'}
    </div>
  `;
};

const renderDisconnectButton = (state: string | object): RawHTML => {
  if (typeof state === 'string' ? state === 'disconnected' : !('connected' in state)) return html``;
  return html`
    <button send="DISCONNECT_ACTOR" class="btn-disconnect">
      Disconnect Actor
    </button>
  `;
};

const renderActorHeader = (actorState: string): RawHTML => html`
  <div class="actor-header">
    <div class="actor-icon">☕</div>
    <div class="actor-title">
      <h3 class="actor-name">Barista</h3>
      <p class="actor-role">Crafts coffee beverages with expertise</p>
    </div>
    <div class="actor-indicator ${getIndicatorClass(actorState)}"></div>
  </div>
`;

const renderActorState = (actorState: string): RawHTML => html`
  <div class="actor-state state-${actorState.replace(/\./g, '-')}">
    ${formatState(actorState)}
  </div>
`;

// Extract details section rendering
const renderDetailsSection = (
  showDetails: boolean,
  actorContext: BaristaContext,
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

// Extract equipment item rendering
const renderEquipmentItem = (name: string, actorState: string, activeStates: string[]): RawHTML => {
  const isActive = activeStates.includes(actorState);
  return html`
    <div class="equipment-item">
      <span class="equipment-name">${name}</span>
      <span class="equipment-indicator ${isActive ? 'active' : 'idle'}"></span>
    </div>
  `;
};

// Extract equipment status section
const renderEquipmentStatus = (actorState: string): RawHTML => html`
  <div class="equipment-status">
    <h4>Equipment Status</h4>
    <div class="equipment-grid">
      ${renderEquipmentItem('Grinder', actorState, ['grinding'])}
      ${renderEquipmentItem('Espresso Machine', actorState, ['brewing'])}
      ${renderEquipmentItem('Steam Wand', actorState, ['steaming'])}
    </div>
  </div>
`;

// Extract event button rendering
const renderEventButton = (eventType: string, label: string): RawHTML => html`
  <button send="SEND_TO_ACTOR" event=${{ type: eventType }} class="btn-event">
    ${label}
  </button>
`;

// Extract actor communication section
const renderActorCommunication = (state: string | object): RawHTML => {
  if (typeof state === 'string' ? state === 'disconnected' : !('connected' in state)) return html``;

  return html`
    <div class="actor-communication">
      <h4>Send Events to Actor:</h4>
      <div class="event-buttons">
        ${renderEventButton('START_BREWING', 'Start Brewing')}
        ${renderEventButton('FINISH_ORDER', 'Finish Order')}
        ${renderEventButton('CLEAN_EQUIPMENT', 'Clean Equipment')}
      </div>
    </div>
  `;
};

// Extract controls rendering
const renderAnimationButton = (state: string | object): RawHTML => {
  const isAnimating =
    typeof state === 'string'
      ? state.includes('animating')
      : 'connected' in state &&
        typeof state.connected === 'string' &&
        state.connected.includes('animating');
  return html`
    <button send="${isAnimating ? 'STOP_ANIMATION' : 'START_ANIMATION'}" class="btn-animation">
      ${isAnimating ? 'Stop Brewing Animation' : 'Start Brewing Animation'}
    </button>
  `;
};

const renderToggleDetailsButton = (showDetails: boolean): RawHTML => html`
  <button send="TOGGLE_DETAILS" class="btn-toggle">
    ${showDetails ? 'Hide Details' : 'Show Details'}
  </button>
`;

const renderActorControls = (showDetails: boolean, state: string | object): RawHTML => html`
  <div class="actor-controls">
    ${renderToggleDetailsButton(showDetails)}
    ${renderDisconnectButton(state)}
    ${renderAnimationButton(state)}
  </div>
`;

const renderActorContent = (
  actorState: string,
  actorContext: BaristaContext,
  showDetails: boolean,
  lastUpdateTime: number
): RawHTML => html`
  <div class="actor-content">
    <!-- Brewing Status -->
    <div class="brewing-status">
      ${formatBrewingStatus(actorContext)}
    </div>

    <!-- Equipment Status -->
    ${renderEquipmentStatus(actorState)}

    <!-- Details -->
    ${renderDetailsSection(showDetails, actorContext, lastUpdateTime)}
  </div>
`;

const baristaActorUITemplate = (state: SnapshotFrom<typeof baristaActorUIMachine>): RawHTML => {
  const { actorState, actorContext, showDetails, lastUpdateTime } = state.context;
  const isAnimating = state.matches({ connected: 'animating' });

  return html`
    <div class="barista-actor ${isAnimating ? 'animating' : ''}">
      ${renderActorHeader(actorState)}
      ${renderConnectionStatus(state.value)}
      ${renderActorState(actorState)}
      ${renderActorControls(showDetails, state.value)}
      ${renderActorContent(actorState, actorContext, showDetails, lastUpdateTime)}
      ${renderActorCommunication(state.value)}
    </div>
  `;
};

// ✅ Component styles using framework patterns
const baristaActorUIStyles = `
  :host {
    display: block;
    position: relative;
  }

  .barista-actor {
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(15, 17, 21, 0.9) 100%);
    border: 2px solid rgba(139, 92, 246, 0.3);
    border-radius: 16px;
    padding: 1.5rem;
    position: relative;
    transition: all 0.3s ease;
    min-height: 200px;
    color: var(--teagreen, #F5F5F5);
  }

  .barista-actor:hover {
    border-color: rgba(139, 92, 246, 0.6);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(139, 92, 246, 0.2);
  }

  .barista-actor.animating {
    animation: brewingGlow 2s ease-in-out infinite alternate;
  }

  @keyframes brewingGlow {
    0% {
      box-shadow: 0 8px 24px rgba(139, 92, 246, 0.2);
    }
    100% {
      box-shadow: 0 8px 32px rgba(139, 92, 246, 0.4);
    }
  }

  .actor-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .actor-icon {
    font-size: 2.5rem;
    filter: drop-shadow(0 0 8px rgba(139, 92, 246, 0.4));
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
    color: rgba(139, 92, 246, 0.8);
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

  .actor-indicator.idle {
    background: #6B7280;
  }

  .actor-indicator.preparing {
    background: #F59E0B;
    animation: pulse 2s infinite;
  }

  .actor-indicator.grinding {
    background: #EF4444;
    animation: pulse 1s infinite;
  }

  .actor-indicator.brewing {
    background: #3B82F6;
    animation: pulse 1.5s infinite;
  }

  .actor-indicator.steaming {
    background: #F97316;
    animation: pulse 1.2s infinite;
  }

  .actor-indicator.finishing {
    background: #8B5CF6;
    animation: pulse 0.8s infinite;
  }

  .actor-indicator.complete {
    background: #10B981;
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
    background: rgba(139, 92, 246, 0.1);
    color: rgb(139, 92, 246);
    padding: 0.5rem 1rem;
    border-radius: 8px;
    font-size: 0.85rem;
    font-weight: 600;
    text-align: center;
    margin-bottom: 1rem;
    border: 1px solid rgba(139, 92, 246, 0.3);
    text-transform: capitalize;
  }

  .actor-controls {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }

  .btn-toggle, .btn-disconnect, .btn-animation {
    padding: 0.25rem 0.75rem;
    border: 1px solid rgba(139, 92, 246, 0.3);
    background: rgba(139, 92, 246, 0.1);
    color: rgb(139, 92, 246);
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

  .btn-animation {
    border-color: rgba(245, 158, 11, 0.3);
    background: rgba(245, 158, 11, 0.1);
    color: rgb(245, 158, 11);
  }

  .btn-toggle:hover, .btn-disconnect:hover, .btn-animation:hover {
    opacity: 0.8;
    transform: translateY(-1px);
  }

  .actor-content {
    display: grid;
    gap: 1rem;
  }

  .brewing-status {
    background: rgba(15, 17, 21, 0.6);
    border: 1px solid rgba(139, 92, 246, 0.2);
    border-radius: 8px;
    padding: 1rem;
  }

  .current-brewing {
    color: var(--teagreen, #F5F5F5);
    font-size: 0.9rem;
    line-height: 1.4;
  }

  .brewing-time {
    color: rgb(139, 92, 246);
    font-weight: 600;
    font-size: 1.1rem;
  }

  .no-brewing {
    color: rgba(107, 114, 128, 0.8);
    font-style: italic;
    text-align: center;
    padding: 0.5rem;
  }

  .equipment-status {
    background: rgba(15, 17, 21, 0.6);
    border: 1px solid rgba(139, 92, 246, 0.2);
    border-radius: 8px;
    padding: 1rem;
  }

  .equipment-status h4 {
    color: rgb(139, 92, 246);
    margin: 0 0 0.5rem 0;
    font-size: 0.9rem;
  }

  .equipment-grid {
    display: grid;
    gap: 0.5rem;
  }

  .equipment-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
  }

  .equipment-name {
    font-size: 0.85rem;
    color: var(--teagreen, #F5F5F5);
  }

  .equipment-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #6B7280;
    transition: all 0.3s ease;
  }

  .equipment-indicator.active {
    background: #10B981;
    box-shadow: 0 0 8px rgba(16, 185, 129, 0.4);
  }

  .actor-context {
    background: rgba(15, 17, 21, 0.6);
    border: 1px solid rgba(139, 92, 246, 0.2);
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
    border: 1px solid rgba(139, 92, 246, 0.2);
    border-radius: 8px;
    padding: 1rem;
    margin-top: 1rem;
  }

  .actor-communication h4 {
    color: rgb(139, 92, 246);
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
    .barista-actor {
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
const BaristaActorUIComponent = createComponent({
  machine: baristaActorUIMachine,
  template: baristaActorUITemplate,
  styles: baristaActorUIStyles,
  tagName: 'barista-actor-ui',
});

// ✅ Public API for external interactions (maintained for backward compatibility)
export const connectActor = (component: HTMLElement, actor: Actor): void => {
  const customComponent = component as HTMLElement & { send: (event: BaristaActorUIEvent) => void };
  if (customComponent.send) {
    customComponent.send({ type: 'CONNECT_ACTOR', actor });
  }
};

export const disconnectActor = (component: HTMLElement): void => {
  const customComponent = component as HTMLElement & { send: (event: BaristaActorUIEvent) => void };
  if (customComponent.send) {
    customComponent.send({ type: 'DISCONNECT_ACTOR' });
  }
};

export const showDetails = (component: HTMLElement, show: boolean): void => {
  const customComponent = component as HTMLElement & { send: (event: BaristaActorUIEvent) => void };
  if (customComponent.send) {
    customComponent.send({ type: 'SHOW_DETAILS', show });
  }
};

// Export for manual registration if needed
export { BaristaActorUIComponent };
export default BaristaActorUIComponent;
export type { CoffeeOrder, BaristaContext, BaristaActorUIContext, BaristaActorUIEvent };
