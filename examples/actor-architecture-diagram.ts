// ActorArchitectureDiagram refactored to use Actor-SPA Framework API
import { assign, type SnapshotFrom, setup } from 'xstate';
import { createComponent, css, html, type RawHTML } from '../../framework/core/index.js';

// ✅ Type-safe interfaces following framework patterns
interface ActorNode {
  id: string;
  name: string;
  type: 'customer' | 'cashier' | 'barista' | 'orchestrator';
  position: { x: number; y: number };
  state: string;
  description: string;
}

interface MessageFlow {
  from: string;
  to: string;
  message: string;
  type: 'event' | 'command' | 'response';
  timestamp: number;
}

interface DiagramConfig {
  showAnimation?: boolean;
  interactiveMode?: boolean;
  showMessages?: boolean;
  autoPlay?: boolean;
}

interface DiagramContext {
  config: DiagramConfig;
  actors: ActorNode[];
  activeMessages: MessageFlow[];
  currentStep: number;
  highlightedActor: string | null;
}

type DiagramEvents =
  | { type: 'PLAY_ANIMATION' }
  | { type: 'PAUSE_ANIMATION' }
  | { type: 'RESET_ANIMATION' }
  | { type: 'NEXT_STEP' }
  | { type: 'HIGHLIGHT_ACTOR'; actorId: string }
  | { type: 'ANIMATION_COMPLETE' }
  | { type: 'UPDATE_CONFIG'; config: Partial<DiagramConfig> };

// ✅ XState machine for diagram state management
const diagramMachine = setup({
  types: {
    context: {} as DiagramContext,
    events: {} as DiagramEvents,
  },
  actions: {
    startAnimation: assign({
      currentStep: 0,
      activeMessages: [],
    }),
    pauseAnimation: assign({
      activeMessages: [],
    }),
    resetAnimation: assign({
      currentStep: 0,
      activeMessages: [],
      highlightedActor: null,
      actors: ({ context }) =>
        context.actors.map((actor) => ({
          ...actor,
          state: actor.id === 'orchestrator' ? 'coordinating' : 'idle',
        })),
    }),
    nextStep: assign({
      currentStep: ({ context }) => context.currentStep + 1,
      activeMessages: ({ context }) => {
        const messageSequence = getMessageSequence();
        const currentMessage = messageSequence[context.currentStep];
        return currentMessage ? [currentMessage] : [];
      },
    }),
    highlightActor: assign({
      highlightedActor: ({ event }) => (event.type === 'HIGHLIGHT_ACTOR' ? event.actorId : null),
      actors: ({ event, context }) =>
        event.type === 'HIGHLIGHT_ACTOR'
          ? context.actors.map((actor) => ({
              ...actor,
              state:
                actor.id === event.actorId
                  ? 'active'
                  : actor.id === 'orchestrator'
                    ? 'coordinating'
                    : 'idle',
            }))
          : context.actors,
    }),
    completeAnimation: assign({
      activeMessages: [],
      currentStep: 0,
    }),
    updateConfig: assign({
      config: ({ event, context }) =>
        event.type === 'UPDATE_CONFIG' ? { ...context.config, ...event.config } : context.config,
    }),
  },
}).createMachine({
  id: 'actor-architecture-diagram',
  initial: 'idle',
  context: {
    config: {
      showAnimation: true,
      interactiveMode: true,
      showMessages: true,
      autoPlay: false,
    },
    actors: [
      {
        id: 'customer',
        name: 'Customer',
        type: 'customer',
        position: { x: 100, y: 50 },
        state: 'idle',
        description: 'Initiates orders and receives coffee',
      },
      {
        id: 'cashier',
        name: 'Cashier',
        type: 'cashier',
        position: { x: 300, y: 50 },
        state: 'idle',
        description: 'Processes orders and handles payments',
      },
      {
        id: 'orchestrator',
        name: 'Orchestrator',
        type: 'orchestrator',
        position: { x: 300, y: 150 },
        state: 'coordinating',
        description: 'Coordinates between actors and manages workflow',
      },
      {
        id: 'barista',
        name: 'Barista',
        type: 'barista',
        position: { x: 500, y: 150 },
        state: 'idle',
        description: 'Prepares coffee and manages brewing equipment',
      },
    ],
    activeMessages: [],
    currentStep: 0,
    highlightedActor: null,
  },
  states: {
    idle: {
      on: {
        PLAY_ANIMATION: { target: 'animating', actions: 'startAnimation' },
        HIGHLIGHT_ACTOR: { actions: 'highlightActor' },
        UPDATE_CONFIG: { actions: 'updateConfig' },
      },
    },
    animating: {
      after: {
        1000: [
          {
            target: 'animating',
            actions: 'nextStep',
            guard: ({ context }) => context.currentStep < getMessageSequence().length - 1,
          },
          {
            target: 'idle',
            actions: 'completeAnimation',
          },
        ],
      },
      on: {
        PAUSE_ANIMATION: { target: 'paused', actions: 'pauseAnimation' },
        RESET_ANIMATION: { target: 'idle', actions: 'resetAnimation' },
      },
    },
    paused: {
      on: {
        PLAY_ANIMATION: 'animating',
        RESET_ANIMATION: { target: 'idle', actions: 'resetAnimation' },
      },
    },
  },
});

// ✅ Helper functions (pure functions)
function getMessageSequence(): MessageFlow[] {
  return [
    { from: 'customer', to: 'cashier', message: 'ORDER', type: 'event', timestamp: Date.now() },
    {
      from: 'cashier',
      to: 'orchestrator',
      message: 'PROCESS_ORDER',
      type: 'command',
      timestamp: Date.now(),
    },
    {
      from: 'orchestrator',
      to: 'barista',
      message: 'PREPARE_COFFEE',
      type: 'command',
      timestamp: Date.now(),
    },
    {
      from: 'barista',
      to: 'orchestrator',
      message: 'COFFEE_READY',
      type: 'response',
      timestamp: Date.now(),
    },
    {
      from: 'orchestrator',
      to: 'customer',
      message: 'ORDER_COMPLETE',
      type: 'response',
      timestamp: Date.now(),
    },
  ];
}

// ✅ Template components (extracted for better organization)
const actorNode = (actor: ActorNode): RawHTML => html`
  <g class="actor-node" send="HIGHLIGHT_ACTOR" actor-id=${actor.id}>
    <circle 
      class="actor-circle ${actor.state === 'active' ? 'active' : ''}"
      cx=${actor.position.x} 
      cy=${actor.position.y} 
      r="30"
    />
    <text 
      class="actor-text" 
      x=${actor.position.x} 
      y=${actor.position.y - 5}
    >
      ${actor.name}
    </text>
    <text 
      class="actor-state" 
      x=${actor.position.x} 
      y=${actor.position.y + 8}
    >
      ${actor.state}
    </text>
  </g>
`;

const messageLine = (message: MessageFlow, actors: ActorNode[], isActive: boolean): RawHTML => {
  const fromActor = actors.find((a) => a.id === message.from);
  const toActor = actors.find((a) => a.id === message.to);

  if (!fromActor || !toActor) return html``;

  return html`
    <line 
      class="message-line ${isActive ? 'active' : ''}"
      x1=${fromActor.position.x} 
      y1=${fromActor.position.y} 
      x2=${toActor.position.x} 
      y2=${toActor.position.y}
    />
  `;
};

const messageText = (message: MessageFlow, actors: ActorNode[], isActive: boolean): RawHTML => {
  const fromActor = actors.find((a) => a.id === message.from);
  const toActor = actors.find((a) => a.id === message.to);

  if (!fromActor || !toActor) return html``;

  const midX = (fromActor.position.x + toActor.position.x) / 2;
  const midY = (fromActor.position.y + toActor.position.y) / 2 - 10;

  return html`
    <text 
      class="message-text ${isActive && 'active'}"
      x=${midX} 
      y=${midY}
    >
      ${message.message}
    </text>
  `;
};

const legendItem = (actor: ActorNode): RawHTML => html`
  <div class="legend-item">
    <div class="legend-title">${actor.name}</div>
    <div class="legend-description">${actor.description}</div>
  </div>
`;

// Helper templates to fix nesting violations
const renderDiagramControls = (isAnimating: boolean, isPaused: boolean): RawHTML => html`
  <div class="diagram-controls">
    <button 
      class="control-button" 
      send="PLAY_ANIMATION" 
      ${isAnimating ? 'disabled' : ''}
    >
      ${isPaused ? 'Resume' : 'Play Animation'}
    </button>
    <button 
      class="control-button" 
      send="PAUSE_ANIMATION" 
      ${!isAnimating ? 'disabled' : ''}
    >
      Pause
    </button>
    <button 
      class="control-button" 
      send="RESET_ANIMATION"
    >
      Reset
    </button>
  </div>
`;

const renderMessageLines = (
  messageSequence: MessageFlow[],
  actors: ActorNode[],
  activeMessages: MessageFlow[]
): RawHTML => html`
  ${messageSequence.map((message) => {
    const isActive = activeMessages.some(
      (activeMsg) => activeMsg.from === message.from && activeMsg.to === message.to
    );
    return messageLine(message, actors, isActive);
  })}
`;

const renderActorNodes = (actors: ActorNode[]): RawHTML => html`
  ${actors.map((actor) => actorNode(actor))}
`;

const renderMessageTexts = (
  messageSequence: MessageFlow[],
  actors: ActorNode[],
  activeMessages: MessageFlow[]
): RawHTML => html`
  ${messageSequence.map((message) => {
    const isActive = activeMessages.some(
      (activeMsg) => activeMsg.from === message.from && activeMsg.to === message.to
    );
    return messageText(message, actors, isActive);
  })}
`;

// ✅ Pure template function using framework html``
const diagramTemplate = (state: SnapshotFrom<typeof diagramMachine>): RawHTML => {
  const { config, actors, activeMessages } = state.context;
  const messageSequence = getMessageSequence();

  return html`
    <div class="diagram-container">
      <div class="diagram-header">
        <h2 class="diagram-title">🏗️ Actor Architecture</h2>
        <p class="diagram-subtitle">Visual representation of actor communication patterns</p>
      </div>
      
      ${config.interactiveMode ? renderDiagramControls(state.matches('animating'), state.matches('paused')) : ''}
      
      <div class="svg-container">
        <svg class="diagram-svg" viewBox="0 0 600 250">
          <!-- Background grid -->
          <defs>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(13, 153, 255, 0.1)" stroke-width="0.5"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
          
          <!-- Message lines -->
          ${renderMessageLines(messageSequence, actors, activeMessages)}
          
          <!-- Actor nodes -->
          ${renderActorNodes(actors)}
          
          <!-- Message text -->
          ${renderMessageTexts(messageSequence, actors, activeMessages)}
          })}
        </svg>
      </div>
      
      <div class="legend">
        ${actors.map((actor) => legendItem(actor))}
      </div>
      
      <div class="educational-note">
        <h3>Actor Model Benefits</h3>
        <p>
          Each actor operates independently with its own state and mailbox. 
          Communication happens only through message passing, creating a 
          loosely coupled, resilient system that's easy to reason about and test.
        </p>
      </div>
    </div>
  `;
};

// ✅ Static styles (keeping the existing comprehensive styles)
const diagramStyles = css`
  :host {
    display: block;
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  
  .diagram-container {
    background: rgba(15, 17, 21, 0.95);
    border: 1px solid rgba(13, 153, 255, 0.2);
    border-radius: 16px;
    padding: 2rem;
    margin: 2rem 0;
  }
  
  .diagram-header {
    text-align: center;
    margin-bottom: 2rem;
  }
  
  .diagram-title {
    color: var(--jasper, #0D99FF);
    font-size: 1.8rem;
    font-weight: 700;
    margin: 0 0 0.5rem 0;
  }
  
  .diagram-subtitle {
    color: var(--teagreen, #F5F5F5);
    font-size: 1rem;
    margin: 0;
    opacity: 0.9;
  }
  
  .diagram-controls {
    display: flex;
    justify-content: center;
    gap: 1rem;
    margin-bottom: 2rem;
    flex-wrap: wrap;
  }
  
  .control-button {
    background: linear-gradient(135deg, var(--jasper, #0D99FF), #47B4FF);
    color: white;
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    min-width: 120px;
  }
  
  .control-button:hover:not([disabled]) {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(13, 153, 255, 0.4);
  }
  
  .control-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }
  
  .svg-container {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(13, 153, 255, 0.1);
    border-radius: 12px;
    padding: 1rem;
    margin-bottom: 2rem;
    height: 300px;
    overflow: hidden;
  }
  
  .diagram-svg {
    width: 100%;
    height: 100%;
  }
  
  .actor-node {
    cursor: pointer;
    transition: all 0.3s ease;
  }
  
  .actor-node:hover .actor-circle {
    r: 35;
    stroke-width: 3;
  }
  
  .actor-circle {
    fill: rgba(13, 153, 255, 0.2);
    stroke: var(--jasper, #0D99FF);
    stroke-width: 2;
    transition: all 0.3s ease;
  }
  
  .actor-circle.active {
    fill: rgba(13, 153, 255, 0.4);
    stroke-width: 3;
    r: 35;
  }
  
  .actor-text {
    fill: var(--teagreen, #F5F5F5);
    font-size: 12px;
    font-weight: 600;
    text-anchor: middle;
    dominant-baseline: central;
  }
  
  .actor-state {
    fill: var(--jasper-light, #47B4FF);
    font-size: 10px;
    text-anchor: middle;
    dominant-baseline: central;
  }
  
  .message-line {
    stroke: var(--jasper, #0D99FF);
    stroke-width: 2;
    stroke-dasharray: 5,5;
    fill: none;
    opacity: 0;
    transition: opacity 0.5s ease;
  }
  
  .message-line.active {
    opacity: 1;
    animation: dash 2s linear infinite;
  }
  
  @keyframes dash {
    0% { stroke-dashoffset: 10; }
    100% { stroke-dashoffset: 0; }
  }
  
  .message-text {
    fill: var(--jasper-light, #47B4FF);
    font-size: 10px;
    font-weight: 500;
    text-anchor: middle;
    opacity: 0;
    transition: opacity 0.5s ease;
  }
  
  .message-text.active {
    opacity: 1;
  }
  
  .legend {
    margin-top: 1.5rem;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
  }
  
  .legend-item {
    background: rgba(13, 153, 255, 0.08);
    border: 1px solid rgba(13, 153, 255, 0.2);
    border-radius: 8px;
    padding: 1rem;
    text-align: center;
  }
  
  .legend-title {
    color: var(--jasper-light, #47B4FF);
    font-size: 0.9rem;
    font-weight: 600;
    margin: 0 0 0.5rem 0;
  }
  
  .legend-description {
    color: var(--teagreen, #F5F5F5);
    font-size: 0.8rem;
    margin: 0;
    opacity: 0.9;
    line-height: 1.4;
  }
  
  .educational-note {
    background: rgba(13, 153, 255, 0.08);
    border: 1px solid rgba(13, 153, 255, 0.2);
    border-radius: 12px;
    padding: 1.5rem;
    margin-top: 2rem;
    position: relative;
  }
  
  .educational-note::before {
    content: '🏗️';
    position: absolute;
    top: 1rem;
    left: 1rem;
    font-size: 1.5rem;
  }
  
  .educational-note h3 {
    color: var(--jasper, #0D99FF);
    margin: 0 0 1rem 2.5rem;
    font-size: 1.1rem;
  }
  
  .educational-note p {
    color: var(--teagreen, #F5F5F5);
    margin: 0 0 0 2.5rem;
    line-height: 1.6;
    opacity: 0.95;
  }
  
  @media (max-width: 768px) {
    .svg-container {
      height: 250px;
    }
    
    .diagram-controls {
      flex-direction: column;
      align-items: center;
    }
    
    .control-button {
      width: 200px;
    }
  }
`;

// ✅ Create the component using framework API
const ActorArchitectureDiagramComponent = createComponent({
  machine: diagramMachine,
  template: diagramTemplate,
  styles: diagramStyles,
  tagName: 'actor-architecture-diagram', // Maintain compatibility
});

// ✅ Export the component class for programmatic access
export default ActorArchitectureDiagramComponent;

// ✅ Export types for external use
export type { ActorNode, MessageFlow, DiagramConfig, DiagramContext, DiagramEvents };

// ✅ Usage Examples:
//
// 1. Basic usage (registered as <actor-architecture-diagram>):
//    <actor-architecture-diagram></actor-architecture-diagram>
//
// 2. Programmatic usage:
//    const diagram = new ActorArchitectureDiagramComponent();
//    document.body.appendChild(diagram);
//
//    // Control animation
//    diagram.send({ type: 'PLAY_ANIMATION' });
//    diagram.send({ type: 'PAUSE_ANIMATION' });
//    diagram.send({ type: 'RESET_ANIMATION' });
//
//    // Highlight specific actors
//    diagram.send({ type: 'HIGHLIGHT_ACTOR', actorId: 'customer' });
//
//    // Update configuration
//    diagram.send({
//      type: 'UPDATE_CONFIG',
//      config: {
//        interactiveMode: false,
//        autoPlay: true
//      }
//    });
//
// Benefits of the new approach:
// ✅ No DOM queries - everything is reactive through state
// ✅ Declarative event handling with framework send attributes
// ✅ Type-safe state management with XState
// ✅ Automatic animation timing with XState delayed transitions
// ✅ Pure template functions with automatic XSS protection
// ✅ Better testability with isolated state machine logic
// ✅ Consistent API with other framework components
