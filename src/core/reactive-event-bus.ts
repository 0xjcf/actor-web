import { createActor, fromCallback, setup } from 'xstate';

export interface EventMapping {
  selector: string;
  eventType: string;
  action: string;
}

export interface EventBusContext {
  bindings: Map<string, EventMapping[]>;
  activeListeners: Map<string, unknown[]>;
}

export type EventBusEvent =
  | { type: 'BIND'; componentId: string; mappings: Record<string, string> }
  | { type: 'UNBIND'; componentId: string }
  | { type: 'DISPATCH'; componentId: string; action: string; event: Event };

type DispatchEvent = { type: 'DISPATCH'; componentId: string; action: string; event: Event };

// Event bus machine using XState v5 setup
export const eventBusMachine = setup({
  types: {
    context: {} as EventBusContext,
    events: {} as EventBusEvent,
  },
  actors: {
    setupListener: fromCallback(
      ({
        sendBack,
        input,
      }: {
        sendBack: (event: DispatchEvent) => void;
        input: { element: HTMLElement; mapping: EventMapping; componentId: string };
      }) => {
        const { element, mapping, componentId } = input;
        const [eventName, ...selectorParts] = mapping.selector.split(' ');
        const targetSelector = selectorParts.join(' ');

        const handler = (e: Event) => {
          const target = e.target as HTMLElement;
          if (!targetSelector || target.matches(targetSelector)) {
            sendBack({
              type: 'DISPATCH',
              componentId,
              action: mapping.action,
              event: e,
            });
          }
        };

        element.addEventListener(eventName, handler);

        return () => {
          element.removeEventListener(eventName, handler);
        };
      }
    ),
  },
  actions: {
    setupEventListeners: ({ context, event, self }) => {
      if (event.type !== 'BIND') {
        return;
      }

      const mappings: EventMapping[] = [];
      for (const [selector, action] of Object.entries(event.mappings)) {
        mappings.push({ selector, eventType: selector.split(' ')[0], action });
      }

      context.bindings.set(event.componentId, mappings);

      // Setup listeners in the machine state, not in actions
      const listeners: unknown[] = [];
      const component = document.querySelector(`[data-component-id="${event.componentId}"]`);

      if (component) {
        for (const mapping of mappings) {
          const actor = createActor(
            fromCallback(() => {
              const handler = (e: Event) => {
                const target = e.target as HTMLElement;
                const [, ...selectorParts] = mapping.selector.split(' ');
                const targetSelector = selectorParts.join(' ');

                if (!targetSelector || target.matches(targetSelector)) {
                  // Prevent default for form submissions and other cancelable events
                  if (mapping.eventType === 'submit' && e.cancelable) {
                    e.preventDefault();
                  }

                  self.send({
                    type: 'DISPATCH',
                    componentId: event.componentId,
                    action: mapping.action,
                    event: e,
                  });
                }
              };

              (component as HTMLElement).addEventListener(mapping.eventType, handler);

              return () => {
                (component as HTMLElement).removeEventListener(mapping.eventType, handler);
              };
            })
          );

          actor.start();
          listeners.push(actor);
        }
      }

      context.activeListeners.set(event.componentId, listeners);
    },

    cleanupEventListeners: ({ context, event }) => {
      if (event.type !== 'UNBIND') {
        return;
      }

      const listeners = context.activeListeners.get(event.componentId);
      if (listeners) {
        for (const actor of listeners) {
          (actor as { stop: () => void }).stop();
        }
      }

      context.bindings.delete(event.componentId);
      context.activeListeners.delete(event.componentId);
    },

    dispatchToController: ({ event }) => {
      if (event.type !== 'DISPATCH') {
        return;
      }

      const component = document.querySelector(`[data-component-id="${event.componentId}"]`);
      if (component && 'controller' in component) {
        const controller = (
          component as unknown as {
            controller?: { receiveEvent: (eventData: Record<string, unknown>) => void };
          }
        ).controller;

        // Handle both JSON event data (new) and simple strings (legacy)
        let eventData: Record<string, unknown>;
        try {
          // Try parsing as JSON first (new smart extraction format)
          eventData = JSON.parse(event.action);
        } catch {
          // Fallback to simple event structure (legacy format)
          eventData = { type: event.action };
        }

        controller?.receiveEvent(eventData);
      }
    },
  },
}).createMachine({
  id: 'event-bus',
  initial: 'active',
  context: {
    bindings: new Map(),
    activeListeners: new Map(),
  },
  states: {
    active: {
      on: {
        BIND: {
          actions: 'setupEventListeners',
        },
        UNBIND: {
          actions: 'cleanupEventListeners',
        },
        DISPATCH: {
          actions: 'dispatchToController',
        },
      },
    },
  },
});

// Singleton Event Bus
export class ReactiveEventBus {
  private static instance: ReactiveEventBus | null = null;
  private actor = createActor(eventBusMachine);

  private constructor() {
    this.actor.start();
  }

  static getInstance(): ReactiveEventBus {
    if (!ReactiveEventBus.instance) {
      ReactiveEventBus.instance = new ReactiveEventBus();
    }
    return ReactiveEventBus.instance;
  }

  bindEvents(componentId: string, mappings: Record<string, string>): void {
    this.actor.send({ type: 'BIND', componentId, mappings });
  }

  unbindEvents(componentId: string): void {
    this.actor.send({ type: 'UNBIND', componentId });
  }

  // Refresh bindings for components that might have been added to DOM after initial binding
  refreshBindings(): void {
    const context = this.actor.getSnapshot().context;

    // Create a snapshot of bindings to avoid concurrent modification during iteration
    const bindingsSnapshot = new Map(context.bindings);

    bindingsSnapshot.forEach((mappings, componentId) => {
      // Unbind first, then rebind to ensure fresh listeners
      this.unbindEvents(componentId);
      const mappingObject: Record<string, string> = {};
      for (const mapping of mappings) {
        mappingObject[mapping.selector] = mapping.action;
      }
      this.bindEvents(componentId, mappingObject);
    });
  }

  // Helper method to generate unique component IDs
  static generateComponentId(prefix = 'component'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
