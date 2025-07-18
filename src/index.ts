/**
 * Actor-Web Framework
 * A pure actor model framework for building resilient web applications
 *
 * @version 2.0.0
 * @author 0xjcf
 */

/**
 * ⚠️ BREAKING CHANGE in v2.0.0
 * 
 * The old @actor-web/core implementation has been removed.
 * All exports now come from @actor-core/runtime which provides:
 * - Pure message-passing communication
 * - True location transparency  
 * - Distributed actor directory
 * - No singleton dependencies
 * 
 * See MIGRATION.md for upgrade instructions.
 */

// Re-export everything from the new runtime
export * from '@actor-core/runtime';

// Re-export testing utilities
export * from '@actor-core/testing';

// Re-export commonly used XState types for convenience
export type {
  ActorOptions as XStateActorOptions,
  EventObject,
  SnapshotFrom,
  StateMachine,
} from 'xstate';

/**
 * @deprecated Components are being redesigned for v2.0
 * For now, use framework-specific implementations
 */
export const createComponent = () => {
  throw new Error(
    'createComponent has been removed in v2.0. ' +
    'Components are being redesigned to work with the pure actor model. ' +
    'For now, use framework-specific implementations.'
  );
};