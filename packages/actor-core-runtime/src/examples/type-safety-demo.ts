/**
 * Type Safety Demo - Demonstrates compile-time type checking with defineBehavior
 *
 * This example shows how defineBehavior provides proper type safety for emitted events,
 * catching typos and incorrect property types at compile time.
 */

import type { ActorMessage } from '../actor-system.js';
import { defineBehavior } from '../index.js';

// Define typed events
type CounterEvent =
  | { type: 'COUNTER_UPDATED'; data: { count: number; timestamp: number } }
  | { type: 'COUNTER_RESET'; data: { previousCount: number } };

// This will produce compile-time errors (uncomment to see):
/*
const brokenActor = defineBehavior<ActorMessage, { count: number }, CounterEvent>({
  context: { count: 0 },
    onMessage: ({ message, context }) => {
      return {
        context,
        emit: [
          // ERROR: 'dat' instead of 'data'
          { type: 'COUNTER_UPDATED', dat: { count: 1, timestamp: Date.now() } },
          
          // ERROR: wrong data structure
          { type: 'COUNTER_RESET', data: 'not an object' },
          
          // ERROR: missing required field
          { type: 'COUNTER_UPDATED', data: { count: 1 } },
          
          // ERROR: unknown event type
          { type: 'UNKNOWN_EVENT', data: {} }
        ],
      };
    },
});
*/

// Correct implementation with proper types
const counterActor = defineBehavior<ActorMessage, { count: number }, CounterEvent>({
  context: { count: 0 },
  onMessage: ({ message, context }) => {
    if (message.type === 'INCREMENT') {
      const newCount = context.count + 1;
      return {
        context: { count: newCount },
        emit: {
          type: 'COUNTER_UPDATED',
          data: { count: newCount, timestamp: Date.now() },
        },
      };
    }

    if (message.type === 'RESET') {
      return {
        context: { count: 0 },
        emit: {
          type: 'COUNTER_RESET',
          data: { previousCount: context.count },
        },
      };
    }

    // No events emitted for other messages
    return { context };
  },
});

// Example with multiple event types
const notificationActor = defineBehavior<
  ActorMessage,
  { notifications: string[] },
  | { type: 'NOTIFICATION_ADDED'; data: string }
  | { type: 'NOTIFICATION_CLEARED'; data: { count: number } }
>({
  context: { notifications: [] },
  onMessage: ({ message, context }) => {
    if (message.type === 'ADD_NOTIFICATION') {
      const notification = message.payload as string;
      return {
        context: {
          notifications: [...context.notifications, notification],
        },
        emit: {
          type: 'NOTIFICATION_ADDED',
          data: notification, // Type-checked!
        },
      };
    }

    if (message.type === 'CLEAR_ALL') {
      const count = context.notifications.length;
      return {
        context: { notifications: [] },
        emit: {
          type: 'NOTIFICATION_CLEARED',
          data: { count }, // Type-checked!
        },
      };
    }

    return { context };
  },
});

console.log('Type safety demo compiled successfully!');
console.log('Uncomment the brokenActor example to see compile-time type errors.');

export { counterActor, notificationActor };
