/**
 * @module actor-core/runtime
 * @description Core actor runtime for universal actor-based applications
 */

export type { EventListener, Unsubscribe } from './actor-event-bus.js';
// Event bus for actor-to-actor communication
export { ActorEventBus } from './actor-event-bus.js';
// ActorRef interface and utilities
export type {
  ActorRef,
  CreateActorRefFunction,
} from './actor-ref.js';
export {
  ActorStoppedError,
  generateActorId,
  generateCorrelationId,
  isResponseEvent,
  TimeoutError,
} from './actor-ref.js';
export type {
  ActorSystem,
  ActorDefinition,
  ActorBehaviorResult,
} from './actor-system.js';
export type { ActorSystemConfig } from './actor-system-impl.js';
export { createActorSystem } from './actor-system-impl.js';
export type { SupervisorOptions } from './actors/supervisor.js';
// Supervision
export { Supervisor } from './actors/supervisor.js';
export {
  BackoffSupervisor,
  type BackoffSupervisorOptions,
  type BackoffStrategy,
} from './actors/backoff-supervisor.js';

// Messaging
export {
  DeadLetterQueue,
  type DeadLetter,
  type DeadLetterQueueConfig,
} from './messaging/dead-letter-queue.js';
export {
  JsonSerializer,
  MessagePackSerializer,
  SerializationFactory,
  TransportSerializer,
  type MessageSerializer,
  type SerializationFormat,
  type MessageEnvelope,
} from './messaging/serialization.js';
// Factory function
export { createActorRef } from './create-actor-ref.js';
export type { DirectoryConfig } from './distributed-actor-directory.js';
// Phase 1: Distributed Actor Directory and System
export { DistributedActorDirectory } from './distributed-actor-directory.js';
export type { ScopedLogger } from './logger.js';
// Logger utility
export {
  enableDevMode,
  enableDevModeForCLI,
  isDevMode,
  Logger,
  resetDevMode,
} from './logger.js';
export type {
  RequestContext,
  RequestResponseManagerOptions,
  RequestResponseStats,
} from './messaging/request-response.js';
// Request/response messaging
export { RequestResponseManager } from './messaging/request-response.js';
export type { SubscriberFunction, TeardownLogic } from './observable.js';
// Observable implementation
export { CustomObservable } from './observable.js';
// Core types
export type {
  ActorBehavior,
  ActorRefOptions,
  ActorSnapshot,
  ActorStatus,
  AskOptions,
  BaseActor,
  BaseEventObject,
  BaseMessage,
  EventMetadata,
  FrameworkSnapshot,
  Mailbox,
  Observable,
  Observer,
  QueryEvent,
  ResponseEvent,
  SpawnOptions,
  Subscription,
  SupervisionStrategy,
} from './types.js';

// Actor creation factory
export {
  createActor,
  type CreateActorConfig,
  type BehaviorActorConfig,
  type XStateActorConfig,
  type ActorMessageType,
  type ActorContextType,
  type ActorEmittedType,
  type AvailableEventTypes,
} from './create-actor.js';

// Type helpers for better error messages
export type {
  ValidateEventType,
  ValidateEvent,
  ValidateEmittedEvent,
  ShowAvailableEventTypes,
  StrictEventValidation,
  TypedEvent,
  ExtractEventTypes,
  EventWithType,
  PrettyError,
} from './type-helpers.js';
