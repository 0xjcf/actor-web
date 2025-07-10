// TypeScript interfaces for Coffee Shop Orchestrator

import type { ActorRefFrom } from 'xstate';
import { assign, setup } from 'xstate';
import { baristaMachine } from './barista/barista-machine-actor.js';
import { cashierMachine } from './cashier/cashier-machine-actor.js';
import { customerMachine } from './customer/customer-machine-actor.js';
import { messageLogMachine } from './message-log-actor.js';
import { uiStateMachine } from './ui-state-machine.js';

// Proper actor ref types following avoid-any-type rule
type CustomerActorRef = ActorRefFrom<typeof customerMachine>;
type CashierActorRef = ActorRefFrom<typeof cashierMachine>;
type BaristaActorRef = ActorRefFrom<typeof baristaMachine>;
type MessageLogActorRef = ActorRefFrom<typeof messageLogMachine>;
type UiStateActorRef = ActorRefFrom<typeof uiStateMachine>;

interface OrchestratorContext {
  customerActor: CustomerActorRef | null;
  cashierActor: CashierActorRef | null;
  baristaActor: BaristaActorRef | null;
  messageLogActor: MessageLogActorRef | null;
  uiStateActor: UiStateActorRef | null;
  ordersCompleted: number;
  ordersInQueue: number;
}

// All possible events the orchestrator can receive
type OrchestratorEvents =
  | { type: 'OPEN' }
  | { type: 'RESET' }
  | { type: 'LOG_MESSAGE'; message?: string; messageType?: string }
  | { type: 'PAID' }
  // Customer events
  | { type: 'customer.SAYS_ORDER'; message?: string }
  | { type: 'customer.WANTS_TO_ORDER'; message?: string }
  | { type: 'customer.PAYING'; message?: string }
  | { type: 'customer.ORDER_CONFIRMED'; message?: string }
  | { type: 'customer.COFFEE_RECEIVED'; message?: string }
  | { type: 'customer.ENJOYING'; message?: string }
  | { type: 'customer.BROWSING_AGAIN'; message?: string }
  // Cashier events
  | { type: 'cashier.TAKING_ORDER'; message?: string }
  | { type: 'cashier.REQUESTS_PAYMENT'; message?: string }
  | { type: 'cashier.PROCESSING_PAYMENT'; message?: string }
  | { type: 'cashier.PAYMENT_PROCESSED'; message?: string }
  | { type: 'cashier.ORDER_TAKEN'; message?: string }
  | { type: 'cashier.PICKING_UP_COFFEE'; message?: string }
  | { type: 'cashier.READY_TO_SERVE'; message?: string }
  | { type: 'cashier.BACK_TO_WAITING'; message?: string }
  // Barista events
  | { type: 'barista.RECEIVED_ORDER'; message?: string }
  | { type: 'barista.GRINDING_BEANS'; message?: string }
  | { type: 'barista.BREWING'; message?: string }
  | { type: 'barista.ADDING_TOUCHES'; message?: string }
  | { type: 'barista.COFFEE_READY'; message?: string }
  | { type: 'barista.CLEANING'; message?: string };

type OrchestratorStates = 'closed' | 'opening' | 'open' | 'resetting';

// Orchestrator that spawns and manages child actors
export const coffeeShopOrchestratorMachine = setup({
  types: {} as {
    context: OrchestratorContext;
    events: OrchestratorEvents;
  },

  actions: {
    forwardWithLog: ({
      context,
      event,
    }: {
      context: OrchestratorContext;
      event: OrchestratorEvents;
    }) => {
      // Log the message if present
      if ('message' in event && event.message && context.messageLogActor) {
        context.messageLogActor.send({
          type: 'LOG_MESSAGE',
          message: event.message,
        });
      }
    },

    incrementOrderQueue: assign({
      ordersInQueue: ({ context }) => context.ordersInQueue + 1,
    }),

    completeOrder: assign({
      ordersCompleted: ({ context }) => context.ordersCompleted + 1,
      ordersInQueue: ({ context }: { context: OrchestratorContext }) =>
        Math.max(0, context.ordersInQueue - 1),
    }),

    resetStats: assign({
      ordersCompleted: 0,
      ordersInQueue: 0,
    }),
  },

  actors: {
    customer: customerMachine,
    cashier: cashierMachine,
    barista: baristaMachine,
    messageLog: messageLogMachine,
    uiState: uiStateMachine,
  },
}).createMachine({
  id: 'coffeeShopOrchestrator',

  context: {
    customerActor: null,
    cashierActor: null,
    baristaActor: null,
    messageLogActor: null,
    uiStateActor: null,
    ordersCompleted: 0,
    ordersInQueue: 0,
  },

  initial: 'closed' as OrchestratorStates,

  states: {
    closed: {
      on: {
        OPEN: 'opening',
      },
    },

    opening: {
      entry: assign({
        // Spawn child actors
        messageLogActor: ({ spawn }) => spawn('messageLog', { id: 'messageLog' }),
        uiStateActor: ({ spawn }) => spawn('uiState', { id: 'uiState' }),
        customerActor: ({ spawn }) => spawn('customer', { id: 'customer' }),
        cashierActor: ({ spawn }) => spawn('cashier', { id: 'cashier' }),
        baristaActor: ({ spawn }) => spawn('barista', { id: 'barista' }),
      }),
      always: 'open',
    },

    open: {
      on: {
        // Customer says their order
        'customer.SAYS_ORDER': {
          actions: [
            'forwardWithLog',
            ({ context }) => {
              if (context.cashierActor) {
                context.cashierActor.send({ type: 'CUSTOMER_SPEAKS_ORDER' });
              }
            },
          ],
        },

        // Customer wants to order
        'customer.WANTS_TO_ORDER': {
          actions: [
            'forwardWithLog',
            'incrementOrderQueue',
            ({ context }) => {
              if (context.uiStateActor) {
                context.uiStateActor.send({ type: 'ORDER_STARTED' });
              }
            },
          ],
        },

        // Cashier requests payment
        'cashier.REQUESTS_PAYMENT': {
          actions: [
            'forwardWithLog',
            ({ context }) => {
              if (context.customerActor) {
                context.customerActor.send({ type: 'PAYMENT_REQUEST' });
              }
            },
            ({ context }) => {
              if (context.uiStateActor) {
                context.uiStateActor.send({ type: 'PAYMENT_REQUESTED' });
              }
            },
          ],
        },

        // Cashier took order
        'cashier.ORDER_TAKEN': {
          actions: [
            'forwardWithLog',
            ({ context }) => {
              if (context.baristaActor) {
                context.baristaActor.send({ type: 'MAKE_COFFEE' });
              }
            },
          ],
        },

        // Barista finished coffee
        'barista.COFFEE_READY': {
          actions: [
            'forwardWithLog',
            ({ context }) => {
              if (context.cashierActor) {
                context.cashierActor.send({ type: 'COFFEE_READY' });
              }
            },
            ({ context }) => {
              if (context.uiStateActor) {
                context.uiStateActor.send({ type: 'COFFEE_READY' });
              }
            },
          ],
        },

        // Cashier ready to serve
        'cashier.READY_TO_SERVE': {
          actions: [
            'forwardWithLog',
            ({ context }) => {
              if (context.customerActor) {
                context.customerActor.send({ type: 'RECEIVE_COFFEE' });
              }
            },
          ],
        },

        // Customer received coffee
        'customer.COFFEE_RECEIVED': {
          actions: [
            'forwardWithLog',
            'completeOrder',
            ({ context }) => {
              if (context.uiStateActor) {
                context.uiStateActor.send({ type: 'COFFEE_DELIVERED' });
              }
            },
          ],
        },

        // Customer events with messages
        'customer.PAYING': {
          actions: 'forwardWithLog',
        },

        // Handle PAID event from customer
        PAID: {
          actions: ({ context }) => {
            if (context.cashierActor) {
              context.cashierActor.send({ type: 'CUSTOMER_PAYS' });
            }
          },
        },

        'customer.ORDER_CONFIRMED': {
          actions: 'forwardWithLog',
        },

        'customer.ENJOYING': {
          actions: 'forwardWithLog',
        },

        'customer.BROWSING_AGAIN': {
          actions: 'forwardWithLog',
        },

        // Cashier events with messages
        'cashier.TAKING_ORDER': {
          actions: 'forwardWithLog',
        },

        'cashier.PROCESSING_PAYMENT': {
          actions: 'forwardWithLog',
        },

        'cashier.PAYMENT_PROCESSED': {
          actions: 'forwardWithLog',
        },

        'cashier.PICKING_UP_COFFEE': {
          actions: 'forwardWithLog',
        },

        'cashier.BACK_TO_WAITING': {
          actions: 'forwardWithLog',
        },

        // Barista events with messages
        'barista.RECEIVED_ORDER': {
          actions: [
            'forwardWithLog',
            ({ context }) => {
              if (context.uiStateActor) {
                context.uiStateActor.send({ type: 'BARISTA_STARTED' });
              }
            },
          ],
        },

        'barista.GRINDING_BEANS': {
          actions: 'forwardWithLog',
        },

        'barista.BREWING': {
          actions: 'forwardWithLog',
        },

        'barista.ADDING_TOUCHES': {
          actions: 'forwardWithLog',
        },

        'barista.CLEANING': {
          actions: 'forwardWithLog',
        },

        // Forward log messages to message log actor (deprecated, but keep for compatibility)
        LOG_MESSAGE: {
          actions: ({ context, event }) => {
            if (context.messageLogActor && event.type === 'LOG_MESSAGE' && event.message) {
              context.messageLogActor.send({
                type: 'LOG_MESSAGE',
                message: event.message,
                messageType: event.messageType as
                  | 'error'
                  | 'info'
                  | 'warning'
                  | 'success'
                  | undefined,
              });
            }
          },
        },

        // Reset everything
        RESET: {
          target: 'resetting',
        },
      },
    },

    resetting: {
      entry: [
        // Reset stats
        'resetStats',
        // Send reset to all actors
        ({ context }) => {
          if (context.customerActor) {
            context.customerActor.send({ type: 'RESET' });
          }
        },
        ({ context }) => {
          if (context.cashierActor) {
            context.cashierActor.send({ type: 'RESET' });
          }
        },
        ({ context }) => {
          if (context.baristaActor) {
            context.baristaActor.send({ type: 'RESET' });
          }
        },
        ({ context }) => {
          if (context.uiStateActor) {
            context.uiStateActor.send({ type: 'RESET' });
          }
        },
        // Clear message log
        ({ context }) => {
          if (context.messageLogActor) {
            context.messageLogActor.send({ type: 'CLEAR_LOG' });
          }
        },
      ],
      always: 'open',
    },
  },
});

// Type exports for external usage
export type { OrchestratorContext, OrchestratorEvents, OrchestratorStates };
