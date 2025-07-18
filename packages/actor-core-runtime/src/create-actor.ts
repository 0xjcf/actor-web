/**
 * @module actor-core/runtime/create-actor
 * @description Unified actor creation API with type-safe event emission
 * @author Agent A - 2025-07-18
 *
 * This module implements the createActor function which provides a single API
 * for creating actors from various sources (ActorDefinition, XState machines, etc.)
 * while maintaining compile-time type safety for emitted events.
 */

import type { AnyStateMachine } from 'xstate';
import type { ActorMessage, SupervisionStrategy } from './actor-system.js';

/**
 * Actor behavior result with mandatory object shape
 * This eliminates the problematic union type that prevented
 * proper excess property checking and provides better error messages
 */
export interface ActorBehaviorResult<TContext, TEmitted> {
  readonly context: TContext;
  readonly emit?: TEmitted | TEmitted[];
}

/**
 * Actor definition interface
 * Following Lit-bit naming conventions
 */
export interface ActorDefinition<
  TMessage = ActorMessage,
  TContext = unknown,
  TEmitted = ActorMessage,
> {
  /**
   * Initial context state
   */
  readonly context?: TContext;

  /**
   * Message handler - always returns { context, emit? } shape
   * @returns Promise with validated emit events
   */
  readonly onMessage: (params: {
    readonly message: TMessage;
    readonly context: TContext;
  }) => Promise<ActorBehaviorResult<TContext, TEmitted>>;

  /**
   * Lifecycle hook - actor start
   */
  readonly onStart?: (params: {
    readonly context: TContext;
  }) => Promise<ActorBehaviorResult<TContext, TEmitted>>;

  /**
   * Lifecycle hook - actor stop
   */
  readonly onStop?: (params: {
    readonly context: TContext;
  }) => Promise<void>;

  /**
   * Supervision strategy for fault tolerance
   */
  readonly supervisionStrategy?: SupervisionStrategy;
}

/**
 * Configuration for behavior-based actors
 */
export interface BehaviorActorConfig<
  TMessage = ActorMessage,
  TContext = unknown,
  TEmitted = ActorMessage,
> {
  /**
   * Type definitions for compile-time validation
   */
  readonly types?: {
    readonly message?: TMessage;
    readonly context?: TContext;
    readonly emitted?: TEmitted;
  };

  /**
   * Initial context state
   */
  readonly context?: TContext;

  /**
   * Message handler - enforces { context, emit? } return shape with type validation
   * @returns Behavior result with validated emit events
   */
  readonly onMessage: (params: {
    readonly message: TMessage;
    readonly context: TContext;
  }) => Promise<ActorBehaviorResult<TContext, TEmitted>> | ActorBehaviorResult<TContext, TEmitted>;

  /**
   * Optional lifecycle handlers
   */
  readonly onStart?: (params: {
    readonly context: TContext;
  }) => Promise<ActorBehaviorResult<TContext, TEmitted>> | ActorBehaviorResult<TContext, TEmitted>;

  readonly onStop?: (params: {
    readonly context: TContext;
  }) => Promise<void> | void;

  /**
   * Supervision strategy
   */
  readonly supervisionStrategy?: SupervisionStrategy;
}

/**
 * XState machine configuration for createActor
 */
export interface XStateActorConfig {
  /**
   * XState state machine definition
   */
  readonly machine: AnyStateMachine;

  /**
   * Optional input/context for the machine
   */
  readonly input?: Record<string, unknown>;
}

/**
 * Union type for all supported actor configurations
 */
export type CreateActorConfig<
  TMessage = ActorMessage,
  TContext = unknown,
  TEmitted = ActorMessage,
> =
  | BehaviorActorConfig<TMessage, TContext, TEmitted>
  | XStateActorConfig
  | ActorDefinition<TMessage, TContext, TEmitted>;

/**
 * Type guard to check if config is a BehaviorActorConfig
 */
function isBehaviorConfig<TMessage, TContext, TEmitted>(
  config: CreateActorConfig<TMessage, TContext, TEmitted>
): config is BehaviorActorConfig<TMessage, TContext, TEmitted> {
  return 'onMessage' in config && typeof config.onMessage === 'function' && !('machine' in config);
}

/**
 * Type guard to check if config is an XStateActorConfig
 */
function isXStateConfig<TMessage, TContext, TEmitted>(
  config: CreateActorConfig<TMessage, TContext, TEmitted>
): config is XStateActorConfig {
  return 'machine' in config && typeof config.machine === 'object';
}

/**
 * Type guard to check if config is an ActorDefinition
 */
function isActorDefinition<TMessage, TContext, TEmitted>(
  config: CreateActorConfig<TMessage, TContext, TEmitted>
): config is ActorDefinition<TMessage, TContext, TEmitted> {
  return 'onMessage' in config && typeof config.onMessage === 'function';
}

/**
 * Type guard to check if a value is a Promise
 */
function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return value instanceof Promise;
}

/**
 * Create an actor from behavior configuration
 */
function createActorFromBehavior<
  TMessage = ActorMessage,
  TContext = unknown,
  TEmitted = ActorMessage,
>(
  config: BehaviorActorConfig<TMessage, TContext, TEmitted>
): ActorDefinition<TMessage, TContext, TEmitted> {
  return {
    context: config.context,
    supervisionStrategy: config.supervisionStrategy,

    onMessage: async (params) => {
      const result = config.onMessage(params);
      return isPromise(result) ? result : Promise.resolve(result);
    },

    onStart: config.onStart
      ? async (params) => {
          const result = config.onStart!(params);
          return isPromise(result) ? result : Promise.resolve(result);
        }
      : undefined,

    onStop: config.onStop
      ? async (params) => {
          const result = config.onStop!(params);
          return isPromise(result) ? result : Promise.resolve(result);
        }
      : undefined,
  };
}

/**
 * Create an actor from XState machine
 * Note: This returns an ActorDefinition that wraps the XState machine
 */
function createActorFromXState<
  TMessage = ActorMessage,
  TContext = unknown,
  TEmitted = ActorMessage,
>(config: XStateActorConfig): ActorDefinition<TMessage, TContext, TEmitted> {
  // This is a simplified adapter - in a real implementation,
  // we would need to properly bridge XState actors with our actor system
  return {
    context: config.input as TContext,

    onMessage: async ({ context }) => {
      // In a real implementation, we would:
      // 1. Create or get the XState actor instance
      // 2. Send the message as an XState event
      // 3. Extract the new state and any emitted events
      // 4. Return in our format

      // For now, this is a placeholder that shows the pattern
      console.warn('XState actor integration not yet implemented');
      return { context };
    },

    // XState handles its own lifecycle
    onStart: undefined,
    onStop: undefined,
  };
}

/**
 * Create an actor with type-safe behavior
 *
 * This function provides a unified API for creating actors from various sources:
 * - Behavior-based actors with compile-time type safety
 * - XState state machines
 * - Direct ActorDefinition objects
 *
 * @example
 * ```typescript
 * // Behavior-based actor
 * const counterActor = createActor({
 *   context: { count: 0 },
 *   behavior: {
 *     onMessage: ({ message, context }) => {
 *       if (message.type === 'INCREMENT') {
 *         return {
 *           context: { count: context.count + 1 },
 *           emit: { type: 'COUNTED', data: `Count is ${context.count + 1}` }
 *         };
 *       }
 *       return { context };
 *     }
 *   }
 * });
 *
 * // XState machine (future)
 * const toggleActor = createActor({
 *   machine: toggleMachine,
 *   input: { initialValue: false }
 * });
 *
 * // Direct ActorDefinition
 * const customActor = createActor(myActorDefinition);
 * ```
 */
export function createActor<TMessage = ActorMessage, TContext = unknown, TEmitted = ActorMessage>(
  config: CreateActorConfig<TMessage, TContext, TEmitted>
): ActorDefinition<TMessage, TContext, TEmitted> {
  if (isBehaviorConfig(config)) {
    return createActorFromBehavior(config);
  }

  if (isXStateConfig(config)) {
    return createActorFromXState<TMessage, TContext, TEmitted>(config);
  }

  if (isActorDefinition(config)) {
    return config;
  }

  throw new Error('Invalid actor configuration');
}

/**
 * Type helper for extracting message types from an actor definition
 */
export type ActorMessageType<T> = T extends ActorDefinition<infer M, any, any> ? M : never;

/**
 * Type helper for extracting context type from an actor definition
 */
export type ActorContextType<T> = T extends ActorDefinition<any, infer C, any> ? C : never;

/**
 * Type helper for extracting emitted event types from an actor definition
 */
export type ActorEmittedType<T> = T extends ActorDefinition<any, any, infer E> ? E : never;
