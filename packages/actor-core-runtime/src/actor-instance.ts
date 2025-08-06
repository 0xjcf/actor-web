/**
 * @module actor-core/runtime/actor-instance
 * @description Common interface for all actor implementations in the framework
 *
 * This module provides the ActorInstance interface that enables polymorphic
 * storage and handling of different actor types (stateless, context, machine).
 */

import type { ActorMessage } from './actor-system.js';
import type { BaseActor, JsonValue, Message } from './types.js';

/**
 * Actor instance types supported by the framework
 */
export type ActorInstanceType = 'stateless' | 'context' | 'machine';

/**
 * Common interface for all actor instance implementations.
 * Extends BaseActor to ensure all required methods are present.
 *
 * This interface enables polymorphic storage in ActorSystemImpl,
 * allowing different actor types to be stored and managed uniformly.
 */
export interface ActorInstance extends BaseActor<ActorMessage> {
  /**
   * Get the type of this actor instance.
   * Used for type discrimination and performance optimization.
   */
  getType(): ActorInstanceType;

  /**
   * Send a message to this actor - accepts any message with a type field
   * Overrides BaseActor.send to be more flexible
   */
  send<T extends { type: string }>(event: T): void;

  /**
   * Ask the actor a question and wait for a response
   */
  ask<T = JsonValue>(message: Message, timeout?: number): Promise<T>;

  /**
   * Optional method to access internal state for debugging
   */
  getInternalState?(): unknown;
}

/**
 * Type guard to check if a value is an ActorInstance
 *
 * @param value - The value to check
 * @returns True if the value implements the ActorInstance interface
 */
export function isActorInstance(value: unknown): value is ActorInstance {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const actor = value as Record<string, unknown>;

  // Check required BaseActor methods
  return (
    typeof actor.id === 'string' &&
    typeof actor.status === 'string' &&
    typeof actor.send === 'function' &&
    typeof actor.start === 'function' &&
    typeof actor.stop === 'function' &&
    typeof actor.getSnapshot === 'function' &&
    // Check ActorInstance-specific methods
    typeof actor.getType === 'function' &&
    typeof actor.ask === 'function' &&
    // Validate the type is one of the allowed values
    ['stateless', 'context', 'machine'].includes(actor.getType?.())
  );
}

/**
 * Type guard to check if an actor is a stateless actor
 */
export function isStatelessActor(actor: ActorInstance): boolean {
  return actor.getType() === 'stateless';
}

/**
 * Type guard to check if an actor is a context actor
 */
export function isContextActor(actor: ActorInstance): boolean {
  return actor.getType() === 'context';
}

/**
 * Type guard to check if an actor is a machine (XState) actor
 */
export function isMachineActor(actor: ActorInstance): boolean {
  return actor.getType() === 'machine';
}
