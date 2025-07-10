/**
 * Actor-Web Framework
 * A pure actor model framework for building resilient web applications
 * 
 * @version 0.1.0
 * @author 0xjcf
 */

// Core Actor System
export {
  ActorError, ActorRef,
  ActorRefOptions,
  TimeoutError
} from './core/actors/actor-ref.js';
export * from './core/actors/supervisor.js';
export {
  ActorBehavior, ActorSnapshot, SpawnOptions, SupervisionStrategy
} from './core/actors/types.js';
export {
  createActorRef,
  createQueryableActorRef,
  createRootActor
} from './core/create-actor-ref.js';

// Messaging System  
export {
  BoundedMailbox, createMailbox, MailboxError,
  OverflowStrategy,
  type Mailbox,
  type MailboxConfig,
  type MailboxStatistics,
  type MessageEnvelope
} from './core/messaging/mailbox.js';
export * from './core/messaging/message-types.js';
export * from './core/messaging/request-response.js';

// Observable System
export {
  createObservable, CustomObservable as Observable, type Observer, type SubscriberFunction, type Subscription, type TeardownLogic
} from './core/observables/observable.js';
export {
  filter, map, observableUtils, pipe, tap, type MonadOperatorFunction, type OperatorFunction, type PredicateFunction
} from './core/observables/operators.js';

// Testing Utilities  
export * from './testing.js';

// Re-export commonly used XState types for convenience
export type {
  EventObject, SnapshotFrom, StateMachine,
  ActorOptions as XStateActorOptions
} from 'xstate';

