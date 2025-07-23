/**
 * @module actor-core/runtime/component-behavior
 * @description Type-safe component behavior definitions for the Actor-Web framework
 *
 * This module provides the ComponentBehaviorConfig interface and related types
 * that extend the standard actor behavior with component-specific capabilities
 * while maintaining full type safety and JSON serializability.
 */

import type { Actor, AnyStateMachine } from 'xstate';
import type { ActorBehavior, ActorMessage, ActorPID, JsonValue } from './actor-system.js';

// Import our fan-out types
import type { DomainEvent, FanOutResult, ValidDomainEvent } from './runtime-fanout.js';

// ============================================================================
// SERIALIZATION TYPES - Ensure compile-time JSON safety
// ============================================================================

/**
 * Type guard that ensures a type is JSON-serializable
 * This prevents non-serializable data (functions, DOM nodes, etc.) at compile time
 */
export type SerializableEvent<T> = T extends JsonValue ? T : never;

/**
 * Type guard to check if a value is JSON-serializable at runtime
 */
export function isJsonSerializable(value: unknown): value is JsonValue {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return true;

  if (Array.isArray(value)) {
    return value.every(isJsonSerializable);
  }

  if (typeof value === 'object') {
    // Check for non-serializable types
    if (value instanceof Date || value instanceof RegExp || value instanceof Error) return false;
    if (
      value instanceof Map ||
      value instanceof Set ||
      value instanceof WeakMap ||
      value instanceof WeakSet
    )
      return false;
    if (typeof (value as { then?: unknown }).then === 'function') return false; // Promises

    // Check all properties
    return Object.values(value).every(isJsonSerializable);
  }

  return false;
}

// ============================================================================
// COMPONENT BEHAVIOR TYPES
// ============================================================================

/**
 * Dependencies available to a component actor
 * Maps dependency names to actor addresses or PIDs
 */
export interface ComponentDependencies {
  [key: string]: string | ActorPID;
}

/**
 * Component-specific message handler parameters (Fan-out Standard)
 * Clean interface focused on fan-out return values instead of manual emit calls
 */
export interface ComponentMessageParams<
  TMessage,
  TContext,
  TMachine extends AnyStateMachine = AnyStateMachine,
> {
  /** The message received by the component */
  readonly message: TMessage;

  /** Current component context/state */
  readonly context: TContext;

  /** XState machine instance for UI state management */
  readonly machine: Actor<TMachine>;

  /** Resolved actor dependencies */
  readonly dependencies: Record<string, ActorPID>;
}

/**
 * Component behavior configuration enforcing fan-out as the standard
 *
 * @template TMessage - The message types the component can receive
 * @template TContext - The component's context/state type
 * @template TDomainEvent - The domain events that trigger automatic fan-out
 * @template TMachine - The XState machine type for UI logic
 */
export interface ComponentBehaviorConfig<
  TMessage = ActorMessage,
  TContext = unknown,
  TDomainEvent = DomainEvent,
  TMachine extends AnyStateMachine = AnyStateMachine,
> extends Omit<ActorBehavior<TMessage, TContext, unknown>, 'onMessage'> {
  /**
   * Fan-out message handler - the standard and only supported approach
   *
   * Return options:
   * 1. Direct domain event for automatic fan-out to machine.send() + emit()
   * 2. Array of domain events for multiple simultaneous fan-outs
   * 3. Enhanced result with context + optional domain events
   *
   * @example
   * ```typescript
   * // ✅ Direct domain event (recommended)
   * onMessage: ({ message, context }) => {
   *   return { type: 'FORM_SAVED', id: message.id };  // Auto fan-out!
   * }
   *
   * // ✅ Multiple domain events
   * onMessage: ({ message }) => {
   *   return [
   *     { type: 'FORM_SAVED', id: message.id },
   *     { type: 'ANALYTICS_EVENT', action: 'save' }
   *   ];
   * }
   *
   * // ✅ Enhanced result with context
   * onMessage: ({ context }) => {
   *   return {
   *     context: { ...context, lastSaved: Date.now() },
   *     fanOut: { type: 'FORM_SAVED', id: '123' }
   *   };
   * }
   * ```
   */
  readonly onMessage: (
    params: ComponentMessageParams<TMessage, TContext, TMachine>
  ) => Promise<FanOutResult<TContext, never, ValidDomainEvent<TDomainEvent>>>;

  /**
   * Dependencies required by this component
   * Can be actor addresses (resolved at mount time) or direct PIDs
   */
  readonly dependencies?: ComponentDependencies;

  /**
   * Mailbox configuration for message queue management
   */
  readonly mailbox?: {
    readonly capacity: number;
    readonly strategy: 'drop-oldest' | 'drop-newest' | 'suspend';
  };

  /**
   * Transport layer selection for location transparency
   */
  readonly transport?: 'local' | 'worker' | 'websocket';
}

// ============================================================================
// COMPONENT BEHAVIOR BUILDER
// ============================================================================

/**
 * Type-safe builder for component behaviors
 * Ensures proper typing throughout the configuration
 */
export class ComponentBehaviorBuilder<
  TMessage = ActorMessage,
  TContext = unknown,
  TEmitted = ActorMessage,
  TMachine extends AnyStateMachine = AnyStateMachine,
> {
  private config: {
    context?: TContext;
    onMessage?: ComponentBehaviorConfig<TMessage, TContext, TEmitted, TMachine>['onMessage'];
    dependencies?: ComponentDependencies;
    mailbox?: ComponentBehaviorConfig['mailbox'];
    transport?: ComponentBehaviorConfig['transport'];
    supervisionStrategy?: ComponentBehaviorConfig['supervisionStrategy'];
  } = {};

  /**
   * Set the initial context
   */
  context(context: TContext): this {
    this.config.context = context;
    return this;
  }

  /**
   * Set the message handler
   */
  onMessage(
    handler: ComponentBehaviorConfig<TMessage, TContext, TEmitted, TMachine>['onMessage']
  ): this {
    this.config.onMessage = handler;
    return this;
  }

  /**
   * Set component dependencies
   */
  dependencies(deps: ComponentDependencies): this {
    this.config.dependencies = deps;
    return this;
  }

  /**
   * Configure mailbox settings
   */
  mailbox(settings: ComponentBehaviorConfig['mailbox']): this {
    this.config.mailbox = settings;
    return this;
  }

  /**
   * Set transport type
   */
  transport(type: ComponentBehaviorConfig['transport']): this {
    this.config.transport = type;
    return this;
  }

  /**
   * Build the final configuration
   */
  build(): ComponentBehaviorConfig<TMessage, TContext, TEmitted, TMachine> {
    if (!this.config.onMessage) {
      throw new Error('Component behavior must have an onMessage handler');
    }

    return this.config as ComponentBehaviorConfig<TMessage, TContext, TEmitted, TMachine>;
  }
}

/**
 * Create a type-safe component behavior builder
 *
 * @example
 * ```typescript
 * const behavior = componentBehavior<FormMessage, FormContext, FormEvent>()
 *   .context({ formData: {}, isSubmitting: false })
 *   .onMessage(async ({ message, context, machine, emit }) => {
 *     if (message.type === 'SUBMIT_FORM') {
 *       emit({ type: 'FORM_SUBMITTED', data: context.formData });
 *       return {
 *         context: { ...context, isSubmitting: true }
 *       };
 *     }
 *     return { context };
 *   })
 *   .dependencies({
 *     backend: 'actor://system/backend',
 *     validator: 'actor://system/validator'
 *   })
 *   .build();
 * ```
 */
export function componentBehavior<
  TMessage = ActorMessage,
  TContext = unknown,
  TEmitted = ActorMessage,
  TMachine extends AnyStateMachine = AnyStateMachine,
>(): ComponentBehaviorBuilder<TMessage, TContext, TEmitted, TMachine> {
  return new ComponentBehaviorBuilder();
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if a behavior is a component behavior
 */
export function isComponentBehavior<T, C, E>(
  behavior: ActorBehavior<T, C, E> | ComponentBehaviorConfig<T, C, E>
): behavior is ComponentBehaviorConfig<T, C, E> {
  return 'dependencies' in behavior || 'mailbox' in behavior || 'transport' in behavior;
}

/**
 * Validate that an event is JSON-serializable
 * Throws a descriptive error if not
 */
export function validateSerializableEvent<T>(event: T, eventType?: string): SerializableEvent<T> {
  if (!isJsonSerializable(event)) {
    const typeName = eventType || 'Event';
    const value = JSON.stringify(event, (_, v) => {
      if (typeof v === 'function') return '[Function]';
      if (v instanceof Date) return '[Date]';
      if (v instanceof RegExp) return '[RegExp]';
      if (v instanceof Error) return '[Error]';
      if (v instanceof Map) return '[Map]';
      if (v instanceof Set) return '[Set]';
      return v;
    });
    throw new Error(
      `${typeName} is not JSON-serializable. ` +
        `Found non-serializable value: ${value}. ` +
        'Events must only contain JSON-compatible data types.'
    );
  }
  return event as SerializableEvent<T>;
}
