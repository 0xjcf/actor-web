/**
 * @fileoverview OTP-Style Three-Pattern Demo
 * Demonstrates the new unified behavior API with three patterns:
 * 1. Pure routing (stateless)
 * 2. OTP-style (explicit context management)
 * 3. XState (machine-managed state)
 */

import { setup } from 'xstate';
import { defineActor } from '../create-actor.js';

// ============================================================================
// DEMO MESSAGE TYPES
// ============================================================================

interface CounterMessage {
  type: 'INCREMENT' | 'DECREMENT' | 'GET_COUNT' | 'RESET';
  value?: number;
}

interface RoutingMessage {
  type: 'ROUTE_EMAIL' | 'ROUTE_SMS' | 'ROUTE_NOTIFICATION';
  content: string;
  target: string;
}

// ============================================================================
// PATTERN 1: PURE ROUTING (STATELESS)
// ============================================================================

export const emailRouter = defineActor<RoutingMessage>().onMessage(({ message }) => {
  switch (message.type) {
    case 'ROUTE_EMAIL':
      return [
        { type: 'VALIDATE_EMAIL', content: message.content, target: message.target },
        { type: 'LOG_REQUEST', timestamp: Date.now() },
      ];

    case 'ROUTE_SMS':
      return [
        { type: 'VALIDATE_PHONE', content: message.content, target: message.target },
        { type: 'LOG_REQUEST', timestamp: Date.now() },
      ];

    default:
      return []; // No routing needed
  }
});

// ============================================================================
// PATTERN 2: OTP-STYLE (EXPLICIT CONTEXT MANAGEMENT)
// ============================================================================

export const otpCounter = defineActor<CounterMessage>()
  .withContext({ count: 0, lastUpdated: Date.now() })
  .onMessage(({ message, context }) => {
    switch (message.type) {
      case 'INCREMENT':
        return {
          context: {
            count: context.count + (message?.value || 1),
            lastUpdated: Date.now(),
          },
          emit: [{ type: 'COUNT_CHANGED', newCount: context.count + 1 }],
        };

      case 'DECREMENT':
        return {
          context: {
            count: context.count - (message?.value || 1),
            lastUpdated: Date.now(),
          },
          emit: [{ type: 'COUNT_CHANGED', newCount: context.count - 1 }],
        };

      case 'GET_COUNT':
        return {
          emit: [{ type: 'COUNT_RESPONSE', count: context.count }],
        };

      case 'RESET':
        return {
          context: { count: 0, lastUpdated: Date.now() },
          emit: [{ type: 'COUNT_RESET' }],
        };

      default:
        return undefined; // No action
    }
  });

// ============================================================================
// PATTERN 3: XSTATE MACHINE (COMPLEX STATE MANAGEMENT)
// ============================================================================

const counterMachine = setup({
  types: {
    context: {} as { count: number; isActive: boolean },
    events: {} as CounterMessage,
  },
}).createMachine({
  id: 'counter-machine',
  initial: 'idle',
  context: { count: 0, isActive: true },
  states: {
    idle: {
      on: {
        INCREMENT: {
          actions: 'incrementCount',
          target: 'active',
        },
        DECREMENT: {
          actions: 'decrementCount',
          target: 'active',
        },
      },
    },
    active: {
      after: {
        1000: 'idle', // Auto-return to idle
      },
      on: {
        RESET: {
          actions: 'resetCount',
          target: 'idle',
        },
      },
    },
  },
});

export const xstateCounter = defineActor<CounterMessage>()
  .withMachine(counterMachine)
  .onMessage(({ message, actor }) => {
    const state = actor.getSnapshot();

    switch (message.type) {
      case 'GET_COUNT':
        return {
          emit: [{ type: 'COUNT_RESPONSE', count: state.context.count }],
        };

      default:
        // Let XState machine handle state transitions
        return { emit: [] };
    }
  });

// ============================================================================
// USAGE EXAMPLES
// ============================================================================

export function demonstrateThreePatterns() {
  log.debug('🎯 OTP-Style Three-Pattern Demo');

  log.debug('\n📋 Pattern 1: Pure Routing');
  log.debug('- Stateless message transformation');
  log.debug('- Direct array returns');
  log.debug('- Best for: Message brokers, coordinators');

  log.debug('\n🔄 Pattern 2: OTP-Style');
  log.debug('- Explicit context management');
  log.debug('- { context: newState, emit: [...] } returns');
  log.debug('- Best for: Counters, caches, simple state');

  log.debug('\n🔧 Pattern 3: XState Machine');
  log.debug('- Complex state machine management');
  log.debug('- { emit: [...] } returns, machine handles state');
  log.debug('- Best for: Workflows, complex business logic');

  log.debug('\n✅ All patterns follow pure actor model:');
  log.debug('- Message-only communication');
  log.debug('- Location transparency');
  log.debug('- State isolation');
  log.debug('- No shared memory');
}
