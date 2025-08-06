/**
 * @module actor-core/runtime/utils/null-actor
 * @description Null object pattern for ActorRef placeholders
 */

import type { ActorRef } from '../actor-ref.js';
import type { ActorSnapshot, ActorStatus } from '../types.js';

/**
 * Creates a null ActorRef placeholder that can be used in message plans
 * that will be resolved by the system at runtime.
 *
 * This is used internally by system actors when creating message plans
 * where the actual actor reference will be determined by the plan interpreter.
 *
 * @param id - The actor ID to use as a placeholder
 * @returns A minimal ActorRef that throws on actual usage
 */
export function createNullActorRef(id: string): ActorRef<unknown> {
  const errorMessage = `Null ActorRef (${id}) - should be resolved by system`;

  return {
    address: {
      id,
      type: 'null',
      node: 'local',
      path: `/null/${id}`,
    },

    // Message sending - these should never be called
    send: () => {
      throw new Error(errorMessage);
    },

    ask: async () => {
      throw new Error(errorMessage);
    },

    stop: async () => {
      throw new Error(errorMessage);
    },

    isAlive: async () => false,

    getStats: async () => ({
      messagesReceived: 0,
      messagesProcessed: 0,
      errors: 0,
      uptime: 0,
    }),

    // State access
    getSnapshot: (): ActorSnapshot => ({
      context: { type: 'NULL_CONTEXT' },
      value: 'active',
      status: 'active' as ActorStatus,
      error: undefined,
      matches: () => false,
      can: () => false,
      hasTag: () => false,
      toJSON: () => ({}),
    }),
  };
}
