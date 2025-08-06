/**
 * @module actor-core/runtime/type-helpers
 * @description Helper types for extracting context and message types from behaviors
 *
 * Based on research findings about TypeScript type inference with branded types.
 * These helpers provide cleaner extraction logic that avoids the pitfalls of
 * inline conditional types with optional properties.
 */

import type { ActorMessage } from './actor-system.js';
import type { BehaviorSpec, FluentBehaviorBuilder } from './fluent-behavior-builder.js';

/**
 * Extract context type from a behavior or builder
 *
 * Checks in order:
 * 1. Direct __contextType brand
 * 2. BehaviorSpec generic parameter
 * 3. FluentBehaviorBuilder generic parameter
 * 4. ContextBehaviorBuilder generic parameter
 * 5. Falls back to unknown
 */
export type ContextOf<T> = T extends { __contextType: infer C }
  ? C
  : T extends BehaviorSpec<ActorMessage, unknown, infer C, unknown>
    ? C
    : T extends FluentBehaviorBuilder<ActorMessage, unknown, infer C, unknown>
      ? C
      : unknown;

/**
 * Extract message type from a behavior or builder
 *
 * Handles the optional __messageType gracefully by always
 * ensuring we return a valid ActorMessage type
 */
export type MessageOf<T> = T extends { __messageType?: infer M }
  ? M extends ActorMessage
    ? M
    : ActorMessage
  : T extends BehaviorSpec<infer M, unknown, unknown, unknown>
    ? M extends ActorMessage
      ? M
      : ActorMessage
    : T extends FluentBehaviorBuilder<infer M, unknown, unknown, unknown>
      ? M extends ActorMessage
        ? M
        : ActorMessage
      : ActorMessage;

/**
 * Type predicate to check if a value has __contextType
 */
export function hasContextType<T>(value: T): value is T & { __contextType: unknown } {
  return value !== null && typeof value === 'object' && '__contextType' in value;
}

/**
 * Type predicate to check if a value has __messageType
 */
export function hasMessageType<T>(value: T): value is T & { __messageType?: ActorMessage } {
  return value !== null && typeof value === 'object' && '__messageType' in value;
}
