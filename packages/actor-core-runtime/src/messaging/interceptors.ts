/**
 * @module actor-core/runtime/messaging/interceptors
 * @description High-performance message interceptor system for cross-cutting concerns
 *
 * Based on best practices from Akka, Orleans, and Proto.Actor, this module provides:
 * - Chain-of-responsibility pattern with minimal overhead (< 3% target)
 * - Both sender-side and receiver-side interception points
 * - Message mutation support with clear semantics
 * - Error isolation to prevent interceptor failures from breaking actors
 * - Pre-composed pipelines for performance optimization
 *
 * @author Agent A - Actor-Core Framework
 * @since 2025-07-18
 */

import type { ActorAddress, ActorMessage } from '../actor-system.js';

/**
 * Message context for metadata propagation (similar to Orleans RequestContext)
 * Allows interceptors to share data without modifying the message itself
 */
export interface MessageContext {
  /** Distributed trace ID for request correlation */
  traceId?: string;
  /** Correlation ID for request-response patterns */
  correlationId?: string;
  /** Extensible metadata map for interceptor communication */
  metadata: Map<string, unknown>;
}

/**
 * Parameters for beforeSend interceptor
 */
export interface BeforeSendParams {
  message: ActorMessage;
  sender: ActorAddress | null;
  context: MessageContext;
}

/**
 * Parameters for beforeReceive interceptor
 */
export interface BeforeReceiveParams {
  message: ActorMessage;
  sender: ActorAddress | null;
  context: MessageContext;
}

/**
 * Parameters for afterProcess interceptor
 */
export interface AfterProcessParams {
  message: ActorMessage;
  result: unknown;
  actor: ActorAddress;
  context: MessageContext;
}

/**
 * Parameters for onError interceptor
 */
export interface OnErrorParams {
  error: Error;
  message: ActorMessage;
  actor: ActorAddress;
  context: MessageContext;
}

/**
 * Core message interceptor interface supporting both observation and mutation
 *
 * Interceptors can:
 * - Filter messages (return null to drop)
 * - Transform messages (return modified message)
 * - Add metadata via context
 * - Handle errors in isolation
 */
export interface MessageInterceptor {
  /**
   * Called before a message is sent (sender-side)
   * Use for: context injection, authorization checks, message enrichment
   *
   * @param params - Object containing message, sender, and context
   * @returns Modified message, or null to filter/drop the message
   */
  beforeSend?: (params: BeforeSendParams) => Promise<ActorMessage | null> | ActorMessage | null;

  /**
   * Called after message is dequeued but before actor processing (receiver-side)
   * Use for: validation, authorization, logging, metrics
   *
   * @param params - Object containing message, sender, and context
   * @returns Modified message, or null to filter/drop the message
   */
  beforeReceive?: (
    params: BeforeReceiveParams
  ) => Promise<ActorMessage | null> | ActorMessage | null;

  /**
   * Called after the actor successfully processes a message
   * Use for: metrics collection, result transformation, event emission
   *
   * @param params - Object containing message, result, actor, and context
   */
  afterProcess?: (params: AfterProcessParams) => Promise<void> | void;

  /**
   * Called when message processing fails with an error
   * Use for: error logging, retry logic, circuit breaking
   *
   * @param params - Object containing error, message, actor, and context
   */
  onError?: (params: OnErrorParams) => Promise<void> | void;
}

/**
 * Interceptor registration with metadata for management
 */
export interface InterceptorRegistration {
  /** Unique identifier for this registration */
  id: string;
  /** The interceptor implementation */
  interceptor: MessageInterceptor;
  /** Priority for ordering (higher runs first, global before local) */
  priority: number;
  /** Scope of the interceptor */
  scope: 'global' | 'actor';
  /** Optional filter to selectively apply interceptor */
  filter?: (message: ActorMessage) => boolean;
  /** Whether the interceptor is currently enabled (for circuit breaker) */
  enabled: boolean;
  /** Optional name for debugging/logging */
  name?: string;
}

/**
 * Options for registering an interceptor
 */
export interface InterceptorOptions {
  /** Custom ID (generated if not provided) */
  id?: string;
  /** Execution priority (default: 0) */
  priority?: number;
  /** Message filter predicate */
  filter?: (message: ActorMessage) => boolean;
  /** Human-readable name for debugging */
  name?: string;
}

/**
 * Result from interceptor pipeline execution
 */
export interface PipelineResult {
  /** The potentially modified message (null if filtered) */
  message: ActorMessage | null;
  /** Whether to continue processing */
  continue: boolean;
  /** The message context with accumulated metadata */
  context: MessageContext;
}

/**
 * Type for a composed message pipeline function
 */
export type MessagePipeline = (
  message: ActorMessage,
  sender: ActorAddress | null,
  phase: 'send' | 'receive'
) => Promise<PipelineResult>;

/**
 * Type for an after-process pipeline function
 */
export type AfterProcessPipeline = (
  message: ActorMessage,
  result: unknown,
  actor: ActorAddress,
  context: MessageContext
) => Promise<void>;

/**
 * Type for an error handling pipeline function
 */
export type ErrorPipeline = (
  error: Error,
  message: ActorMessage,
  actor: ActorAddress,
  context: MessageContext
) => Promise<void>;

/**
 * Statistics for interceptor performance monitoring
 */
export interface InterceptorStatistics {
  /** Total invocations of this interceptor */
  invocations: number;
  /** Total execution time in milliseconds */
  totalTime: number;
  /** Average execution time in milliseconds */
  averageTime: number;
  /** Number of errors thrown by this interceptor */
  errors: number;
  /** Number of messages filtered/dropped */
  filtered: number;
  /** Whether the interceptor is currently enabled */
  enabled: boolean;
}

/**
 * Create a new message context with default values
 */
export function createMessageContext(initial?: Partial<MessageContext>): MessageContext {
  return {
    traceId: initial?.traceId,
    correlationId: initial?.correlationId,
    metadata: initial?.metadata || new Map(),
  };
}

/**
 * Helper to check if a value is a Promise
 */
export function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    value != null &&
    typeof value === 'object' &&
    'then' in value &&
    typeof value.then === 'function'
  );
}
