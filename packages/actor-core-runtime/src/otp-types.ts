/**
 * @module actor-core/runtime/otp-types
 * @description OTP-Inspired State Management Types with Smart Defaults
 *
 * This module provides TypeScript types for OTP (Open Telecom Platform) patterns
 * adapted for the Actor-Web framework, including:
 * - Return-based state updates (like Erlang gen_server)
 * - Dynamic behavior switching (becomes pattern)
 * - Side effect handling
 * - Smart defaults for state/response handling (90% boilerplate reduction)
 *
 * @author Actor-Web Framework
 * @version 1.0.0
 */

import type { ActorInstance } from './actor-instance.js';
import type { ActorDependencies, ActorMessage } from './actor-system.js';
import { Logger } from './logger.js';
import type { MessagePlan } from './message-plan.js';
import type { ActorSnapshot } from './types.js';

const log = Logger.namespace('OTP_TYPES');

// ============================================================================
// OTP CORE TYPES
// ============================================================================

/**
 * Behavior function type for dynamic behavior switching (becomes pattern)
 * Used in the becomes pattern where actors can switch their message handling logic
 */
export type BehaviorFunction<TContext, TMessage = ActorMessage> = (params: {
  readonly message: TMessage;
  readonly actor: ActorInstance & { getSnapshot(): ActorSnapshot<TContext> };
  readonly dependencies: ActorDependencies;
}) =>
  | ActorHandlerResult<TContext, unknown>
  | Promise<ActorHandlerResult<TContext, unknown>>
  | void
  | Promise<void>;

/**
 * OTP-Inspired Handler Result with Smart Defaults
 *
 * Based on Erlang gen_server return patterns: {:reply, reply, new_state}
 * Enhanced with intelligent defaults to eliminate boilerplate:
 *
 * @example Smart Defaults Usage
 * ```typescript
 * // ✅ SIMPLE: Auto-respond with context for ask patterns
 * case 'GET_USER':
 *   return { context: updatedUser };  // Auto becomes response if correlationId present
 *
 * // ✅ EXPLICIT: Different context vs response when needed
 * case 'CREATE_USER':
 *   return {
 *     context: { ...context, users: [...context.users, newUser] },
 *     response: { id: newUser.id, status: 'created' }
 *   };
 *
 * // ✅ FIRE-AND-FORGET: No response for send patterns
 * case 'LOG_EVENT':
 *   return { context: { ...context, eventCount: context.eventCount + 1 } };
 * ```
 */
export interface ActorHandlerResult<TContext, TResponse = void> {
  /**
   * New context to replace current context (OTP gen_server pattern)
   * - undefined = no context change (current context preserved)
   * - Applied atomically after successful message processing
   */
  context?: TContext;

  /**
   * Direct reply for ask patterns (Phase 2.1 - OTP semantic alignment)
   *
   * This field provides clear 1-to-1 reply semantics for ask patterns,
   * distinguishing from the 1-to-many broadcast nature of `emit`.
   *
   * @example
   * ```typescript
   * // Clear distinction between reply and emit
   * return {
   *   context: { balance: newBalance },
   *   reply: { success: true, newBalance },        // 1-to-1 to asker
   *   emit: [{ type: 'WITHDRAWAL_COMPLETED' }]     // 1-to-many broadcast
   * };
   * ```
   */
  reply?: TResponse;

  /**
   * Switch to new behavior (becomes pattern)
   * - New behavior takes effect for subsequent messages
   * - Type-safe: new behavior must handle same message types
   * - Atomic switch with supervision support
   */
  behavior?: BehaviorFunction<TContext>;

  /**
   * Events to emit after successful context update (unified-api-design Phase 2.1)
   * - Array of events to be emitted to subscribers (supports flat messages)
   * - Emitted after context update and effects execution
   * - Used for OTP-style event emission: { context, emit: [...] }
   * - Subscribers receive events via actor.subscribe() pattern
   *
   * @example
   * ```typescript
   * return {
   *   context,
   *   emit: [
   *     { type: 'USER_CREATED', userId: '123', name: 'Alice' }, // Flat message
   *     { type: 'EMAIL_SENT', to: 'alice@example.com' }         // Direct fields
   *   ]
   * };
   * ```
   */
  emit?: unknown[];
}

// ============================================================================
// SMART DEFAULTS UTILITY TYPES
// ============================================================================

/**
 * Message analysis for smart defaults processing
 * Used internally to determine ask vs send patterns
 */
export interface MessageAnalysis {
  readonly hasCorrelationId: boolean;
  readonly isAskPattern: boolean;
  readonly isSendPattern: boolean;
}

/**
 * Smart defaults processing result
 * Used internally by the actor system to apply smart defaults logic
 */
export interface SmartDefaultsResult<TResponse> {
  readonly finalResponse: TResponse | undefined;
  readonly shouldRespond: boolean;
  readonly responseSource: 'explicit' | 'context-auto' | 'none';
}

// ============================================================================
// BUILDER PATTERN SUPPORT TYPES
// ============================================================================

/**
 * Enhanced message handler signature supporting OTP patterns with smart defaults
 *
 * Unified signature for both context-based and machine-based actors:
 * - Context-based: machine created from initialContext
 * - Machine-based: machine is the custom XState machine provided
 * - Smart defaults: Auto-respond with context for ask patterns
 *
 * @template TMessage - Message type handled by the actor
 * @template TContext - Actor context/state type
 * @template TResponse - Response type for ask patterns
 */
export type OTPMessageHandler<
  TMessage,
  TContext = unknown,
  TResponse = TContext,
  TDomainEvent = unknown,
> = (params: {
  readonly message: TMessage;
  readonly actor: ActorInstance & { getSnapshot(): ActorSnapshot<TContext> };
  readonly dependencies: ActorDependencies;
}) =>
  | ActorHandlerResult<TContext, TResponse>
  | Promise<ActorHandlerResult<TContext, TResponse>>
  | MessagePlan<TDomainEvent>
  | Promise<MessagePlan<TDomainEvent>>
  | void
  | Promise<void>;

/**
 * Runtime message handler type used at the ActorBehavior level
 * This type works with generic ActorInstance without specific context types
 */
export type RuntimeMessageHandler<TMessage, TDomainEvent = unknown, TContext = unknown> = (params: {
  readonly message: TMessage;
  readonly actor: ActorInstance;
  readonly dependencies: ActorDependencies;
}) =>
  | ActorHandlerResult<TContext, unknown>
  | Promise<ActorHandlerResult<TContext, unknown>>
  | MessagePlan<TDomainEvent>
  | Promise<MessagePlan<TDomainEvent>>
  | void
  | Promise<void>;

/**
 * Type guard for ActorHandlerResult
 */
export function isActorHandlerResult(
  value: unknown
): value is ActorHandlerResult<unknown, unknown> {
  log.debug('🔍 TYPE GUARD DEBUG: Checking isActorHandlerResult for:', value);
  log.debug('🔍 TYPE GUARD DEBUG: Value type:', typeof value);
  log.debug('🔍 TYPE GUARD DEBUG: Value is null?', value === null);

  if (value !== null && typeof value === 'object') {
    log.debug('🔍 TYPE GUARD DEBUG: Has context?', 'context' in value);
    log.debug('🔍 TYPE GUARD DEBUG: Has response?', 'response' in value);
    log.debug('🔍 TYPE GUARD DEBUG: Has reply?', 'reply' in value);
    log.debug('🔍 TYPE GUARD DEBUG: Has behavior?', 'behavior' in value);
    log.debug('🔍 TYPE GUARD DEBUG: Has emit?', 'emit' in value);
  }

  const result =
    value !== null &&
    typeof value === 'object' &&
    ('context' in value ||
      'response' in value ||
      'reply' in value ||
      'behavior' in value ||
      'emit' in value);

  log.debug('🔍 TYPE GUARD DEBUG: isActorHandlerResult result:', result);
  return result;
}

/**
 * Smart defaults processor - determines final response based on message analysis
 */
export function processSmartDefaults<TContext, TResponse>(
  result: ActorHandlerResult<TContext, TResponse>,
  messageAnalysis: MessageAnalysis
): SmartDefaultsResult<TResponse> {
  // Explicit reply takes highest precedence (Phase 2.1)
  if (result.reply !== undefined) {
    return {
      finalResponse: result.reply,
      shouldRespond: messageAnalysis.isAskPattern,
      responseSource: 'explicit',
    };
  }

  // Explicit response takes precedence over smart defaults
  if (result.reply !== undefined) {
    return {
      finalResponse: result.reply,
      shouldRespond: messageAnalysis.isAskPattern,
      responseSource: 'explicit',
    };
  }

  // Smart default: Use context as response for ask patterns
  if (messageAnalysis.isAskPattern && result.context !== undefined) {
    return {
      finalResponse: result.context as unknown as TResponse,
      shouldRespond: true,
      responseSource: 'context-auto',
    };
  }

  // No response for send patterns or when no context/response provided
  return {
    finalResponse: undefined,
    shouldRespond: false,
    responseSource: 'none',
  };
}

/**
 * Analyze message for smart defaults processing
 */
export function analyzeMessage(message: ActorMessage): MessageAnalysis {
  const hasCorrelationId = Boolean(message._correlationId);

  return {
    hasCorrelationId,
    isAskPattern: hasCorrelationId,
    isSendPattern: !hasCorrelationId,
  };
}
