/**
 * Actor-Web Framework
 * A pure actor model framework for building resilient web applications
 *
 * @version 0.1.0
 * @author 0xjcf
 */

// Re-export commonly used XState types for convenience
export type {
  ActorOptions as XStateActorOptions,
  EventObject,
  SnapshotFrom,
  StateMachine,
} from 'xstate';
// Core Actor System
export {
  ActorError,
  ActorRef,
  ActorRefOptions,
  TimeoutError,
} from './core/actors/actor-ref.js';
export * from './core/actors/supervisor.js';
export {
  ActorBehavior,
  ActorSnapshot,
  SpawnOptions,
  SupervisionStrategy,
} from './core/actors/types.js';
export {
  createActorRef,
  createQueryableActorRef,
  createRootActor,
} from './core/create-actor-ref.js';
// Development & Debugging
export {
  enableDevMode,
  inspectTemplate,
  Logger,
  type ScopedLogger,
  validateTemplate,
} from './core/dev-mode.js';
// Messaging System
export {
  BoundedMailbox,
  createMailbox,
  type Mailbox,
  type MailboxConfig,
  MailboxError,
  type MailboxStatistics,
  type MessageEnvelope,
  OverflowStrategy,
} from './core/messaging/mailbox.js';
export * from './core/messaging/message-types.js';
export * from './core/messaging/request-response.js';
// Observable System
export {
  CustomObservable as Observable,
  createObservable,
  type Observer,
  type SubscriberFunction,
  type Subscription,
  type TeardownLogic,
} from './core/observables/observable.js';
export {
  filter,
  type MonadOperatorFunction,
  map,
  type OperatorFunction,
  observableUtils,
  type PredicateFunction,
  pipe,
  tap,
} from './core/observables/operators.js';
// Testing Utilities
export * from './testing.js';
