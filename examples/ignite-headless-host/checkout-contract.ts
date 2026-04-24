import type { ActorSnapshot, IgniteActorSourceSnapshot } from '@actor-core/runtime/browser';
import { actorSnapshotToIgniteSourceSnapshot, defineActor } from '@actor-core/runtime/browser';
import { emit, setup } from 'xstate';

export type CheckoutCommand =
  | { type: 'SUBMIT'; orderId: string }
  | { type: 'RESET' }
  | { type: 'GET_COUNT' };

export type CheckoutEvent =
  | { type: 'CHECKOUT_SUBMITTED'; orderId: string }
  | { type: 'CHECKOUT_RESET' };

export interface CheckoutContext {
  submittedOrders: string[];
  lastSubmittedOrderId: string | null;
}

export const LOCAL_NODE = 'ignite-host-ui';
export const REMOTE_NODE = 'ignite-host-runtime';
export const REMOTE_ACTOR_ID = 'ignite-headless-host';
export const REMOTE_ADDRESS = {
  id: REMOTE_ACTOR_ID,
  type: 'actor',
  node: REMOTE_NODE,
  path: `actor://${REMOTE_NODE}/actor/${REMOTE_ACTOR_ID}`,
} as const;

const checkoutMachine = setup({
  types: {
    context: {} as CheckoutContext,
    events: {} as CheckoutCommand,
    emitted: {} as CheckoutEvent,
  },
  actions: {
    emitSubmitted: emit(({ event }) => ({
      type: 'CHECKOUT_SUBMITTED' as const,
      orderId: event.type === 'SUBMIT' ? event.orderId : '',
    })),
    emitReset: emit(() => ({
      type: 'CHECKOUT_RESET' as const,
    })),
  },
}).createMachine({
  id: 'ignite-headless-checkout',
  initial: 'ready',
  context: {
    submittedOrders: [],
    lastSubmittedOrderId: null,
  },
  states: {
    ready: {
      on: {
        SUBMIT: {
          target: 'submitted',
          actions: ['emitSubmitted'],
        },
      },
    },
    submitted: {
      on: {
        SUBMIT: {
          target: 'submitted',
          actions: ['emitSubmitted'],
        },
        RESET: {
          target: 'ready',
          actions: ['emitReset'],
        },
      },
    },
  },
});

export function createCheckoutBehavior() {
  return defineActor<CheckoutCommand>()
    .withMachine(checkoutMachine)
    .onMessage(({ actor, message }) => {
      const context = actor.getSnapshot().context;

      if (message.type === 'GET_COUNT') {
        return { reply: context.submittedOrders.length };
      }

      if (message.type === 'SUBMIT') {
        return {
          context: {
            submittedOrders: [...context.submittedOrders, message.orderId],
            lastSubmittedOrderId: message.orderId,
          },
          emit: [{ type: 'CHECKOUT_SUBMITTED', orderId: message.orderId }],
        };
      }

      return {
        context: {
          submittedOrders: [],
          lastSubmittedOrderId: null,
        },
        emit: [{ type: 'CHECKOUT_RESET' }],
      };
    });
}

export function createActorSnapshot<TContext>(
  value: unknown,
  context: TContext,
  status: ActorSnapshot<TContext>['status'] = 'running'
): ActorSnapshot<TContext> {
  return {
    value,
    context,
    status,
    matches: (state: string) => state === value,
    can: () => status === 'running',
    hasTag: () => false,
    toJSON: () => ({
      value,
      context,
      status,
    }),
  };
}

export function createPlaceholderSnapshot(): IgniteActorSourceSnapshot<CheckoutContext> {
  return actorSnapshotToIgniteSourceSnapshot(
    REMOTE_ADDRESS,
    createActorSnapshot('ready', {
      submittedOrders: [],
      lastSubmittedOrderId: null,
    })
  );
}

export function normalizeCheckoutSnapshot(
  snapshot: IgniteActorSourceSnapshot<CheckoutContext>
): IgniteActorSourceSnapshot<CheckoutContext> {
  const derivedPhase =
    snapshot.phase === 'active'
      ? snapshot.context.submittedOrders.length > 0
        ? 'submitted'
        : 'ready'
      : snapshot.phase;

  if (derivedPhase === snapshot.phase) {
    return snapshot;
  }

  return {
    ...snapshot,
    phase: derivedPhase,
    toJSON: () => ({
      ...snapshot.toJSON(),
      phase: derivedPhase,
    }),
  };
}
