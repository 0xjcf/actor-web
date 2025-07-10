// TypeScript interfaces for UI State Machine
import { createMachine } from 'xstate';

type UiStateContext = Record<string, unknown>;

type UiStateEvents =
  | { type: 'ORDER_STARTED' }
  | { type: 'PAYMENT_REQUESTED' }
  | { type: 'BARISTA_STARTED' }
  | { type: 'COFFEE_READY' }
  | { type: 'COFFEE_DELIVERED' }
  | { type: 'RESET' };

type UiStates =
  | 'idle'
  | 'orderPlacing'
  | 'paymentProcessing'
  | 'coffeePreparation'
  | 'coffeeReady'
  | 'orderComplete';

export const uiStateMachine = createMachine({
  id: 'uiState',
  initial: 'idle' as UiStates,

  context: {} as UiStateContext,

  types: {} as {
    context: UiStateContext;
    events: UiStateEvents;
  },

  states: {
    idle: {
      on: {
        ORDER_STARTED: 'orderPlacing',
      },
    },

    orderPlacing: {
      on: {
        PAYMENT_REQUESTED: 'paymentProcessing',
        RESET: 'idle',
      },
    },

    paymentProcessing: {
      on: {
        BARISTA_STARTED: 'coffeePreparation',
        RESET: 'idle',
      },
    },

    coffeePreparation: {
      on: {
        COFFEE_READY: 'coffeeReady',
        RESET: 'idle',
      },
    },

    coffeeReady: {
      on: {
        COFFEE_DELIVERED: 'orderComplete',
        RESET: 'idle',
      },
    },

    orderComplete: {
      after: {
        5000: 'idle', // Auto-transition back to idle after 5 seconds
      },
      on: {
        RESET: 'idle',
      },
    },
  },
});

// Helper functions for type-safe event creation
export const createUiStateEvent = {
  orderStarted: (): Extract<UiStateEvents, { type: 'ORDER_STARTED' }> => ({
    type: 'ORDER_STARTED',
  }),
  paymentRequested: (): Extract<UiStateEvents, { type: 'PAYMENT_REQUESTED' }> => ({
    type: 'PAYMENT_REQUESTED',
  }),
  baristaStarted: (): Extract<UiStateEvents, { type: 'BARISTA_STARTED' }> => ({
    type: 'BARISTA_STARTED',
  }),
  coffeeReady: (): Extract<UiStateEvents, { type: 'COFFEE_READY' }> => ({ type: 'COFFEE_READY' }),
  coffeeDelivered: (): Extract<UiStateEvents, { type: 'COFFEE_DELIVERED' }> => ({
    type: 'COFFEE_DELIVERED',
  }),
  reset: (): Extract<UiStateEvents, { type: 'RESET' }> => ({ type: 'RESET' }),
};

// State checking utilities
export const isUiStateIn = {
  idle: (state: string): boolean => state === 'idle',
  orderPlacing: (state: string): boolean => state === 'orderPlacing',
  paymentProcessing: (state: string): boolean => state === 'paymentProcessing',
  coffeePreparation: (state: string): boolean => state === 'coffeePreparation',
  coffeeReady: (state: string): boolean => state === 'coffeeReady',
  orderComplete: (state: string): boolean => state === 'orderComplete',
  busy: (state: string): boolean => state !== 'idle',
};

// Type exports for external usage
export type { UiStateContext, UiStateEvents, UiStates };
