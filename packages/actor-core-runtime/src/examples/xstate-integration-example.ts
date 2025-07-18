/**
 * XState Integration Example - Shows how createActor can work with XState machines
 *
 * This example demonstrates the unified createActor API that supports both
 * behavior-based actors and XState state machines.
 */

import { createMachine } from 'xstate';
import type { ActorMessage } from '../actor-system.js';
import { createActor } from '../create-actor.js';

// Define a simple toggle machine using XState
const toggleMachine = createMachine(
  {
    id: 'toggle',
    initial: 'inactive',
    context: {
      count: 0,
    },
    states: {
      inactive: {
        on: {
          TOGGLE: {
            target: 'active',
            actions: ['incrementCount'],
          },
        },
      },
      active: {
        on: {
          TOGGLE: {
            target: 'inactive',
            actions: ['incrementCount'],
          },
        },
      },
    },
  },
  {
    actions: {
      incrementCount: ({ context }) => {
        context.count++;
      },
    },
  }
);

// Example 1: Behavior-based actor
const behaviorActor = createActor<
  ActorMessage,
  { isActive: boolean; count: number },
  { type: 'TOGGLED'; wasActive: boolean; count: number }
>({
  context: { isActive: false, count: 0 },
  behavior: {
    onMessage: ({ message, context }) => {
      if (message.type === 'TOGGLE') {
        const wasActive = context.isActive;
        const newCount = context.count + 1;

        return {
          context: {
            isActive: !context.isActive,
            count: newCount,
          },
          emit: {
            type: 'TOGGLED',
            wasActive,
            count: newCount,
          },
        };
      }

      return { context };
    },
  },
});

// Example 2: XState machine actor (future implementation)
// Note: This is a demonstration of the API. Full XState integration
// would require bridging XState's actor system with our actor system.
const xstateActor = createActor({
  machine: toggleMachine,
  input: { count: 0 },
});

// Example 3: Direct ActorDefinition
const directActor = createActor({
  context: { value: 0 },
  onMessage: async ({ message, context }) => {
    if (message.type === 'INCREMENT') {
      return {
        context: { value: context.value + 1 },
        emit: {
          type: 'VALUE_CHANGED',
          payload: { newValue: context.value + 1 },
          timestamp: Date.now(),
          version: '1.0.0',
        },
      };
    }
    return { context };
  },
});

console.log('Created behavior-based actor:', behaviorActor);
console.log('Created XState actor (placeholder):', xstateActor);
console.log('Created direct actor definition:', directActor);

export { behaviorActor, xstateActor, directActor };
