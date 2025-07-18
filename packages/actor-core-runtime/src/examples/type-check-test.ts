/**
 * Type Check Test - Verifies that createActor catches type errors
 */

import type { ActorMessage } from '../actor-system.js';
import { createActor } from '../create-actor.js';

// This should produce a type error for the misspelled 'dat' property
const brokenActor = createActor<ActorMessage, {}, { type: string; data: string }>({
  context: {},
  behavior: {
    onMessage: ({ context }) => {
      return {
        context,
        emit: [
          { type: 'TEST_EVENT_1', dat: 'Hello' }, // ERROR: 'dat' should be 'data'
          { type: 'TEST_EVENT_2', data: 'World' }, // OK
        ],
      };
    },
  },
});

// This should compile correctly
const correctActor = createActor<ActorMessage, {}, { type: string; data: string }>({
  context: {},
  behavior: {
    onMessage: ({ context }) => {
      return {
        context,
        emit: [
          { type: 'TEST_EVENT_1', data: 'Hello' }, // OK
          { type: 'TEST_EVENT_2', data: 'World' }, // OK
        ],
      };
    },
  },
});

export { brokenActor, correctActor };
