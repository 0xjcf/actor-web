// TypeScript interfaces for Cashier State Machine
import { assign, createMachine, sendParent } from 'xstate';

interface CashierContext {
  ordersInQueue: number;
  ordersCompleted: number;
}

type CashierEvents =
  | { type: 'CUSTOMER_SPEAKS_ORDER' }
  | { type: 'CUSTOMER_PAYS' }
  | { type: 'COFFEE_READY' }
  | { type: 'RESET' };

type CashierStates =
  | 'waiting'
  | 'readyToTakeOrder'
  | 'takingOrder'
  | 'requestingPayment'
  | 'processingPayment'
  | 'waitingForCoffee'
  | 'preparingToServe'
  | 'servingCoffee';

// Parent events that cashier sends to coffee shop orchestrator
interface CashierParentEvents {
  type:
    | 'cashier.TAKING_ORDER'
    | 'cashier.REQUESTS_PAYMENT'
    | 'cashier.PROCESSING_PAYMENT'
    | 'cashier.PAYMENT_PROCESSED'
    | 'cashier.ORDER_TAKEN'
    | 'cashier.PICKING_UP_COFFEE'
    | 'cashier.READY_TO_SERVE'
    | 'cashier.BACK_TO_WAITING';
  message?: string;
}

export const cashierMachine = createMachine({
  id: 'cashier',
  initial: 'waiting' as CashierStates,
  context: {
    ordersInQueue: 0,
    ordersCompleted: 0,
  } as CashierContext,

  states: {
    waiting: {
      on: {
        CUSTOMER_SPEAKS_ORDER: {
          target: 'readyToTakeOrder',
          actions: assign({
            ordersInQueue: ({ context }: { context: CashierContext }) => context.ordersInQueue + 1,
          }),
        },
        RESET: {
          target: 'waiting',
          actions: assign({
            ordersInQueue: 0,
            ordersCompleted: 0,
          }),
        },
      },
    },

    readyToTakeOrder: {
      after: {
        5000: {
          // 5 seconds
          target: 'takingOrder',
        },
      },
    },

    takingOrder: {
      entry: sendParent({
        type: 'cashier.TAKING_ORDER',
        message: '✍️ Cashier: *Writing down order*',
      } as CashierParentEvents),

      after: {
        5000: {
          // 5 seconds
          target: 'requestingPayment',
          actions: sendParent({
            type: 'cashier.REQUESTS_PAYMENT',
            message: '💬 Cashier → Customer: "That\'ll be $4.50 please"',
          } as CashierParentEvents),
        },
      },
    },

    requestingPayment: {
      on: {
        CUSTOMER_PAYS: {
          target: 'processingPayment',
        },
      },
    },

    processingPayment: {
      entry: sendParent({
        type: 'cashier.PROCESSING_PAYMENT',
        message: '💵 Cashier: *Processing payment*',
      } as CashierParentEvents),

      after: {
        5000: {
          // 5 seconds
          target: 'waitingForCoffee',
          actions: [
            sendParent({
              type: 'cashier.PAYMENT_PROCESSED',
              message: '✅ Cashier: *Payment complete - Thank you!*',
            } as CashierParentEvents),
            sendParent({
              type: 'cashier.ORDER_TAKEN',
              message: '📢 Cashier → Barista: "One cappuccino order!"',
            } as CashierParentEvents),
          ],
        },
      },
    },

    waitingForCoffee: {
      on: {
        COFFEE_READY: {
          target: 'preparingToServe',
          actions: sendParent({
            type: 'cashier.PICKING_UP_COFFEE',
            message: '🤲 Cashier: *Picking up coffee*',
          } as CashierParentEvents),
        },
      },
    },

    preparingToServe: {
      after: {
        5000: {
          // 5 seconds
          target: 'servingCoffee',
          actions: sendParent({
            type: 'cashier.READY_TO_SERVE',
            message: '☕ Cashier → Customer: "Here\'s your cappuccino!"',
          } as CashierParentEvents),
        },
      },
    },

    servingCoffee: {
      after: {
        5000: {
          // 5 seconds
          target: 'waiting',
          actions: [
            assign({
              ordersInQueue: ({ context }: { context: CashierContext }) =>
                Math.max(0, context.ordersInQueue - 1),
              ordersCompleted: ({ context }: { context: CashierContext }) =>
                context.ordersCompleted + 1,
            }),
            sendParent({
              type: 'cashier.BACK_TO_WAITING',
              message: '😊 Cashier: *Ready for next customer*',
            } as CashierParentEvents),
          ],
        },
      },
    },
  },
});

// Type exports for external usage
export type { CashierContext, CashierEvents, CashierStates, CashierParentEvents };
