/**
 * @module framework/core/integration/xstate-adapter
 * @description XState v5 adapter using unified ActorRef implementation
 * @author Agent A - 2025-10-07
 */

import type { AnyStateMachine } from 'xstate';
import type { ActorRef, ActorRefOptions, BaseEventObject } from '../actors/actor-ref.js';
import type { ActorSnapshot } from '../actors/types.js';
import { createActorRef, createQueryableActorRef, createRootActor } from '../create-actor-ref.js';

// ========================================================================================
// XSTATE-SPECIFIC FACTORY FUNCTIONS
// ========================================================================================

/**
 * Create an ActorRef from an XState v5 machine using the unified implementation
 *
 * @param machine - XState v5 state machine
 * @param options - Configuration options
 * @returns ActorRef instance powered by the unified implementation
 */
export function createXStateActorRef<
  TEvent extends BaseEventObject = BaseEventObject,
  TEmitted = unknown,
  TSnapshot extends ActorSnapshot = ActorSnapshot,
>(machine: AnyStateMachine, options?: ActorRefOptions): ActorRef<TEvent, TEmitted, TSnapshot> {
  return createActorRef<TEvent, TEmitted, TSnapshot>(machine, {
    ...options,
    // XState-specific defaults
    autoStart: options?.autoStart ?? true, // XState actors typically start immediately
  });
}

/**
 * Create a root XState actor with supervision
 *
 * @param machine - Root XState machine
 * @param options - Configuration options
 * @returns Root ActorRef with XState-optimized supervision
 */
export function createXStateRootActor(
  machine: AnyStateMachine,
  options?: Omit<ActorRefOptions, 'parent'>
): ActorRef<BaseEventObject> {
  return createRootActor(machine, {
    ...options,
    // XState root actors should have robust supervision
    supervision: options?.supervision || 'restart-on-failure',
    // Give XState machines more time for complex state transitions
    askTimeout: options?.askTimeout || 10000,
  });
}

/**
 * Create an XState actor optimized for query/response patterns
 * Ideal for XState machines that handle external API calls or complex queries
 *
 * @param machine - XState machine with query handling
 * @param options - Configuration options
 * @returns ActorRef optimized for request/response workflows
 */
export function createXStateQueryActor<
  TEvent extends BaseEventObject = BaseEventObject,
  TEmitted = unknown,
>(machine: AnyStateMachine, options?: ActorRefOptions): ActorRef<TEvent, TEmitted> {
  return createQueryableActorRef<TEvent, TEmitted>(machine, {
    ...options,
    // Extended timeout for external queries
    askTimeout: options?.askTimeout || 15000,
    // Restart on failure for resilient query handling
    supervision: options?.supervision || 'restart-on-failure',
  });
}

/**
 * Create an XState service actor (long-running background actor)
 * Optimized for persistent background services
 *
 * @param machine - Service state machine
 * @param options - Configuration options
 * @returns ActorRef configured for service patterns
 */
export function createXStateServiceActor<
  TEvent extends BaseEventObject = BaseEventObject,
  TEmitted = unknown,
>(machine: AnyStateMachine, options?: ActorRefOptions): ActorRef<TEvent, TEmitted> {
  return createActorRef<TEvent, TEmitted>(machine, {
    ...options,
    // Services typically don't auto-start (controlled startup)
    autoStart: options?.autoStart ?? false,
    // Long timeout for service operations
    askTimeout: options?.askTimeout || 30000,
    // Robust supervision for critical services
    supervision: options?.supervision || 'restart-on-failure',
  });
}

// ========================================================================================
// CONVENIENCE RE-EXPORTS
// ========================================================================================

// Re-export essential types
export type {
  ActorRef,
  ActorRefOptions,
  ActorStatus,
  AskOptions,
  BaseEventObject,
} from '../actors/actor-ref.js';
export type { ActorSnapshot } from '../actors/types.js';
// Re-export the unified factory functions for convenience
export { createActorRef, createQueryableActorRef, createRootActor } from '../create-actor-ref.js';
