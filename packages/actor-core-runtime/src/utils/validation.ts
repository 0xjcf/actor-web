/**
 * @module actor-core/runtime/utils/validation
 * @description Consolidated validation utilities for actor model compliance
 *
 * This module provides all type guards and validation functions needed for:
 * - Message format validation
 * - Actor model compliance checking
 * - JSON serialization validation
 * - Type safety enforcement
 */

import type { ActorMessage } from '../actor-system.js';
import type { DomainEvent, MessagePlan } from '../message-plan.js';
import { isAskInstruction, isSendInstruction } from '../message-plan.js';
import type { JsonValue } from '../types.js';

// ============================================================================
// MESSAGE VALIDATION
// ============================================================================

/**
 * Validates that a value is a proper ActorMessage
 * Enforces flat message structure with underscore-prefixed envelope fields
 */
export function isActorMessage(value: unknown): value is ActorMessage {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const obj = value as Record<string, unknown>;

  // Required field: type
  // Optional envelope fields: _timestamp, _version, _sender, _correlationId
  return (
    'type' in obj &&
    typeof obj.type === 'string' &&
    obj.type.length > 0 &&
    // If _timestamp exists, it must be a number
    (!('_timestamp' in obj) || typeof obj._timestamp === 'number') &&
    // If _version exists, it must be a string
    (!('_version' in obj) || typeof obj._version === 'string') &&
    // If _sender exists, it must be an ActorAddress object
    (!('_sender' in obj) || (typeof obj._sender === 'object' && obj._sender !== null)) &&
    // If _correlationId exists, it must be a string
    (!('_correlationId' in obj) || typeof obj._correlationId === 'string')
  );
}

/**
 * Validates that a value is JSON-serializable
 * Stricter check that ensures pure JSON compatibility
 */
export function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value === 'object') {
    // Must be a plain object (not Date, RegExp, etc.)
    if (value.constructor !== Object && value.constructor !== undefined) {
      return false;
    }
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

/**
 * Validates that a value is a proper DomainEvent
 * Must have type and be JSON-serializable
 */
export function isDomainEvent(value: unknown): value is DomainEvent {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const obj = value as Record<string, unknown>;

  // Must have type field and be JSON-serializable
  return (
    'type' in obj && typeof obj.type === 'string' && obj.type.length > 0 && isJsonValue(value) // Must be fully JSON-serializable
  );
}

/**
 * Validates that a value is a proper MessagePlan
 * Can be null (void), DomainEvent, SendInstruction, or AskInstruction
 */
export function isMessagePlan(value: unknown): value is MessagePlan {
  // Void responses are valid
  if (value === null || value === undefined) {
    return true;
  }

  // Check if it's a domain event
  if (isDomainEvent(value)) {
    return true;
  }

  // Check if it's a send instruction
  if (isSendInstruction(value)) {
    return true;
  }

  // Check if it's an ask instruction
  if (isAskInstruction(value)) {
    return true;
  }

  // Check if it's an array of valid message plans
  if (Array.isArray(value)) {
    // ✅ PURE ACTOR MODEL FIX: Reject nested arrays
    // MessagePlan arrays must be flat - no nested arrays allowed
    return value.every((item) => {
      // Nested arrays are not valid - only allow non-array MessagePlan elements
      if (Array.isArray(item)) {
        return false;
      }
      return isMessagePlan(item);
    });
  }

  return false;
}

/**
 * Validates that an actor message type is valid
 */
export function isValidMessageType(type: unknown): type is string {
  return typeof type === 'string' && type.length > 0;
}

/**
 * Comprehensive actor message validation with detailed error reporting
 */
export function validateActorMessage(value: unknown): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (value === null || typeof value !== 'object') {
    errors.push('Message must be an object');
    return { isValid: false, errors };
  }

  const msg = value as Record<string, unknown>;

  if (!('type' in msg) || typeof msg.type !== 'string') {
    errors.push('Message must have a string type property');
  }

  // Check that all non-envelope fields are JSON-serializable
  for (const key in msg) {
    if (!key.startsWith('_') && key !== 'type') {
      if (!isJsonValue(msg[key])) {
        errors.push(`Message field '${key}' must be JSON-serializable`);
      }
    }
  }

  // Validate envelope fields if present
  if ('_timestamp' in msg && typeof msg._timestamp !== 'number') {
    errors.push('Message _timestamp must be a number');
  }

  if ('_version' in msg && typeof msg._version !== 'string') {
    errors.push('Message _version must be a string');
  }

  if ('_correlationId' in msg && typeof msg._correlationId !== 'string') {
    errors.push('Message _correlationId must be a string');
  }

  if ('_sender' in msg && (typeof msg._sender !== 'object' || msg._sender === null)) {
    errors.push('Message _sender must be an ActorAddress object');
  }

  return { isValid: errors.length === 0, errors };
}

// ============================================================================
// ACTOR MODEL COMPLIANCE VALIDATION
// ============================================================================

/**
 * Validates that a message follows actor model principles
 */
export function validateActorModelCompliance(message: unknown): {
  isCompliant: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  // Check basic message format
  const { isValid, errors } = validateActorMessage(message);
  if (!isValid) {
    violations.push(...errors);
    return { isCompliant: false, violations };
  }

  const msg = message as ActorMessage;

  // Check JSON serialization (location transparency) for all fields
  for (const key in msg) {
    if (!key.startsWith('_') && key !== 'type') {
      const value = msg[key as keyof ActorMessage];
      if (value !== null && !isJsonValue(value)) {
        violations.push(
          `Message field '${key}' violates location transparency (not JSON-serializable)`
        );
      }
    }
  }

  // Check for actor model violations in the entire message
  const messageStr = JSON.stringify(msg);

  // Check for timeout violations
  if (messageStr.includes('setTimeout') || messageStr.includes('setInterval')) {
    violations.push('Message contains timeout violations');
  }

  // Check for direct method call references
  if (messageStr.includes('.call(') || messageStr.includes('.apply(')) {
    violations.push('Message contains direct method call violations');
  }

  return { isCompliant: violations.length === 0, violations };
}

/**
 * Type guard for checking if a value can be safely sent between actors
 */
export function isLocationTransparent(value: unknown): value is JsonValue {
  return isJsonValue(value);
}

/**
 * Validates that an object follows pure actor model principles
 * (No shared state, no direct method calls, etc.)
 */
export function isPureActorObject(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return true;
  }

  // Check for function properties (violates message-only communication)
  const obj = value as Record<string, unknown>;
  for (const prop in obj) {
    if (typeof obj[prop] === 'function') {
      return false;
    }
  }

  // Check for non-serializable properties
  return isJsonValue(value);
}
