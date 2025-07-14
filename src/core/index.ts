/**
 * Framework Core Exports - Minimal API
 *
 * This file exports only the essential components for the minimal API.
 * Based on the API.md documentation, this provides:
 * - createComponent() - The main component creation function
 * - html, css - Template functions
 * - Accessibility features - AriaObserver
 * - Event handling - ReactiveEventBus
 * - Development tools - Dev mode functions
 */

// Export reactive accessibility services
export * from './accessibility-services.js';
export type {
  AnimationKeyframe,
  AnimationOptions,
  ParallelAnimationGroup,
  SequenceStep,
  SpringConfig,
  TransitionConfig,
} from './animation-services.js';
// 🎬 Animation Services
export { AnimationPresets, AnimationServices } from './animation-services.js';
export type { AriaMapping, AriaObserverOptions } from './aria-observer.js';
// ♿ Accessibility Features
export { AriaObserver } from './aria-observer.js';
// 🛠️ Development Tools & Logger
export {
  enableDevMode,
  inspectTemplate,
  Logger,
  registerMachine,
  type ScopedLogger,
} from './dev-mode.js';
export type {
  FieldValidationConfig,
  FormValidationConfig,
  FormValidationContext,
  ValidationResult,
  ValidationRule,
} from './form-validation.js';
// ✅ Form Validation
export {
  createFormValidationMachine,
  ValidationRules,
  ValidationServices,
} from './form-validation.js';
export type {
  EventCondition,
  GlobalEventContext,
  GlobalEventEvent,
  GlobalEventListener,
} from './global-event-delegation.js';
// 🌐 Global Event Delegation
export {
  GlobalEventDelegation,
  generateEventListenerId,
  globalEventDelegation,
  globalEventMachine,
} from './global-event-delegation.js';
export type {
  DeserializationOptions,
  SerializationOptions,
} from './json-utilities.js';
// 📝 JSON Utilities - Safe serialization/deserialization
export {
  createTypedSerializer,
  DeserializationError,
  deserializeEventPayload,
  frameworkSerializers,
  SerializationError,
  safeDeserialize,
  safeSerialize,
  serializeEventPayload,
  serializeFormData,
  storageHelpers,
  validators,
} from './json-utilities.js';
// ✨ Primary API - The main exports developers use
export * from './minimal-api.js';
// export * from './observer.js'; // File doesn't exist yet
export type {
  MigrationFunction,
  PersistenceConfig,
  PersistenceContext,
  StorageItem,
  SyncEvent,
} from './persistence.js';
// 💾 State Persistence
export { createPersistenceMachine, PersistenceServices, StorageUtils } from './persistence.js';
// export * from './reactive-component.js'; // File doesn't exist yet
export type { EventBusContext, EventBusEvent, EventMapping } from './reactive-event-bus.js';
// Export existing framework core
export * from './reactive-event-bus.js';
// 🔄 Event System
export { eventBusMachine, ReactiveEventBus } from './reactive-event-bus.js';
export type {
  IntersectionObserverOptions,
  MutationObserverOptions,
  ObserverTarget,
  ResizeObserverOptions,
} from './reactive-observers.js';
// 👁️ Observer Services
export { createTarget, createTargetsFromSelector, ObserverServices } from './reactive-observers.js';
// export * from './reactive-renderer.js'; // File doesn't exist yet
// export * from './reactive-template-engine.js'; // File doesn't exist yet
// export * from './state-machine-renderer.js'; // File doesn't exist yet
export type { RawHTML, RenderOptions, TemplateFunction } from './template-renderer.js';
// 🎨 Template Functions - Re-exported from minimal-api but also available here
export { css, html } from './template-renderer.js';
export type {
  AnimationFrameOptions,
  DebounceOptions,
  DelayOptions,
  IntervalOptions,
  ThrottleOptions,
} from './timer-services.js';
// ⏱️ Timer Services
export { TimerMachines, TimerServices } from './timer-services.js';
// export * from './types.js'; // File doesn't exist yet

// ===== NAMESPACE SYSTEM =====
export {
  API_NAMESPACES,
  COMPONENT_NAMESPACES,
  createCustomNamespace,
  DEV_NAMESPACES,
  EVENT_NAMESPACES,
  getAllNamespaceValues,
  isValidNamespace,
  NAMESPACE_PATTERNS,
  NAMESPACES,
  type NamespaceParam,
  type NamespaceValue,
  STATE_NAMESPACES,
  TEST_NAMESPACES,
  TIMER_NAMESPACES,
  UI_NAMESPACES,
  USER_NAMESPACES,
  UTILITY_NAMESPACES,
} from './namespace-constants.js';
