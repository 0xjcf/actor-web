/**
 * @module actor-core/runtime
 * @description Core actor runtime for universal actor-based applications
 * Enhanced with OTP (Open Telecom Platform) state management patterns
 */

export { ActorEventBus } from './actor-event-bus.js';
// Actor instance interface
export type { ActorInstance, ActorInstanceType } from './actor-instance.js';
// ActorRef is the primary public interface for actor references
export type { ActorEventSubscriptionOptions, ActorRef } from './actor-ref.js';
// ActorRef utilities (errors from the old actor-ref.js)
export {
  ActorStoppedError,
  // generateActorId and generateCorrelationId moved to utils/factories.js
  isResponseEvent,
  TimeoutError,
} from './actor-ref.js';
// Symbol-based runtime patterns (NEW - TASK 2.2.1)
export {
  ActorSymbols,
  ComponentSymbols,
} from './actor-symbols.js';
// Core types and interfaces
export type {
  ActorAddress,
  ActorBehavior,
  ActorEnvelope,
  ActorMessage,
  // ActorPID is now internal - use ActorRef instead
  ActorStats,
  ActorSystem,
  ClusterState,
  MessageTransport,
  // JsonValue moved to types.js - import from there if needed
} from './actor-system.js';
export type { ActorSystemConfig } from './actor-system-impl.js';
export { createActorSystem } from './actor-system-impl.js';
export type {
  ActorToolbox,
  ActorToolExecutionContext,
  ActorToolExecutor,
  ActorToolRegistry,
} from './actor-tools.js';
export { createActorToolbox } from './actor-tools.js';
export type { ActorWebClient, ActorWebClientOptions } from './actor-web-client.js';
export { createActorWebClient } from './actor-web-client.js';
export {
  type BackoffStrategy,
  BackoffSupervisor,
  type BackoffSupervisorOptions,
} from './actors/backoff-supervisor.js';
export type { SupervisorOptions } from './actors/supervisor.js';
// Supervision
export { Supervisor } from './actors/supervisor.js';
// Auto-publishing system (Phase 2.1)
export {
  AutoPublishingRegistry,
  analyzeMessagePlan,
  createSubscribeMessage,
  createUnsubscribeMessage,
  type PublishableEventMetadata,
} from './auto-publishing.js';
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
export { ContextActor } from './context-actor.js';
// Actor creation factory
export {
  type ActorEmittedType,
  type ActorMessageType,
  // Enhanced type inference utilities (TASK 2.1.3)
  type ActorRefFromBehavior,
  // Modern fluent builder pattern APIs
  type BehaviorBuilderBase,
  type BehaviorTypeInference,
  ContextBehaviorBuilder,
  type CreateActorConfig,
  createActor,
  type InferBehaviorType,
  type InferMessageType,
  MachineBehaviorBuilder,
  // Simplified operation-based typing (IMPROVED APPROACH)
  type OperationMap,
  type PureActorBehaviorConfig,
  type PureMessageHandlerWithContext,
  type PureMessageHandlerWithMachine,
  type RequestFromOperations,
  type ResponseFromOperations,
  renderTemplate,
  // Template builder classes (NEW - TASK 2.1.1)
  TemplateBehaviorBuilder,
  TemplateContextBehaviorBuilder,
  TemplateMachineBehaviorBuilder,
  type TypeSafeOperationActor,
  // Universal template system (NEW - TASK 2.1.1)
  template,
  type UniversalTemplate,
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
export {
  type ActorMessageRecord,
  type ActorSnapshotToFasWorkflowSnapshotInput,
  type ActorSnapshotTransitionInput,
  type ActorWebCommandExecutionInput,
  type ActorWebToFasEventEnvelopeOptions,
  actorAddressToFasActorAddress,
  actorCommandExecutionToFasRecord,
  actorMessagePayload,
  actorMessageToFasEventEnvelope,
  actorSnapshotPhase,
  actorSnapshotsToFasTransitionRecord,
  actorSnapshotToFasWorkflowSnapshot,
  type FasActorAddress,
  type FasArtifactReference,
  type FasCommandExecutionRecord,
  type FasCommandExecutionStatus,
  type FasCorrelationContext,
  type FasEventEnvelope,
  type FasMessageKind,
  type FasWorkflowSnapshot,
  type FasWorkflowTransitionRecord,
} from './integration/fas-shared-contracts.js';
export {
  actorEventToIgniteSourceEvent,
  actorSnapshotToIgniteSourceSnapshot,
  type CreateIgniteActorSourceOptions,
  createIgniteActorSource,
  type EventSubscribableActorRef,
  type IgniteActorSource,
  type IgniteActorSourceEvent,
  type IgniteActorSourceSnapshot,
  isEventSubscribableActorRef,
  isSnapshotSubscribableActorRef,
  isTransportStatusSubscribableActorRef,
  type SnapshotSubscribableActorRef,
  type TransportStatusSubscribableActorRef,
} from './integration/ignite-element-bridge.js';
export type { ScopedLogger } from './logger.js';
// Logger utility
export {
  enableDevMode,
  enableDevModeForCLI,
  isDevMode,
  Logger,
  resetDevMode,
} from './logger.js';
export { MachineActor } from './machine-actor.js';
// Enhanced machine registry (NEW - TASK 2.2.2)
export {
  behaviorHasMachine,
  getMachineFromBehavior,
  type MachineDiscoveryOptions,
  type MachineRegistration,
  machineRegistry,
  type RegistryStats,
  registerMachineWithBehavior,
  SymbolBasedMachineRegistry,
} from './machine-registry.js';
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
export { XStateRequestResponseManager } from './messaging/request-response.js';
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
export { OTPMessagePlanProcessor } from './otp-message-plan-processor.js';
// NEW: OTP state management types with smart defaults
export type {
  ActorHandlerResult,
  BehaviorFunction,
  MessageAnalysis,
  OTPMessageHandler,
  SmartDefaultsResult,
} from './otp-types.js';
export {
  analyzeMessage,
  isActorHandlerResult,
  processSmartDefaults,
} from './otp-types.js';
export type {
  ProjectionTransportState,
  ProjectionTransportStatus,
} from './projection-transport.js';
export type {
  RuntimeGatewayAuthProvider,
  RuntimeGatewayAuthResult,
  RuntimeTransportAuthPayload,
  RuntimeTransportAuthProvider,
  RuntimeTransportAuthResult,
} from './runtime-auth.js';
export {
  resolveRuntimeAuthPayload,
  sanitizeRuntimeAuthPayload,
  verifyRuntimeAuth,
  verifyRuntimeGatewayAuth,
} from './runtime-auth.js';
export type {
  RuntimeGatewayClientFrame,
  RuntimeGatewayErrorCode,
  RuntimeGatewayEventProjection,
  RuntimeGatewayReplayFrame,
  RuntimeGatewayReplayStorageErrorEvent,
  RuntimeGatewayReplayStorageProvider,
  RuntimeGatewayScopeDescriptor,
  RuntimeGatewayScopeResolver,
  RuntimeGatewayServerFrame,
  RuntimeGatewaySnapshotProjection,
} from './runtime-gateway.js';
export {
  createRuntimeGatewayHub,
  createRuntimeGatewaySource,
  RuntimeGatewayScopeError,
} from './runtime-gateway.js';
export type {
  InMemoryRuntimePeerDiscoveryProvider,
  RuntimePeerDiscoveryEvent,
  RuntimePeerDiscoveryProvider,
  RuntimePeerDiscoveryRecord,
} from './runtime-peer-discovery.js';
export {
  createInMemoryRuntimePeerDiscoveryProvider,
  createStaticRuntimePeerDiscoveryProvider,
} from './runtime-peer-discovery.js';
export type {
  RuntimeNodeIdentity,
  RuntimeTransportAckFrame,
  RuntimeTransportFrame,
  RuntimeTransportHandshake,
  RuntimeTransportHandshakeRejectCode,
  RuntimeTransportHeartbeatFrame,
  RuntimeTransportProtocolVersion,
  RuntimeTransportValidationResult,
} from './runtime-transport-contract.js';
export {
  createRuntimeNodeIdentity,
  createRuntimeTransportAckFrame,
  createRuntimeTransportFrame,
  createRuntimeTransportHandshakeAccept,
  createRuntimeTransportHandshakeHello,
  createRuntimeTransportHandshakeReject,
  createRuntimeTransportHeartbeatPing,
  createRuntimeTransportHeartbeatPong,
  createRuntimeTransportMessageId,
  isRuntimeNodeIdentity,
  isSameRuntimeNodeIdentity,
  RUNTIME_TRANSPORT_PROTOCOL_VERSION,
  validateRuntimeNodeIdentity,
  validateRuntimeTransportAckFrame,
  validateRuntimeTransportFrame,
  validateRuntimeTransportHandshake,
  validateRuntimeTransportHeartbeatFrame,
} from './runtime-transport-contract.js';
export type {
  RuntimePeerStatus,
  RuntimePeerStatusState,
  RuntimeTransportStatus,
  RuntimeTransportStatusOptions,
} from './runtime-transport-status.js';
export {
  deriveRuntimePeerStatus,
  getRuntimePeerStatus,
  getRuntimeTransportStatus,
} from './runtime-transport-status.js';
export type {
  InMemoryRuntimeTransportTelemetrySink,
  RuntimeTransportPeerStats,
  RuntimeTransportStats,
  RuntimeTransportTelemetryEvent,
  RuntimeTransportTelemetryEventType,
  RuntimeTransportTelemetryExporter,
  RuntimeTransportTelemetryExporterOptions,
  RuntimeTransportTelemetryObserver,
  RuntimeTransportTelemetrySink,
} from './runtime-transport-telemetry.js';
export {
  createInMemoryRuntimeTransportTelemetrySink,
  createRuntimeTransportTelemetryExporter,
  serializeRuntimeTransportTelemetryEvent,
} from './runtime-transport-telemetry.js';
// Actor implementation classes
export { StatelessActor } from './stateless-actor.js';
export type {
  InMemoryMessageTransportNetwork,
  InMemoryMessageTransportOptions,
} from './testing/in-memory-message-transport.js';
export { createInMemoryMessageTransportNetwork } from './testing/in-memory-message-transport.js';
export type {
  ActorWebActorAddress,
  ActorWebActorContext,
  ActorWebActorDefinition,
  ActorWebActorDescriptor,
  ActorWebActorEvent,
  ActorWebActorMessage,
  ActorWebNodeDefinition,
  ActorWebSupervisionPolicy,
  ActorWebSupervisionStrategy,
  ActorWebSupervisorDefinition,
  ActorWebSupervisorDescriptor,
  ActorWebTopology,
  ActorWebTopologyInput,
} from './topology.js';
export { actor, defineActorWebTopology, node, supervisor } from './topology.js';
// Type helpers for context and message extraction
export type {
  ContextOf,
  MessageOf,
} from './type-helpers.js';
// Core types
export type {
  ActorRefOptions,
  ActorSnapshot,
  ActorStatus,
  AskOptions,
  BaseActor,
  BaseEventObject,
  EventMetadata,
  FrameworkSnapshot,
  Mailbox,
  Message,
  Observable,
  Observer,
  QueryEvent,
  ResponseEvent,
  SpawnOptions,
  Subscription,
  SupervisionStrategy,
} from './types.js';
// Unified Actor API (NEW - Replaces defineActor/defineActor)
export {
  type ActorFSMDefinition,
  type ActorFSMStateConfig,
  type ActorFSMTransition,
  type ActorFSMTransitionInput,
  type ActorSpec,
  type ActorTransitionErrorValue,
  defineActor,
  defineFSM,
  UnifiedActorBuilder,
  type UnifiedMessageHandler,
  type UnifiedTransitionHandler,
  type UnifiedTransitionHandlers,
} from './unified-actor-builder.js';

// ============================================================================
// CONSOLIDATED UTILITIES (Re-exports from utils modules)
// ============================================================================

export type {
  AdvanceTimeMessage,
  CancelScheduledMessage,
  GetScheduledMessage,
  ScheduleDelayMessage,
  ScheduleMessage,
  TimerActorMessage,
  TimerActorRef,
  TimerActorState,
} from './actors/timer-actor.js';
// Timer Actor exports (NEW - Pure actor model time management)
export { createTestTimerBehavior, createTimerActor } from './actors/timer-actor.js';
// Event collector for testing subscription patterns
export {
  createEventCollectorBehavior,
  type EventCollectorMessage,
  type EventCollectorResponse,
} from './testing/event-collector.js';
export type { TestActorSystem } from './testing/timer-test-utils.js';
// Testing utilities
export { createTimerDelay, withTimerTesting } from './testing/timer-test-utils.js';
// JsonValue type from types.js (consolidated from actor-system.js)
export type { JsonValue } from './types.js';
// Factory functions from utils/factories.js (consolidated from multiple files)
export {
  createActorAddress,
  generateActorId,
  generateCorrelationId,
} from './utils/factories.js';
// Validation functions from utils/validation.js (consolidated from multiple files)
export {
  isActorMessage,
  isDomainEvent,
  isJsonValue,
  isMessagePlan,
} from './utils/validation.js';
