/**
 * Improved Type Errors Demo - Shows how the enhanced type system provides better error messages
 *
 * This example demonstrates how the improved type definitions help developers
 * catch and fix common mistakes with clear, actionable error messages.
 */

import type { ActorMessage } from '../actor-system.js';
import { defineBehavior } from '../index.js';

// Define typed events for a user authentication actor
type AuthEvent =
  | { type: 'LOGIN_SUCCESS'; data: { userId: string; token: string } }
  | { type: 'LOGIN_FAILED'; data: { reason: string; attempts: number } }
  | { type: 'LOGOUT'; data: { userId: string } }
  | { type: 'SESSION_EXPIRED'; data: { expiredAt: number } };

// Example 1: Typo in event type
// Uncomment to see the improved error message
/*
const typoExample = defineBehavior<ActorMessage, { isAuthenticated: boolean }, AuthEvent>({
  context: { isAuthenticated: false },
  onMessage: ({ message, context }) => {
    return {
      context: { isAuthenticated: true },
      // Error: Invalid event type "LOGIN_SUCESS". Valid types are: "LOGIN_SUCCESS" | "LOGIN_FAILED" | "LOGOUT" | "SESSION_EXPIRED"
      emit: { type: 'LOGIN_SUCESS', data: { userId: '123', token: 'abc' } }
    };
  },
});
*/

// Example 2: Wrong property name
// Uncomment to see the improved error message
/*
const wrongPropertyExample = defineBehavior<ActorMessage, { isAuthenticated: boolean }, AuthEvent>({
  context: { isAuthenticated: false },
  onMessage: ({ message, context }) => {
    return {
      context: { isAuthenticated: true },
      // Error: Property "dat" does not exist on event type "LOGIN_SUCCESS"
      emit: { type: 'LOGIN_SUCCESS', dat: { userId: '123', token: 'abc' } }
    };
  },
});
*/

// Example 3: Wrong property type
// Uncomment to see the improved error message
/*
const wrongTypeExample = defineBehavior<ActorMessage, { isAuthenticated: boolean }, AuthEvent>({
  context: { isAuthenticated: false },
  onMessage: ({ message, context }) => {
    return {
      context: { isAuthenticated: false },
      // Error: Property "attempts" has wrong type. Expected: number, Got: string
      emit: { type: 'LOGIN_FAILED', data: { reason: 'Invalid password', attempts: '3' } }
    };
  },
});
*/

// Example 4: Missing required field
// Uncomment to see the improved error message
/*
const missingFieldExample = defineBehavior<ActorMessage, { isAuthenticated: boolean }, AuthEvent>({
  context: { isAuthenticated: false },
  onMessage: ({ message, context }) => {
    return {
      context: { isAuthenticated: true },
      // Error: Missing required field "token"
      emit: { type: 'LOGIN_SUCCESS', data: { userId: '123' } }
    };
  },
});
*/

// Example 5: Extra properties (if using strict validation)
// Uncomment to see the improved error message
/*
const extraPropertiesExample = defineBehavior<ActorMessage, { isAuthenticated: boolean }, AuthEvent>({
  context: { isAuthenticated: false },
  onMessage: ({ message, context }) => {
    return {
      context: { isAuthenticated: true },
      // Error: Event has extra properties. Valid properties for "LOGIN_SUCCESS" are: "type" | "data"
      emit: { 
        type: 'LOGIN_SUCCESS', 
        data: { userId: '123', token: 'abc' },
        timestamp: Date.now() // This property doesn't exist on LOGIN_SUCCESS
      }
    };
  },
});
*/

// Correct implementation - this compiles without errors
const authActor = defineBehavior<
  ActorMessage,
  { isAuthenticated: boolean; userId?: string },
  AuthEvent
>({
  context: { isAuthenticated: false },
  onMessage: ({ message, context }) => {
    switch (message.type) {
      case 'LOGIN': {
        // Simulate authentication
        const success = Math.random() > 0.5;
        if (success) {
          return {
            context: { isAuthenticated: true, userId: '123' },
            emit: {
              type: 'LOGIN_SUCCESS',
              data: { userId: '123', token: 'auth-token-xyz' },
            },
          };
        }
        return {
          context,
          emit: {
            type: 'LOGIN_FAILED',
            data: { reason: 'Invalid credentials', attempts: 1 },
          },
        };
      }

      case 'LOGOUT':
        if (context.userId) {
          return {
            context: { isAuthenticated: false, userId: undefined },
            emit: {
              type: 'LOGOUT',
              data: { userId: context.userId },
            },
          };
        }
        return { context };

      case 'CHECK_SESSION':
        // Simulate session expiry check
        if (context.isAuthenticated && Math.random() > 0.8) {
          return {
            context: { isAuthenticated: false, userId: undefined },
            emit: {
              type: 'SESSION_EXPIRED',
              data: { expiredAt: Date.now() },
            },
          };
        }
        return { context };

      default:
        return { context };
    }
  },
});

console.log('Improved type errors demo compiled successfully!');
console.log('Uncomment the error examples to see the improved error messages.');
console.log('Notice how the error messages now clearly indicate:');
console.log('  - What the valid event types are when you make a typo');
console.log('  - Which property has the wrong name or type');
console.log('  - What fields are missing from an event');

export { authActor };
