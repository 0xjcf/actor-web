/**
 * @module actor-core/runtime/message-plan
 * @description Message Plan DSL Foundation for OTP-style Actor Implementation
 *
 * This module implements the core Message Plan Domain Specific Language that enables
 * declarative message routing patterns. Message plans allow actors to specify their
 * communication intentions as data structures rather than imperative calls.
 *
 * Key Features:
 * - Type-safe message plan union types
 * - Domain event fan-out instructions
 * - Point-to-point send instructions
 * - Request-response ask instructions
 * - Comprehensive type guards for runtime validation
 *
 * @author OTP Implementation Team
 * @version 1.0.0
 */

import type { JsonValue } from './actor-system.js';

// ============================================================================
// DOMAIN EVENT TYPES
// ============================================================================

/**
 * Domain events represent business events that should be broadcast
 * to both the XState machine (for state transitions) and the actor system
 * (for event emission to subscribers).
 */
export interface DomainEvent {
  /** Event type identifier */
  readonly type: string;
  /** Event payload - must be JSON serializable */
  readonly [key: string]: JsonValue | undefined;
}

/**
 * Type guard that ensures a domain event is valid and JSON serializable
 */
export type ValidDomainEvent<T> = T extends DomainEvent
  ? T extends { type: infer U }
    ? U extends string
      ? Omit<T, 'type'> extends Record<string, JsonValue | undefined>
        ? T
        : never
      : never
    : never
  : never;

/**
 * Runtime type guard to validate domain events
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

// ============================================================================
// ACTOR REFERENCE TYPES
// ============================================================================

/**
 * Minimal actor reference interface for message plan instructions
 * This will be extended with the full ActorRef implementation
 */
export interface ActorRef<TMessage = unknown> {
  /** Phantom type for message type checking */
  readonly _messageType?: TMessage;
  /** Actor identifier */
  readonly id: string;
  /** Send a message to this actor (fire-and-forget) */
  send(message: TMessage): Promise<void>;
  /** Ask pattern - send message and wait for response */
  ask<TResponse = unknown>(message: TMessage, timeout?: number): Promise<TResponse>;
}

/**
 * Basic actor message structure
 */
export interface ActorMessage {
  readonly type: string;
  readonly payload?: JsonValue | null;
  readonly timestamp?: number;
  readonly version?: string;
}

// ============================================================================
// MESSAGE PLAN INSTRUCTION TYPES
// ============================================================================

/**
 * Send instruction for point-to-point message delivery (tell pattern)
 */
export interface SendInstruction {
  /** Target actor reference */
  readonly to: ActorRef<unknown>;
  /** Message to send */
  readonly tell: ActorMessage;
  /** Delivery mode */
  readonly mode: 'fireAndForget' | 'retry(3)' | 'guaranteed';
}

/**
 * Ask instruction for request-response pattern
 */
export interface AskInstruction<TResponse = unknown> {
  /** Target actor reference */
  readonly to: ActorRef<unknown>;
  /** Request message to send */
  readonly ask: ActorMessage;
  /** Success callback or domain event */
  readonly onOk?: DomainEvent | ((response: TResponse) => DomainEvent);
  /** Error callback or domain event */
  readonly onError?: DomainEvent | ((error: Error) => DomainEvent);
  /** Request timeout in milliseconds */
  readonly timeout?: number;
}

// ============================================================================
// MESSAGE PLAN DSL UNION TYPE
// ============================================================================

/**
 * Message Plan - The core DSL type that represents declarative communication intentions
 *
 * A message plan can be:
 * - A domain event (automatically fans out to machine + actor system)
 * - A send instruction (point-to-point tell)
 * - An ask instruction (request-response)
 * - An array of any combination of the above
 * - void (no action)
 */
export type MessagePlan<TDomainEvent = DomainEvent> =
  | ValidDomainEvent<TDomainEvent> // Fan-out broadcast
  | SendInstruction // Point-to-point tell
  | AskInstruction // Request/response
  | (ValidDomainEvent<TDomainEvent> | SendInstruction | AskInstruction)[] // Multiple operations
  | undefined; // No action

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if a value is a send instruction
 */
export function isSendInstruction(value: unknown): value is SendInstruction {
  return (
    value !== null &&
    typeof value === 'object' &&
    'to' in value &&
    'tell' in value &&
    typeof (value as SendInstruction).to === 'object' &&
    typeof (value as SendInstruction).tell === 'object' &&
    isActorMessage((value as SendInstruction).tell)
  );
}

/**
 * Type guard to check if a value is an ask instruction
 */
export function isAskInstruction(value: unknown): value is AskInstruction {
  return (
    value !== null &&
    typeof value === 'object' &&
    'to' in value &&
    'ask' in value &&
    'onOk' in value &&
    typeof (value as AskInstruction).to === 'object' &&
    typeof (value as AskInstruction).ask === 'object' &&
    isActorMessage((value as AskInstruction).ask) &&
    (isDomainEvent((value as AskInstruction).onOk) ||
      typeof (value as AskInstruction).onOk === 'function')
  );
}

/**
 * Type guard to check if a value is an actor message
 */
export function isActorMessage(value: unknown): value is ActorMessage {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    typeof (value as ActorMessage).type === 'string'
  );
}

/**
 * Type guard to check if a value is a valid message plan
 */
export function isMessagePlan(value: unknown): value is MessagePlan {
  if (value === null || value === undefined) {
    return true; // void is valid
  }

  if (Array.isArray(value)) {
    return value.every(
      (item) => isDomainEvent(item) || isSendInstruction(item) || isAskInstruction(item)
    );
  }

  return isDomainEvent(value) || isSendInstruction(value) || isAskInstruction(value);
}

// ============================================================================
// JSON SERIALIZATION HELPER
// ============================================================================

/**
 * Runtime type guard to check if a value is JSON serializable
 * This prevents non-serializable data from being used in message plans
 */
export function isJsonSerializable(value: unknown): value is JsonValue {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonSerializable);
  }

  if (typeof value === 'object') {
    // Check for non-serializable types
    if (value instanceof Date || value instanceof RegExp || value instanceof Error) {
      return false;
    }

    if (
      value instanceof Map ||
      value instanceof Set ||
      value instanceof WeakMap ||
      value instanceof WeakSet
    ) {
      return false;
    }

    // Check for promises
    if (typeof (value as { then?: unknown }).then === 'function') {
      return false;
    }

    // Check for functions
    for (const key in value) {
      const prop = (value as Record<string, unknown>)[key];
      if (typeof prop === 'function') {
        return false;
      }
      if (!isJsonSerializable(prop)) {
        return false;
      }
    }

    return true;
  }

  return false;
}

// ============================================================================
// MESSAGE PLAN FACTORY FUNCTIONS
// ============================================================================

/**
 * Factory function to create send instructions
 */
export function createSendInstruction(
  to: ActorRef<unknown>,
  tell: ActorMessage,
  mode: 'fireAndForget' | 'retry(3)' | 'guaranteed' = 'fireAndForget'
): SendInstruction {
  return { to, tell, mode };
}

/**
 * Factory function to create ask instructions
 */
export function createAskInstruction<TResponse = unknown>(
  to: ActorRef<unknown>,
  ask: ActorMessage,
  onOk?: DomainEvent | ((response: TResponse) => DomainEvent),
  onError?: DomainEvent | ((error: Error) => DomainEvent),
  timeout = 5000
): AskInstruction<TResponse> {
  return { to, ask, onOk, onError, timeout };
}

/**
 * Create a domain event for fan-out broadcast
 */
export function createDomainEvent<T extends DomainEvent>(event: T): ValidDomainEvent<T> {
  if (!isDomainEvent(event)) {
    throw new Error(`Invalid domain event: ${JSON.stringify(event)}`);
  }
  return event as ValidDomainEvent<T>;
}
