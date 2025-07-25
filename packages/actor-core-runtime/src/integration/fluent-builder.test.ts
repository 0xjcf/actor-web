/**
 * @module packages/actor-core-runtime/src/integration/fluent-builder.test
 * @description Integration tests for Fluent Builder API with OTP patterns
 * @author AI Assistant - 2024-01-18
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActorSystem } from '../actor-system.js';
import { createActorSystem } from '../actor-system-impl.js';
import { defineFluentBehavior } from '../index.js';
import type { TypedMessage } from '../messaging/typed-messages.js';
import { createMessage } from '../messaging/typed-messages.js';

type CounterMessage =
  | TypedMessage<'INCREMENT'>
  | TypedMessage<'GET_COUNT'>
  | TypedMessage<'SET_VALUE', { value: number }>;

interface CounterContext {
  count: number;
  status: 'idle' | 'active';
}

describe('Fluent Builder API Integration', () => {
  let system: ActorSystem;

  beforeEach(async () => {
    system = createActorSystem({ nodeAddress: 'test-fluent-builder' });
    await system.start();
  });

  afterEach(async () => {
    if (system?.isRunning()) {
      await system.stop();
    }
  });

  describe('Context-Based Actor Creation', () => {
    it('should create context-based actor with context updates using smart defaults', async () => {
      // Arrange: Create counter behavior with smart defaults
      const behavior = defineFluentBehavior<CounterMessage>()
        .withContext<CounterContext>({ count: 0, status: 'idle' })
        .onMessage(({ message, machine }) => {
          const context = machine.getSnapshot().context as CounterContext;

          if (message.type === 'INCREMENT') {
            // Smart default: context becomes response for ask patterns
            return {
              context: { count: context.count + 1, status: 'active' as const },
            };
          }

          return undefined;
        });

      // Act: Spawn actor and test state update
      const actorRef = await system.spawn(behavior, { id: 'counter-smart-defaults' });

      // Use ask pattern to test smart defaults (state should become response)
      const response = await actorRef.ask<CounterContext>(createMessage('INCREMENT', null), 1000);

      // Assert: Verify smart defaults work (response should equal the new state)
      expect(response).toBeDefined();
      expect(response.count).toBe(1);
      expect(response.status).toBe('active');
    });

    it('should handle explicit responses over smart defaults', async () => {
      // Arrange: Create behavior with explicit response
      const behavior = defineFluentBehavior<CounterMessage>()
        .withContext<CounterContext>({ count: 0, status: 'idle' })
        .onMessage(({ message }) => {
          if (message.type === 'SET_VALUE') {
            const newCount = message.payload.value;
            return {
              context: { count: newCount, status: 'active' as const },
              response: { count: newCount, status: 'active' as const }, // Response matches CounterContext type
            };
          }

          return undefined;
        });

      // Act: Test explicit response
      const actorRef = await system.spawn(behavior, { id: 'counter-explicit' });

      const response = await actorRef.ask<CounterContext>(
        createMessage('SET_VALUE', { value: 42 }),
        1000
      );

      // Assert: Explicit response takes precedence over smart defaults
      expect(response).toEqual({ count: 42, status: 'active' });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle undefined/null returns gracefully', async () => {
      // Arrange: Create behavior that returns undefined
      const behavior = defineFluentBehavior<CounterMessage>()
        .withContext<CounterContext>({ count: 0, status: 'idle' })
        .onMessage(() => undefined); // Always return undefined

      const actorRef = await system.spawn(behavior, { id: 'undefined-return' });

      // Act & Assert: Should not throw when sending messages
      expect(() => {
        actorRef.send(createMessage('INCREMENT', null));
      }).not.toThrow();
    });

    it('should maintain type safety across builder chain', () => {
      // Arrange & Act: Create behavior with type inference
      const behavior = defineFluentBehavior<CounterMessage>()
        .withContext<CounterContext>({ count: 0, status: 'idle' })
        .onMessage(({ message, machine, dependencies }) => {
          // TypeScript should infer all types correctly
          expect(typeof message.type).toBe('string');
          expect(machine).toBeDefined();
          expect(dependencies).toBeDefined();

          return undefined;
        });

      // Assert: Behavior should be created without type errors
      expect(behavior).toBeDefined();
      expect(typeof behavior.onMessage).toBe('function');
    });
  });

  describe('OTP Integration Debugging', () => {
    it('should process ActorHandlerResult correctly', async () => {
      // Arrange: Create behavior that definitely returns ActorHandlerResult
      const behavior = defineFluentBehavior<CounterMessage>()
        .withContext<CounterContext>({ count: 0, status: 'idle' })
        .onMessage(({ message }) => {
          console.log('🔍 HANDLER: Received message:', message.type);
          const result = {
            context: { count: 1, status: 'active' as const },
            response: { count: 1, status: 'active' as const }, // Response matches CounterContext type
          };
          console.log('🔍 HANDLER: Returning result:', result);
          return result;
        });

      // Act: Test the actual integration
      const actorRef = await system.spawn(behavior, { id: 'debug-test' });

      console.log('🔍 TEST: Sending increment message...');
      const response = await actorRef.ask<CounterContext>(createMessage('INCREMENT', null), 1000);

      console.log('🔍 TEST: Received response:', response);

      // Assert: Should get our explicit response matching CounterContext
      expect(response).toEqual({ count: 1, status: 'active' });
    });
  });
});
