/**
 * @module actor-core/runtime/runtime-fanout
 * @description Runtime Fan-Out Shortcut - Eliminate machine.send() + emit() boilerplate
 *
 * This module implements the fan-out shortcut feature that allows component handlers
 * to return domain events directly, which the runtime automatically fans out to both
 * the XState machine and the actor event system.
 *
 * Key Features:
 * - Type-safe domain event return values
 * - Automatic fan-out to machine.send() and emit()
 * - Backward compatibility with existing emit() calls
 * - Atomic persistence with transactional outbox (Phase 3)
 */

import type { JsonValue } from './actor-system.js';
import type { SerializableEvent } from './component-behavior.js';

// ============================================================================
// DOMAIN EVENT TYPE SYSTEM
// ============================================================================

/**
 * Marker interface for domain events that can trigger automatic fan-out
 * Domain events represent things that happened in the business domain
 */
export interface DomainEvent extends Record<string, JsonValue> {
  readonly type: string;
}

/**
 * Type guard that ensures a type is a valid domain event
 * Must be JSON-serializable and have a type property
 */
export type ValidDomainEvent<T> = T extends DomainEvent ? (T extends JsonValue ? T : never) : never;

/**
 * Runtime type guard to check if a value is a domain event
 */
export function isDomainEvent(value: unknown): value is DomainEvent {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    typeof (value as { type: unknown }).type === 'string' &&
    isJsonSerializable(value)
  );
}

/**
 * Runtime type guard for JSON serializability
 * Ensures the event can be stored, transmitted, and replayed
 */
function isJsonSerializable(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (value === undefined) return false; // JSON cannot serialize undefined
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
// ENHANCED BEHAVIOR RESULT TYPES
// ============================================================================

/**
 * Enhanced ActorBehaviorResult that supports direct event return
 * This enables the fan-out shortcut syntax: return { type: 'EVENT' }
 */
export interface EnhancedActorBehaviorResult<TContext, TEmitted> {
  readonly context: TContext;
  readonly emit?: TEmitted | TEmitted[];
}

/**
 * Union type for all possible return values from enhanced message handlers
 * Supports both traditional { context, emit } and direct event returns
 */
export type FanOutResult<TContext, TEmitted, TDomainEvent> =
  | EnhancedActorBehaviorResult<TContext, TEmitted>
  | ValidDomainEvent<TDomainEvent>
  | ValidDomainEvent<TDomainEvent>[];

// ============================================================================
// ENHANCED MESSAGE HANDLER SIGNATURES
// ============================================================================

/**
 * Enhanced message handler that supports fan-out return values
 * Can return traditional { context, emit } or direct domain events
 */
export type EnhancedMessageHandler<TMessage, TContext, TEmitted, TDomainEvent> = (params: {
  readonly message: TMessage;
  readonly context: TContext;
}) => Promise<FanOutResult<TContext, TEmitted, TDomainEvent>>;

/**
 * Enhanced component message handler with machine, dependencies, and emit
 */
export type EnhancedComponentMessageHandler<TMessage, TContext, TMachine, TEmitted, TDomainEvent> =
  (params: {
    readonly message: TMessage;
    readonly context: TContext;
    readonly machine: TMachine;
    readonly dependencies: Record<string, unknown>;
    readonly emit: <TEvent extends JsonValue>(event: SerializableEvent<TEvent>) => void;
  }) => Promise<FanOutResult<TContext, TEmitted, TDomainEvent>>;

// ============================================================================
// FAN-OUT DETECTION AND PROCESSING
// ============================================================================

/**
 * Fan-out detection result
 */
export interface FanOutDetectionResult<TContext, TEmitted> {
  readonly context: TContext;
  readonly emit?: TEmitted | TEmitted[];
  readonly fanOutEvents: DomainEvent[];
}

/**
 * Analyzes a message handler result and extracts fan-out events
 * This is the core logic that enables the shortcut syntax
 */
export function detectFanOutEvents<TContext, TEmitted, TDomainEvent>(
  result: FanOutResult<TContext, TEmitted, TDomainEvent>,
  originalContext: TContext
): FanOutDetectionResult<TContext, TEmitted> {
  // Case 1: Direct domain event return
  if (isDomainEvent(result)) {
    return {
      context: originalContext,
      emit: undefined,
      fanOutEvents: [result],
    };
  }

  // Case 2: Array of domain events
  if (Array.isArray(result) && result.every(isDomainEvent)) {
    return {
      context: originalContext,
      emit: undefined,
      fanOutEvents: result,
    };
  }

  // Case 3: Traditional { context, emit } result
  if (typeof result === 'object' && result !== null && 'context' in result) {
    const behaviorResult = result as EnhancedActorBehaviorResult<TContext, TEmitted>;
    return {
      context: behaviorResult.context,
      emit: behaviorResult.emit,
      fanOutEvents: [],
    };
  }

  // Case 4: Invalid result - fallback to original context
  console.warn('Invalid message handler result, using original context');
  return {
    context: originalContext,
    emit: undefined,
    fanOutEvents: [],
  };
}

// ============================================================================
// IMPERATIVE HELPER API
// ============================================================================

/**
 * Imperative helper for emitting and sending events simultaneously
 * Provides escape hatch for cases where direct return isn't suitable
 */
export class FanOutHelper<TDomainEvent extends DomainEvent = DomainEvent> {
  private events: ValidDomainEvent<TDomainEvent>[] = [];

  /**
   * Queue an event for fan-out to both machine and emit
   */
  emitAndSend<TEvent extends ValidDomainEvent<TDomainEvent>>(event: TEvent): void {
    this.events.push(event);
  }

  /**
   * Get all queued events for processing
   */
  getQueuedEvents(): ValidDomainEvent<TDomainEvent>[] {
    return [...this.events];
  }

  /**
   * Clear the event queue
   */
  clear(): void {
    this.events = [];
  }
}

/**
 * Create a fan-out helper instance for imperative usage
 */
export function createFanOutHelper<
  TDomainEvent extends DomainEvent = DomainEvent,
>(): FanOutHelper<TDomainEvent> {
  return new FanOutHelper<TDomainEvent>();
}

// ============================================================================
// EXAMPLE DOMAIN EVENT TYPES
// ============================================================================

/**
 * Example domain events for documentation and testing
 */
export interface ExampleDomainEvents extends DomainEvent {
  type: 'FORM_SAVED' | 'USER_LOGGED_IN' | 'ORDER_PLACED' | 'PAYMENT_PROCESSED';
}

/**
 * Specific domain event examples
 */
export type FormSavedEvent = ValidDomainEvent<{
  type: 'FORM_SAVED';
  formId: string;
  timestamp: number;
  userId?: string;
}>;

export type UserLoggedInEvent = ValidDomainEvent<{
  type: 'USER_LOGGED_IN';
  userId: string;
  sessionId: string;
  timestamp: number;
}>;

// ============================================================================
// TYPE UTILITIES
// ============================================================================

/**
 * Extract domain event types from a union
 */
export type ExtractDomainEventTypes<T> = T extends DomainEvent ? T['type'] : never;

/**
 * Ensure a type is a valid domain event at compile time
 * Returns the event type if valid, otherwise a helpful error message
 */
export type EnsureValidDomainEvent<T> = ValidDomainEvent<T> extends never
  ? 'Error: Invalid domain event. Must be JSON-serializable and have a type property.'
  : ValidDomainEvent<T>;

/**
 * Create a domain event type with compile-time validation
 */
export type CreateDomainEvent<
  TType extends string,
  TPayload extends JsonValue = null,
> = ValidDomainEvent<
  {
    type: TType;
  } & (TPayload extends null
    ? Record<string, never>
    : TPayload extends Record<string, JsonValue>
      ? TPayload
      : { payload: TPayload })
>;
