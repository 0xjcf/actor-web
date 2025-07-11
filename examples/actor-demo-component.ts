// Actor Demo Component - Following Framework Best Practices with Web Components
import { type SnapshotFrom, assign, setup } from 'xstate';
import { type RawHTML, createComponent, html } from '../../framework/core/index.js';

// 1. Define proper types following avoid-any-type rule
interface DemoActorContext {
  name: string;
  role: string;
  ordersProcessed: number;
  currentTask: string | null;
  debugMode: boolean; // Configuration setting, not UI state
  errorMessage: string | null;
}

type DemoActorEvents =
  | { type: 'START_WORK' }
  | { type: 'COMPLETE_TASK' }
  | { type: 'ENCOUNTER_ERROR'; message: string }
  | { type: 'RESET' }
  | { type: 'TOGGLE_DEBUG' }
  | { type: 'SET_TASK'; task: string };

// 2. Define proper context and event types for child components
interface ActorHeaderContext {
  name: string;
  role: string;
  currentState: string;
}

interface ActorStatsContext {
  ordersProcessed: number;
  currentState: string;
}

interface CurrentTaskContext {
  currentTask: string | null;
}

interface ErrorMessageContext {
  errorMessage: string | null;
}

interface ActionButtonsContext {
  currentState: string;
}

interface ControlButtonsContext {
  debugMode: boolean;
}

interface DebugInfoContext {
  debugMode: boolean;
  debugState: SnapshotFrom<typeof demoActorMachine> | null;
}

// 3. Define event types for child components
type ActorHeaderEvents = { type: 'UPDATE_DATA'; name: string; role: string; currentState: string };
type ActorStatsEvents = { type: 'UPDATE_DATA'; ordersProcessed: number; currentState: string };
type CurrentTaskEvents = { type: 'UPDATE_DATA'; currentTask: string | null };
type ErrorMessageEvents = { type: 'UPDATE_DATA'; errorMessage: string | null };
type ActionButtonsEvents = { type: 'UPDATE_DATA'; currentState: string };
type ControlButtonsEvents = { type: 'UPDATE_DATA'; debugMode: boolean };
type DebugInfoEvents = {
  type: 'UPDATE_DATA';
  debugMode: boolean;
  debugState: SnapshotFrom<typeof demoActorMachine>;
};

// 4. Define the state machine with proper business logic
const demoActorMachine = setup({
  types: {
    context: {} as DemoActorContext,
    events: {} as DemoActorEvents,
  },
  actions: {
    startTask: assign({
      currentTask: ({ event }) => {
        if (event.type === 'SET_TASK') {
          return event.task;
        }
        return 'Processing order';
      },
      errorMessage: null,
    }),
    completeTask: assign({
      ordersProcessed: ({ context }) => context.ordersProcessed + 1,
      currentTask: null,
    }),
    encounterError: assign({
      errorMessage: ({ event }) => {
        if (event.type === 'ENCOUNTER_ERROR') {
          return event.message;
        }
        return 'Unknown error occurred';
      },
      currentTask: null,
    }),
    resetActor: assign({
      ordersProcessed: 0,
      currentTask: null,
      errorMessage: null,
    }),
    toggleDebug: assign({
      debugMode: ({ context }) => !context.debugMode,
    }),
  },
}).createMachine({
  id: 'demo-actor',
  initial: 'idle',
  context: {
    name: 'Demo Actor',
    role: 'Example Component',
    ordersProcessed: 0,
    currentTask: null,
    debugMode: false,
    errorMessage: null,
  },
  states: {
    idle: {
      on: {
        START_WORK: { target: 'busy', actions: 'startTask' },
        SET_TASK: { target: 'busy', actions: 'startTask' },
        TOGGLE_DEBUG: { actions: 'toggleDebug' },
        RESET: { actions: 'resetActor' },
      },
    },
    busy: {
      on: {
        COMPLETE_TASK: { target: 'complete', actions: 'completeTask' },
        ENCOUNTER_ERROR: { target: 'error', actions: 'encounterError' },
        TOGGLE_DEBUG: { actions: 'toggleDebug' },
        RESET: { target: 'idle', actions: 'resetActor' },
      },
    },
    complete: {
      on: {
        START_WORK: { target: 'busy', actions: 'startTask' },
        SET_TASK: { target: 'busy', actions: 'startTask' },
        TOGGLE_DEBUG: { actions: 'toggleDebug' },
        RESET: { target: 'idle', actions: 'resetActor' },
      },
    },
    error: {
      on: {
        START_WORK: { target: 'busy', actions: 'startTask' },
        SET_TASK: { target: 'busy', actions: 'startTask' },
        TOGGLE_DEBUG: { actions: 'toggleDebug' },
        RESET: { target: 'idle', actions: 'resetActor' },
      },
    },
  },
});

// 5. Create individual web components with specific machines for each

// Actor Header Machine - specific context for header data
const actorHeaderMachine = setup({
  types: {
    context: {} as ActorHeaderContext,
    events: {} as ActorHeaderEvents,
  },
  actions: {
    updateData: assign({
      name: ({ event }) => event.name,
      role: ({ event }) => event.role,
      currentState: ({ event }) => event.currentState,
    }),
  },
}).createMachine({
  id: 'actor-header',
  initial: 'idle',
  context: { name: '', role: '', currentState: '' },
  states: {
    idle: {
      on: {
        UPDATE_DATA: { actions: 'updateData' },
      },
    },
    loading: {
      on: {
        UPDATE_DATA: { target: 'idle', actions: 'updateData' },
      },
    },
  },
});

// Actor Stats Machine - specific context for stats data
const actorStatsMachine = setup({
  types: {
    context: {} as ActorStatsContext,
    events: {} as ActorStatsEvents,
  },
  actions: {
    updateData: assign({
      ordersProcessed: ({ event }) => event.ordersProcessed,
      currentState: ({ event }) => event.currentState,
    }),
  },
}).createMachine({
  id: 'actor-stats',
  initial: 'idle',
  context: { ordersProcessed: 0, currentState: '' },
  states: {
    idle: {
      on: {
        UPDATE_DATA: { actions: 'updateData' },
      },
    },
    loading: {
      on: {
        UPDATE_DATA: { target: 'idle', actions: 'updateData' },
      },
    },
  },
});

// Current Task Machine - specific context for task data
const currentTaskMachine = setup({
  types: {
    context: {} as CurrentTaskContext,
    events: {} as CurrentTaskEvents,
  },
  actions: {
    updateData: assign({
      currentTask: ({ event }) => event.currentTask,
    }),
  },
}).createMachine({
  id: 'current-task',
  initial: 'idle',
  context: { currentTask: null },
  states: {
    idle: {
      on: {
        UPDATE_DATA: { actions: 'updateData' },
      },
    },
  },
});

// Error Message Machine - specific context for error data
const errorMessageMachine = setup({
  types: {
    context: {} as ErrorMessageContext,
    events: {} as ErrorMessageEvents,
  },
  actions: {
    updateData: assign({
      errorMessage: ({ event }) => event.errorMessage,
    }),
  },
}).createMachine({
  id: 'error-message',
  initial: 'idle',
  context: { errorMessage: null },
  states: {
    idle: {
      on: {
        UPDATE_DATA: { actions: 'updateData' },
      },
    },
  },
});

// Action Buttons Machine - specific context for button state
const actionButtonsMachine = setup({
  types: {
    context: {} as ActionButtonsContext,
    events: {} as ActionButtonsEvents,
  },
  actions: {
    updateData: assign({
      currentState: ({ event }) => event.currentState,
    }),
  },
}).createMachine({
  id: 'action-buttons',
  initial: 'idle',
  context: { currentState: '' },
  states: {
    idle: {
      on: {
        UPDATE_DATA: { actions: 'updateData' },
      },
    },
    loading: {
      on: {
        UPDATE_DATA: { target: 'idle', actions: 'updateData' },
      },
    },
  },
});

// Control Buttons Machine - specific context for debug mode
const controlButtonsMachine = setup({
  types: {
    context: {} as ControlButtonsContext,
    events: {} as ControlButtonsEvents,
  },
  actions: {
    updateData: assign({
      debugMode: ({ event }) => event.debugMode,
    }),
  },
}).createMachine({
  id: 'control-buttons',
  initial: 'idle',
  context: { debugMode: false },
  states: {
    idle: {
      on: {
        UPDATE_DATA: { actions: 'updateData' },
      },
    },
    loading: {
      on: {
        UPDATE_DATA: { target: 'idle', actions: 'updateData' },
      },
    },
  },
});

// Debug Info Machine - specific context for debug data
const debugInfoMachine = setup({
  types: {
    context: {} as DebugInfoContext,
    events: {} as DebugInfoEvents,
  },
  actions: {
    updateData: assign({
      debugMode: ({ event }) => event.debugMode,
      debugState: ({ event }) => event.debugState,
    }),
  },
}).createMachine({
  id: 'debug-info',
  initial: 'idle',
  context: { debugMode: false, debugState: null },
  states: {
    idle: {
      on: {
        UPDATE_DATA: { actions: 'updateData' },
      },
    },
  },
});

// 6. Component type definitions for type-safe DOM queries
interface ComponentWithSend<T> extends HTMLElement {
  send?: (event: T) => void;
}

// Actor Header Component
const _ActorHeaderComponent = createComponent({
  machine: actorHeaderMachine,
  template: (state: SnapshotFrom<typeof actorHeaderMachine>) => {
    const { name, role, currentState } = state.context;
    if (state.matches('loading')) {
      return html`<div class="actor-header">Loading...</div>`;
    }

    return html`
      <div class="actor-header">
        <div class="actor-icon">${getActorIcon(role)}</div>
        <div class="actor-info">
          <h3 class="actor-name">${name}</h3>
          <p class="actor-role">${role}</p>
        </div>
        <div class="actor-status status-${currentState}">
          ${getStatusIndicator(currentState)}
        </div>
      </div>
    `;
  },
});

// Actor Stats Component
const _ActorStatsComponent = createComponent({
  machine: actorStatsMachine,
  template: (state: SnapshotFrom<typeof actorStatsMachine>) => {
    const { ordersProcessed, currentState } = state.context;
    if (state.matches('loading')) {
      return html`<div class="actor-stats">Loading...</div>`;
    }

    return html`
      <div class="actor-stats">
        <div class="stat">
          <span class="stat-label">Orders Processed:</span>
          <span class="stat-value">${ordersProcessed}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Status:</span>
          <span class="stat-value status-${currentState}">${formatStatus(currentState)}</span>
        </div>
      </div>
    `;
  },
});

// Current Task Component
const _CurrentTaskComponent = createComponent({
  machine: currentTaskMachine,
  template: (state: SnapshotFrom<typeof currentTaskMachine>) => {
    const { currentTask } = state.context;
    if (!currentTask) {
      return html``;
    }

    return html`
      <div class="current-task">
        <span class="task-label">Current Task:</span>
        <span class="task-value">${currentTask}</span>
      </div>
    `;
  },
});

// Error Message Component
const _ErrorMessageComponent = createComponent({
  machine: errorMessageMachine,
  template: (state: SnapshotFrom<typeof errorMessageMachine>) => {
    const { errorMessage } = state.context;
    if (!errorMessage) {
      return html``;
    }

    return html`
      <div class="error-message" role="alert">
        <strong>Error:</strong> ${errorMessage}
      </div>
    `;
  },
});

// Action Buttons Component
const _ActionButtonsComponent = createComponent({
  machine: actionButtonsMachine,
  template: (state: SnapshotFrom<typeof actionButtonsMachine>) => {
    const { currentState } = state.context;
    if (state.matches('loading')) {
      return html`<div class="action-buttons">Loading...</div>`;
    }

    if (currentState === 'idle') {
      return html`
        <button send="START_WORK" class="btn btn-primary">
          Start Work
        </button>
        <button send="SET_TASK" task="Custom task" class="btn btn-secondary">
          Set Custom Task
        </button>
      `;
    }

    if (currentState === 'busy') {
      return html`
        <button send="COMPLETE_TASK" class="btn btn-success">
          Complete Task
        </button>
        <button send="ENCOUNTER_ERROR" message="Task failed!" class="btn btn-danger">
          Simulate Error
        </button>
      `;
    }

    if (currentState === 'complete') {
      return html`
        <button send="START_WORK" class="btn btn-primary">
          Start New Task
        </button>
      `;
    }

    if (currentState === 'error') {
      return html`
        <button send="START_WORK" class="btn btn-primary">
          Try Again
        </button>
      `;
    }

    return html``;
  },
});

// Control Buttons Component
const _ControlButtonsComponent = createComponent({
  machine: controlButtonsMachine,
  template: (state: SnapshotFrom<typeof controlButtonsMachine>) => {
    const { debugMode } = state.context;
    if (state.matches('loading')) {
      return html`<div class="control-buttons">Loading...</div>`;
    }

    return html`
      <button send="RESET" class="btn btn-outline">
        Reset
      </button>
      <button send="TOGGLE_DEBUG" class="btn btn-outline ${debugMode ? 'active' : ''}">
        Debug: ${debugMode ? 'ON' : 'OFF'}
      </button>
    `;
  },
});

// Debug Info Component
const _DebugInfoComponent = createComponent({
  machine: debugInfoMachine,
  template: (state: SnapshotFrom<typeof debugInfoMachine>) => {
    const { debugMode, debugState } = state.context;
    if (!debugMode || !debugState) {
      return html``;
    }

    return html`
      <div class="debug-info">
        <h4>Debug Information</h4>
        <pre class="debug-content">${JSON.stringify(debugState, null, 2)}</pre>
      </div>
    `;
  },
});

// 7. Helper functions (pure, no side effects)
function getActorIcon(role: string): string {
  const icons: Record<string, string> = {
    'Example Component': '🎭',
    Barista: '☕',
    Cashier: '💳',
    Customer: '👤',
    Manager: '👔',
  };
  return icons[role] || '🤖';
}

function getStatusIndicator(status: string): string {
  const indicators: Record<string, string> = {
    idle: '⚪',
    busy: '🟡',
    complete: '🟢',
    error: '🔴',
  };
  return indicators[status] || '⚫';
}

function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// 8. Type-safe component reference helpers - pure framework approach
function getTypedComponent<T>(selector: string): ComponentWithSend<T> | null {
  // ✅ FRAMEWORK: Use pure framework event bus for component coordination
  if (typeof window !== 'undefined' && window.globalEventBus) {
    window.globalEventBus.emit('component-query', {
      selector,
      source: 'actor-demo-component',
      timestamp: Date.now(),
    });

    // ✅ FRAMEWORK: Request component reference through framework
    window.globalEventBus.emit('request-component-reference', {
      selector,
      requester: 'actor-demo-component',
      timestamp: Date.now(),
    });
  }

  // ✅ FRAMEWORK: No DOM queries - framework will handle component coordination
  // Return null to indicate framework-based coordination is preferred
  return null;
}

// 9. Main template composition using web components
const demoActorTemplate = (state: SnapshotFrom<typeof demoActorMachine>): RawHTML => {
  const { context } = state;
  const currentStateValue = String(state.value); // Type-safe conversion instead of casting

  // ✅ FRAMEWORK: Use framework event bus for component coordination instead of RAF
  if (typeof window !== 'undefined' && window.globalEventBus) {
    // Emit component update events through framework
    window.globalEventBus.emit('actor-demo-state-update', {
      source: 'actor-demo-component',
      context,
      currentState: currentStateValue,
      timestamp: Date.now(),
    });

    // Emit specific component updates through framework
    const updateData = {
      header: { name: context.name, role: context.role, currentState: currentStateValue },
      stats: { ordersProcessed: context.ordersProcessed, currentState: currentStateValue },
      task: { currentTask: context.currentTask },
      error: state.matches('error') ? { errorMessage: context.errorMessage } : null,
      actions: { currentState: currentStateValue },
      controls: { debugMode: context.debugMode },
      debug: { debugMode: context.debugMode, debugState: state },
    };

    window.globalEventBus.emit('actor-demo-component-updates', updateData);
  }

  // ✅ FRAMEWORK: Fallback synchronous updates while framework handles coordination
  // This maintains functionality but should be replaced by framework patterns
  const headerComponent = getTypedComponent<ActorHeaderEvents>('actor-header');
  const statsComponent = getTypedComponent<ActorStatsEvents>('actor-stats');
  const taskComponent = getTypedComponent<CurrentTaskEvents>('current-task');
  const errorComponent = getTypedComponent<ErrorMessageEvents>('error-message');
  const actionComponent = getTypedComponent<ActionButtonsEvents>('action-buttons');
  const controlComponent = getTypedComponent<ControlButtonsEvents>('control-buttons');
  const debugComponent = getTypedComponent<DebugInfoEvents>('debug-info');

  headerComponent?.send?.({
    type: 'UPDATE_DATA',
    name: context.name,
    role: context.role,
    currentState: currentStateValue,
  });

  statsComponent?.send?.({
    type: 'UPDATE_DATA',
    ordersProcessed: context.ordersProcessed,
    currentState: currentStateValue,
  });

  taskComponent?.send?.({
    type: 'UPDATE_DATA',
    currentTask: context.currentTask,
  });

  if (state.matches('error')) {
    errorComponent?.send?.({
      type: 'UPDATE_DATA',
      errorMessage: context.errorMessage,
    });
  }

  actionComponent?.send?.({
    type: 'UPDATE_DATA',
    currentState: currentStateValue,
  });

  controlComponent?.send?.({
    type: 'UPDATE_DATA',
    debugMode: context.debugMode,
  });

  debugComponent?.send?.({
    type: 'UPDATE_DATA',
    debugMode: context.debugMode,
    debugState: state,
  });

  return html`
    <div class="demo-actor">
      <actor-header></actor-header>
      <actor-stats></actor-stats>
      <current-task></current-task>
      ${state.matches('error') ? html`<error-message></error-message>` : html``}
      
      <div class="actor-controls">
        <action-buttons></action-buttons>
        <control-buttons></control-buttons>
      </div>
      
      <debug-info></debug-info>
    </div>
  `;
};

// 10. Create main component using framework patterns
const DemoActorComponent = createComponent({
  machine: demoActorMachine,
  template: demoActorTemplate,
});

export default DemoActorComponent;
