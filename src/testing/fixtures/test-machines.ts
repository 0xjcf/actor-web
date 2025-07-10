/**
 * @module framework/testing/fixtures/test-machines
 * @description Test machine fixtures for testing ActorRef implementations
 * @author Agent C - 2025-01-10
 */

import { assign, createMachine, setup } from 'xstate';

// Simple counter machine for basic tests
export const counterMachine = createMachine({
  id: 'counter',
  initial: 'active',
  context: {
    count: 0,
  },
  states: {
    active: {
      on: {
        INCREMENT: {
          actions: assign({ count: ({ context }) => context.count + 1 }),
        },
        DECREMENT: {
          actions: assign({ count: ({ context }) => context.count - 1 }),
        },
        RESET: {
          actions: assign({ count: 0 }),
        },
      },
    },
  },
});

// State transition machine for testing state changes
export const trafficLightMachine = createMachine({
  id: 'trafficLight',
  initial: 'red',
  states: {
    red: {
      on: { NEXT: 'green' },
    },
    green: {
      on: { NEXT: 'yellow' },
    },
    yellow: {
      on: { NEXT: 'red' },
    },
  },
});

// Machine with delayed transitions for testing timers
export const delayedMachine = createMachine({
  id: 'delayed',
  initial: 'waiting',
  states: {
    waiting: {
      after: {
        100: 'completed',
      },
    },
    completed: {
      type: 'final',
    },
  },
});

// Machine with parent communication for testing child actors
export const childMachine = setup({
  types: {
    context: {} as { messageCount: number },
    events: {} as { type: 'SEND_TO_PARENT'; message: string } | { type: 'INCREMENT_COUNT' },
  },
}).createMachine({
  id: 'child',
  initial: 'active',
  context: {
    messageCount: 0,
  },
  states: {
    active: {
      on: {
        SEND_TO_PARENT: {
          actions: [
            assign({ messageCount: ({ context }) => context.messageCount + 1 }),
            'sendToParent',
          ],
        },
        INCREMENT_COUNT: {
          actions: assign({ messageCount: ({ context }) => context.messageCount + 1 }),
        },
      },
    },
  },
});

// Parent machine that can spawn children
export const parentMachine = setup({
  types: {
    context: {} as { childMessages: string[] },
    events: {} as
      | { type: 'SPAWN_CHILD'; id: string }
      | { type: 'child.message'; message: string }
      | { type: 'STOP_CHILD'; id: string },
  },
  actors: {
    childMachine,
  },
}).createMachine({
  id: 'parent',
  initial: 'active',
  context: {
    childMessages: [],
  },
  states: {
    active: {
      on: {
        SPAWN_CHILD: {
          actions: assign({
            // In real implementation, would spawn child actor
          }),
        },
        'child.message': {
          actions: assign({
            childMessages: ({ context, event }) => [...context.childMessages, event.message],
          }),
        },
      },
    },
  },
});

// Machine with error states for testing supervision
export const errorProneMachine = createMachine({
  id: 'errorProne',
  initial: 'idle',
  context: {
    errorCount: 0,
    attempts: 0,
  },
  states: {
    idle: {
      on: {
        START: 'running',
      },
    },
    running: {
      on: {
        ERROR: {
          target: 'failed',
          actions: assign({ errorCount: ({ context }) => context.errorCount + 1 }),
        },
        SUCCESS: 'completed',
      },
    },
    failed: {
      on: {
        RETRY: {
          target: 'running',
          actions: assign({ attempts: ({ context }) => context.attempts + 1 }),
        },
        RESET: {
          target: 'idle',
          actions: assign({ errorCount: 0, attempts: 0 }),
        },
      },
    },
    completed: {
      type: 'final',
    },
  },
});

// Machine with complex event handling for testing ask pattern
export const queryMachine = setup({
  types: {
    context: {} as { data: Record<string, unknown>; pendingResponses: unknown[] },
    events: {} as
      | { type: 'query'; request: string; params?: { key: string }; correlationId: string }
      | { type: 'SET'; key: string; value: unknown }
      | { type: 'QUERY_RESPONSE'; correlationId: string; value: unknown },
  },
}).createMachine({
  id: 'query',
  initial: 'ready',
  context: {
    data: {},
    pendingResponses: [],
  },
  states: {
    ready: {
      on: {
        query: {
          actions: assign({
            pendingResponses: ({ context, event }) => {
              // Handle query and create response
              const key = event.params?.key;
              const value = key ? context.data[key] : null;

              const response = {
                type: 'response',
                correlationId: event.correlationId,
                result: value,
                timestamp: Date.now(),
              };

              return [...context.pendingResponses, response];
            },
          }),
        },
        SET: {
          actions: assign({
            data: ({ context, event }) => ({
              ...context.data,
              [event.key]: event.value,
            }),
          }),
        },
      },
    },
  },
});

// Machine with guards for testing conditional transitions
export const guardedMachine = setup({
  types: {
    context: {} as { isAuthenticated: boolean; permissions: string[] },
    events: {} as
      | { type: 'LOGIN' }
      | { type: 'LOGOUT' }
      | { type: 'ACCESS_RESOURCE'; resource: string },
  },
}).createMachine({
  id: 'guarded',
  initial: 'unauthenticated',
  context: {
    isAuthenticated: false,
    permissions: [],
  },
  states: {
    unauthenticated: {
      on: {
        LOGIN: {
          target: 'authenticated',
          actions: assign({
            isAuthenticated: true,
            permissions: ['read', 'write'],
          }),
        },
      },
    },
    authenticated: {
      on: {
        LOGOUT: {
          target: 'unauthenticated',
          actions: assign({
            isAuthenticated: false,
            permissions: [],
          }),
        },
        ACCESS_RESOURCE: [
          {
            target: 'accessGranted',
            guard: ({ context, event }) => {
              return context.permissions.includes('admin') || event.resource === 'public';
            },
          },
          {
            target: 'accessDenied',
          },
        ],
      },
    },
    accessGranted: {
      after: {
        1000: 'authenticated',
      },
    },
    accessDenied: {
      after: {
        1000: 'authenticated',
      },
    },
  },
});

// Export all machines as a collection for easy access
export const testMachines = {
  counter: counterMachine,
  trafficLight: trafficLightMachine,
  delayed: delayedMachine,
  child: childMachine,
  parent: parentMachine,
  errorProne: errorProneMachine,
  query: queryMachine,
  guarded: guardedMachine,
} as const;

// Type helpers for test machines
export type TestMachineId = keyof typeof testMachines;
export type TestMachine = (typeof testMachines)[TestMachineId];
