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
// Core types and interfaces
export type {
  ActorAddress,
  ActorBehavior,
  ActorMessage,
  ActorPID,
  ActorStats,
  ActorSystem,
  BasicMessage,
  ClusterState,
  JsonValue,
  // Type-safe actor types
  MessageMap,
  TypeSafeActor,
  TypeSafeMessageInput,
} from './actor-system.js';
export type { ActorSystemConfig } from './actor-system-impl.js';
export { createActorSystem } from './actor-system-impl.js';
export {
  type BackoffStrategy,
  BackoffSupervisor,
  type BackoffSupervisorOptions,
} from './actors/backoff-supervisor.js';
export type { SupervisorOptions } from './actors/supervisor.js';
// Supervision
export { Supervisor } from './actors/supervisor.js';
export {
  type ComponentActorConfig,
  type ComponentActorMessage,
  createComponentActorBehavior,
  type TemplateFunction,
} from './component-actor.js';
// Component behavior types
export {
  type ComponentBehaviorConfig,
  type ComponentDependencies,
  type ComponentMessageParams,
  componentBehavior,
  isComponentBehavior,
  isJsonSerializable,
  type SerializableEvent,
  validateSerializableEvent,
} from './component-behavior.js';
// Actor creation factory
export {
  type ActorContextType,
  type ActorEmittedType,
  type ActorInstance,
  type ActorMessageType,
  // Type-safe actor creation
  asTypeSafeActor,
  type CreateActorConfig,
  createActor,
  createLegacyBehavior,
  createSimpleBehavior,
  defineBehavior,
  type PureActorBehaviorConfig,
  type PureMessageHandler,
  spawnActor,
  validateMessagePlan,
  type XStateActorConfig,
} from './create-actor.js';
// Factory function
export { createActorRef } from './create-actor-ref.js';
export type {
  ComponentActorElement,
  ComponentClass,
  CreateComponentConfig,
} from './create-component.js';
// Component system exports
export { createComponent } from './create-component.js';
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
// Messaging
export {
  type DeadLetter,
  DeadLetterQueue,
  type DeadLetterQueueConfig,
} from './messaging/dead-letter-queue.js';
export type {
  RequestContext,
  RequestResponseManagerOptions,
  RequestResponseStats,
} from './messaging/request-response.js';
// Request/response messaging
export { RequestResponseManager } from './messaging/request-response.js';
export type { SerializationFormat } from './messaging/serialization.js';
export {
  getSerializer,
  MessagePackSerializer,
  type MessageSerializer,
  TransportSerializer,
} from './messaging/serialization.js';
export type { SubscriberFunction, TeardownLogic } from './observable.js';
// Observable implementation
export { CustomObservable } from './observable.js';
// Type helpers for better error messages
export type {
  EventWithType,
  ExtractEventTypes,
  PrettyError,
  ShowAvailableEventTypes,
  StrictEventValidation,
  TypedEvent,
  ValidateEmittedEvent,
  ValidateEvent,
  ValidateEventType,
} from './type-helpers.js';
// Core types
export type {
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
