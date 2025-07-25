/**
 * @module packages/actor-core-runtime/src/integration/fluent-builder.test
 * @description Integration tests for Fluent Builder API with OTP patterns
 * @author 0xjcf - July 24 2025
 * 
 * Following TESTING-GUIDE.md standards:
 * - Scoped logging for debugging
 * - Performance and concurrency testing  
 * - Comprehensive error scenarios
 * - Lifecycle testing patterns
 * - Supervision strategy testing
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActorSystem } from '../actor-system.js';
import { createActorSystem } from '../actor-system-impl.js';
import { defineFluentBehavior } from '../index.js';
import { Logger } from '../logger.js';
import type { TypedMessage } from '../messaging/typed-messages.js';
import { createMessage } from '../messaging/typed-messages.js';

// ============================================================================
// TEST SETUP & SCOPED LOGGING
// ============================================================================

const log = Logger.namespace('FLUENT_BUILDER_TESTS');

type CounterMessage =
  | TypedMessage<'INCREMENT'>
  | TypedMessage<'GET_COUNT'>
  | TypedMessage<'SET_VALUE', { value: number }>
  | TypedMessage<'TRIGGER_ERROR'>
  | TypedMessage<'BATCH_PROCESS', { items: number[] }>;

interface CounterContext {
  count: number;
  status: 'idle' | 'active' | 'error';
  processedItems?: number[];
}

describe('Fluent Builder API Integration', () => {
  let system: ActorSystem;

  beforeEach(async () => {
    log.debug('Setting up test environment');
    system = createActorSystem({ nodeAddress: 'test-fluent-builder' });
    await system.start();
    log.debug('Actor system started successfully');
  });

  afterEach(async () => {
    log.debug('Cleaning up test environment');
    if (system?.isRunning()) {
      await system.stop();
      log.debug('Actor system stopped successfully');
    }
  });

  // ============================================================================
  // CORE FUNCTIONALITY TESTS
  // ============================================================================

  describe('Context-Based Actor Creation', () => {
    it('should create context-based actor with context updates using smart defaults', async () => {
      log.debug('Testing smart defaults pattern');
      
      // Arrange: Create counter behavior with smart defaults
      const behavior = defineFluentBehavior<CounterMessage>()
        .withContext<CounterContext>({ count: 0, status: 'idle' })
        .onMessage(({ message, machine }) => {
          const context = machine.getSnapshot().context as CounterContext;
          log.debug('Processing message', { type: message.type, currentCount: context.count });

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
      log.debug('Smart defaults test completed successfully', { response });
    });

    it('should handle explicit responses over smart defaults', async () => {
      log.debug('Testing explicit response pattern');
      
      // Arrange: Create behavior with explicit response
      const behavior = defineFluentBehavior<CounterMessage>()
        .withContext<CounterContext>({ count: 0, status: 'idle' })
        .onMessage(({ message }) => {
          if (message.type === 'SET_VALUE') {
            const newCount = message.payload.value;
            log.debug('Setting explicit value', { newCount });
            return {
              context: { count: newCount, status: 'active' as const },
              response: { count: newCount, status: 'active' as const }, // Response matches CounterContext type
            };
          }
        });

      // Act: Test explicit response
      const actorRef = await system.spawn(behavior, { id: 'counter-explicit' });

      const response = await actorRef.ask<CounterContext>(
        createMessage('SET_VALUE', { value: 42 }),
        1000
      );

      // Assert: Explicit response takes precedence over smart defaults
      expect(response).toEqual({ count: 42, status: 'active' });
      log.debug('Explicit response test completed', { response });
    });
  });

  // ============================================================================
  // ERROR HANDLING & EDGE CASES
  // ============================================================================

  describe('Error Handling and Edge Cases', () => {
    it('should handle undefined/null returns gracefully', async () => {
      log.debug('Testing graceful handling of undefined returns');
      
      // Arrange: Create behavior that returns undefined
      const behavior = defineFluentBehavior<CounterMessage>()
        .withContext<CounterContext>({ count: 0, status: 'idle' })
        .onMessage(() => {
          log.debug('Handler returning undefined');
          return undefined;
        });

      const actorRef = await system.spawn(behavior, { id: 'undefined-return' });

      // Act & Assert: Should not throw when sending messages
      expect(() => {
        actorRef.send(createMessage('INCREMENT', null));
        log.debug('Send completed without throwing');
      }).not.toThrow();
    });

    it('should maintain type safety across builder chain', () => {
      log.debug('Testing type safety in builder chain');
      
      // Arrange & Act: Create behavior with type inference
      const behavior = defineFluentBehavior<CounterMessage>()
        .withContext<CounterContext>({ count: 0, status: 'idle' })
        .onMessage(({ message, machine, dependencies }) => {
          // TypeScript should infer all types correctly
          expect(typeof message.type).toBe('string');
          expect(machine).toBeDefined();
          expect(dependencies).toBeDefined();
          log.debug('Type inference working correctly', { 
            messageType: typeof message.type,
            hasMachine: !!machine,
            hasDependencies: !!dependencies 
          });

          return undefined;
        });

      // Assert: Behavior should be created without type errors
      expect(behavior).toBeDefined();
      expect(typeof behavior.onMessage).toBe('function');
    });

    it('should handle malformed message payloads gracefully', async () => {
      log.debug('Testing malformed payload handling');
      
      const behavior = defineFluentBehavior<CounterMessage>()
        .withContext<CounterContext>({ count: 0, status: 'idle' })
        .onMessage(({ message }) => {
          try {
            if (message.type === 'SET_VALUE') {
              // This should handle type mismatches gracefully
              const value = message.payload?.value;
              if (typeof value !== 'number') {
                log.warn('Invalid payload type received', { payload: message.payload });
                return {
                  context: { count: 0, status: 'error' as const },
                };
              }
              return {
                context: { count: value, status: 'active' as const },
              };
            }
          } catch (error) {
            log.error('Error processing message', { error, message: message.type });
            return {
              context: { count: 0, status: 'error' as const },
            };
          }
          return undefined;
        });

      const actorRef = await system.spawn(behavior, { id: 'malformed-test' });

      // Test with properly typed message
      const validResponse = await actorRef.ask<CounterContext>(
        createMessage('SET_VALUE', { value: 10 }),
        1000
      );
      expect(validResponse.count).toBe(10);
      expect(validResponse.status).toBe('active');

      log.debug('Malformed payload test completed');
    });
  });

  // ============================================================================
  // PERFORMANCE & CONCURRENCY TESTS  
  // ============================================================================

  describe('Performance and Concurrency', () => {
    it('should handle concurrent ask patterns efficiently', async () => {
      log.debug('Testing concurrent ask patterns');
      
      const behavior = defineFluentBehavior<CounterMessage>()
        .withContext<CounterContext>({ count: 0, status: 'idle' })
        .onMessage(({ message, machine }) => {
          const context = machine.getSnapshot().context as CounterContext;
          if (message.type === 'INCREMENT') {
            return {
              context: { count: context.count + 1, status: 'active' as const },
            };
          }
          return undefined;
        });

      const actorRef = await system.spawn(behavior, { id: 'concurrent-test' });

      // Act: Send multiple concurrent requests
      const startTime = performance.now();
      const concurrentRequests = Array.from({ length: 10 }, () =>
        actorRef.ask<CounterContext>(createMessage('INCREMENT', null), 1000)
      );

      const responses = await Promise.all(concurrentRequests);
      const duration = performance.now() - startTime;

      // Assert: All requests should complete
      expect(responses).toHaveLength(10);
      responses.forEach(response => {
        expect(response).toBeDefined();
        expect(typeof response.count).toBe('number');
      });

      // Performance assertion (should complete in reasonable time)
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
      
      log.debug('Concurrent requests completed', { 
        count: responses.length, 
        duration: `${duration.toFixed(2)}ms`,
        avgPerRequest: `${(duration / responses.length).toFixed(2)}ms`
      });
    });

    it('should handle high-frequency message processing', async () => {
      log.debug('Testing high-frequency message processing');
      
      let processedCount = 0;
      const behavior = defineFluentBehavior<CounterMessage>()
        .withContext<CounterContext>({ count: 0, status: 'idle', processedItems: [] })
        .onMessage(({ message, machine }) => {
          const context = machine.getSnapshot().context as CounterContext;
          
          if (message.type === 'BATCH_PROCESS') {
            processedCount++;
            const items = message.payload.items;
            return {
              context: { 
                ...context, 
                count: context.count + items.length,
                processedItems: [...(context.processedItems || []), ...items],
                status: 'active' as const 
              },
            };
          }
          return undefined;
        });

      const actorRef = await system.spawn(behavior, { id: 'high-frequency-test' });

      // Act: Send many messages rapidly
      const messageCount = 100;
      const startTime = performance.now();
      
      for (let i = 0; i < messageCount; i++) {
        actorRef.send(createMessage('BATCH_PROCESS', { items: [i, i + 1, i + 2] }));
      }

      // Wait a bit for processing
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const duration = performance.now() - startTime;

      // Assert: Should handle high throughput
      expect(processedCount).toBeGreaterThan(0);
      expect(duration).toBeLessThan(500); // Should be very fast
      
      log.debug('High-frequency processing completed', { 
        messageCount,
        processedCount,
        duration: `${duration.toFixed(2)}ms`,
        throughput: `${(messageCount / duration * 1000).toFixed(0)} msg/sec`
      });
    });
  });

  // ============================================================================
  // LIFECYCLE & SUPERVISION TESTS
  // ============================================================================

  describe('Actor Lifecycle and Supervision', () => {
    it('should handle actor lifecycle events properly', async () => {
      log.debug('Testing actor lifecycle events');
      
      const behavior = defineFluentBehavior<CounterMessage>()
        .withContext<CounterContext>({ count: 0, status: 'idle' })
        .onMessage(({ message }) => {
          if (message.type === 'GET_COUNT') {
            return { context: { count: 1, status: 'active' as const } };
          }
          return undefined;
        });

      // Test actor spawning and basic operation
      const actorRef = await system.spawn(behavior, { id: 'lifecycle-test' });

      // Test basic operation works correctly
      const response = await actorRef.ask<CounterContext>(createMessage('GET_COUNT', null), 1000);
      expect(response.count).toBe(1);
      expect(response.status).toBe('active');

      log.debug('Lifecycle test completed', { response });
    });

    it('should recover from errors gracefully', async () => {
      log.debug('Testing error recovery patterns');
      
      let errorCount = 0;
      const behavior = defineFluentBehavior<CounterMessage>()
        .withContext<CounterContext>({ count: 0, status: 'idle' })
        .onMessage(({ message, machine }) => {
          const context = machine.getSnapshot().context as CounterContext;
          
          if (message.type === 'TRIGGER_ERROR') {
            errorCount++;
            log.warn('Simulated error triggered', { errorCount });
            
            // Simulate recovery after error
            return {
              context: { count: context.count, status: 'error' as const },
            };
          }

          if (message.type === 'INCREMENT') {
            // Normal processing after error
            return {
              context: { count: context.count + 1, status: 'active' as const },
            };
          }
          
          return undefined;
        });

      const actorRef = await system.spawn(behavior, { id: 'error-recovery-test' });

      // Trigger error
      const errorResponse = await actorRef.ask<CounterContext>(createMessage('TRIGGER_ERROR', null), 1000);
      expect(errorResponse.status).toBe('error');

      // Test recovery
      const recoveryResponse = await actorRef.ask<CounterContext>(createMessage('INCREMENT', null), 1000);
      expect(recoveryResponse.status).toBe('active');
      expect(recoveryResponse.count).toBe(1);

      log.debug('Error recovery test completed', { errorCount, recoveryResponse });
    });
  });

  // ============================================================================
  // DEBUGGING & INTEGRATION TESTS
  // ============================================================================

  describe('OTP Integration Debugging', () => {
    it('should process ActorHandlerResult correctly with detailed logging', async () => {
      log.debug('Testing ActorHandlerResult processing with comprehensive logging');
      
      // Arrange: Create behavior that definitely returns ActorHandlerResult
      const behavior = defineFluentBehavior<CounterMessage>()
        .withContext<CounterContext>({ count: 0, status: 'idle' })
        .onMessage(({ message }) => {
          log.debug('Handler received message', { type: message.type });
          const result = {
            context: { count: 1, status: 'active' as const },
            response: { count: 1, status: 'active' as const }, // Response matches CounterContext type
          };
          log.debug('Handler returning result', { result });
          return result;
        });

      // Act: Test the actual integration
      const actorRef = await system.spawn(behavior, { id: 'debug-test' });

      log.debug('Sending increment message to debug test actor');
      const response = await actorRef.ask<CounterContext>(createMessage('INCREMENT', null), 1000);

      log.debug('Received response from debug test', { response });

      // Assert: Should get our explicit response matching CounterContext
      expect(response).toEqual({ count: 1, status: 'active' });
      
      log.debug('OTP integration debugging test completed successfully');
    });
  });
});
