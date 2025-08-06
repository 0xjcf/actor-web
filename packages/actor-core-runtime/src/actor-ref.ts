/**
 * @module actor-core/runtime/actor-ref
 * @description Typed ActorRef interface - the primary public interface for actor references
 *
 * This module provides the ActorRef interface which is the only public-facing way to
 * interact with actors. It extends the internal ActorPID interface with type safety
 * and additional convenience methods.
 *
 * This implements the "typed interface, dynamic implementation" pattern used by
 * mature actor frameworks like Orleans and Akka Typed.
 */

import type { ActorInstance } from './actor-instance.js';
import type { ActorAddress, ActorMessage, ActorPID, ActorStats } from './actor-system.js';
import type { ActorSnapshot, BaseEventObject, JsonValue, Message } from './types.js';

/**
 * Phantom type symbol for compile-time context type tagging.
 * This symbol is used to "brand" actor references with their context type
 * without any runtime overhead.
 */
declare const __contextType: unique symbol;

/**
 * Phantom type symbol for compile-time message type tagging.
 * Used to associate actor references with their expected message types.
 */
declare const __messageType: unique symbol;

/**
 * Typed actor reference that preserves context and message types at compile time
 * while maintaining polymorphic storage at runtime.
 *
 * This interface extends ActorPID but overrides methods to use specific types:
 * - TContext: The actor's context type (e.g., { count: number })
 * - TMessage: The message types this actor can handle
 *
 * @template TContext The actor's context type (default: unknown for stateless actors)
 * @template TMessage The message types this actor handles (default: ActorMessage)
 *
 * @example
 * ```typescript
 * // Context actor with typed context
 * const counterRef: ActorRef<{ count: number }> = await system.spawn(counterBehavior);
 * const snapshot = counterRef.getSnapshot();
 * log.debug(snapshot.context.count); // ✅ TypeScript knows this is number
 *
 * // Stateless actor
 * const routerRef: ActorRef = await system.spawn(routerBehavior);
 * const snapshot = routerRef.getSnapshot();
 * log.debug(snapshot.context); // ✅ TypeScript knows this is {}
 * ```
 */
export interface ActorRef<TContext = unknown, TMessage extends ActorMessage = ActorMessage>
  extends ActorPID {
  /**
   * Phantom type properties for compile-time type tracking.
   * These don't exist at runtime but enable TypeScript to track types.
   */
  readonly [__contextType]?: TContext;
  readonly [__messageType]?: TMessage;

  /**
   * Get current snapshot with properly typed context
   */
  getSnapshot(): ActorSnapshot<TContext>;

  // send and ask are inherited from ActorPID with flexible typing
  // They accept any message with a type field, not just TMessage
}

/**
 * Type guard to check if an object is a typed ActorRef
 */
export function isActorRef<TContext = unknown, TMessage extends ActorMessage = ActorMessage>(
  value: unknown
): value is ActorRef<TContext, TMessage> {
  // Since ActorRef is just a typed view of ActorInstance, we check for ActorInstance
  return (
    value !== null &&
    typeof value === 'object' &&
    'id' in value &&
    'getType' in value &&
    'getSnapshot' in value &&
    'send' in value &&
    'ask' in value
  );
}

/**
 * Create a typed ActorRef from an ActorInstance.
 * This is the core function that provides the "typed facade" over the polymorphic instance.
 *
 * @param instance The polymorphic ActorInstance
 * @param address The actor's address
 * @returns A typed ActorRef that wraps the instance
 *
 * @internal This function performs a safe type cast since we control the creation flow
 */
export function createTypedActorRef<
  TContext = unknown,
  TMessage extends ActorMessage = ActorMessage,
>(
  instance: ActorInstance,
  address: ActorAddress,
  // Optional context hint for better inference (Research Pattern #5)
  _contextHint?: TContext
): ActorRef<TContext, TMessage> {
  // Create a typed wrapper that delegates to the underlying instance
  // This is safe because we control the actor creation process and ensure type consistency
  const typedRef: ActorRef<TContext, TMessage> = {
    // ActorPID properties
    address,

    // Override getSnapshot to return properly typed context
    getSnapshot(): ActorSnapshot<TContext> {
      const snapshot = instance.getSnapshot();
      // The context is already the correct type at runtime (we created it that way)
      // This cast tells TypeScript to trust us that the context is TContext
      return {
        ...snapshot,
        context: snapshot.context as TContext,
      };
    },

    // Flexible send method (accepts any message with a type field)
    async send<T extends { type: string }>(message: T): Promise<void> {
      instance.send(message);
    },

    // Flexible ask method (accepts any message with a type field)
    async ask<TResponse = JsonValue>(message: Message, timeout?: number): Promise<TResponse> {
      return instance.ask<TResponse>(message, timeout);
    },

    // ActorPID required methods
    async stop(): Promise<void> {
      await instance.stop();
    },

    async isAlive(): Promise<boolean> {
      return instance.status !== 'stopped' && instance.status !== 'error';
    },

    async getStats(): Promise<ActorStats> {
      return {
        messagesReceived: 0,
        messagesProcessed: 0,
        errors: 0,
        uptime: 0,
      };
    },
  };

  return typedRef;
}

/**
 * Utility type to extract the context type from an ActorRef
 */
export type ContextOf<T> = T extends ActorRef<infer TContext, ActorMessage> ? TContext : never;

/**
 * Utility type to extract the message type from an ActorRef
 */
export type MessageOf<T> = T extends ActorRef<unknown, infer TMessage> ? TMessage : never;

/**
 * Type alias for stateless actors (no context)
 */
export type StatelessActorRef<TMessage extends ActorMessage = ActorMessage> = ActorRef<
  Record<string, never>,
  TMessage
>;

/**
 * Type alias for context-based actors
 */
export type ContextActorRef<TContext, TMessage extends ActorMessage = ActorMessage> = ActorRef<
  TContext,
  TMessage
>;

/**
 * Type alias for machine-based actors (context from XState machine)
 */
export type MachineActorRef<TContext, TMessage extends ActorMessage = ActorMessage> = ActorRef<
  TContext,
  TMessage
>;

// ========================================================================================
// SUPPORTING TYPES AND ERRORS
// ========================================================================================

/**
 * Error thrown when attempting to interact with a stopped actor
 */
export class ActorStoppedError extends Error {
  constructor(actorId: string, operation: string) {
    super(`Cannot ${operation} on stopped actor: ${actorId}`);
    this.name = 'ActorStoppedError';
  }
}

/**
 * Error thrown when an actor operation times out
 */
export class TimeoutError extends Error {
  constructor(timeout: number, operation: string) {
    super(`${operation} timed out after ${timeout}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Check if an event is a response event
 */
export function isResponseEvent(event: BaseEventObject): boolean {
  return '_response' in event && event._response === true;
}
