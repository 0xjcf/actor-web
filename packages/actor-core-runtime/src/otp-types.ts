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

import type { Actor, AnyStateMachine } from 'xstate';
import type { ActorDependencies, ActorMessage } from './actor-system.js';

// ============================================================================
// OTP CORE TYPES
// ============================================================================

/**
 * Side effect function for supervised execution
 * Effects are executed after successful state updates
 */
export type Effect = () => void | Promise<void>;

/**
 * Behavior function type for dynamic behavior switching (becomes pattern)
 * Used in the becomes pattern where actors can switch their message handling logic
 */
export type BehaviorFunction<TContext> = (params: {
  readonly message: ActorMessage;
  readonly machine: Actor<AnyStateMachine>;
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
   * Explicit response for ask patterns (smart defaults available)
   *
   * Smart Defaults Logic:
   * - Ask Pattern (correlationId present): If omitted, auto-respond with `context`
   * - Send Pattern (no correlationId): No response sent regardless
   * - Explicit Response: Always takes precedence over smart defaults
   */
  response?: TResponse;

  /**
   * Switch to new behavior (becomes pattern)
   * - New behavior takes effect for subsequent messages
   * - Type-safe: new behavior must handle same message types
   * - Atomic switch with supervision support
   */
  behavior?: BehaviorFunction<TContext>;

  /**
   * Side effects to execute after context update
   * - Executed in order after successful context application
   * - Supervised execution (failures don't crash actor)
   * - Useful for logging, notifications, external system integration
   */
  effects?: Effect[];
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
export type OTPMessageHandler<TMessage, TContext = unknown, TResponse = TContext> = (params: {
  readonly message: TMessage;
  readonly machine: Actor<AnyStateMachine>;
  readonly dependencies: ActorDependencies;
}) =>
  | ActorHandlerResult<TContext, TResponse>
  | Promise<ActorHandlerResult<TContext, TResponse>>
  | void
  | Promise<void>;

/**
 * Type guard for ActorHandlerResult
 */
export function isActorHandlerResult(
  value: unknown
): value is ActorHandlerResult<unknown, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    ('context' in value || 'response' in value || 'behavior' in value || 'effects' in value)
  );
}

/**
 * Smart defaults processor - determines final response based on message analysis
 */
export function processSmartDefaults<TContext, TResponse>(
  result: ActorHandlerResult<TContext, TResponse>,
  messageAnalysis: MessageAnalysis
): SmartDefaultsResult<TResponse> {
  // Explicit response always takes precedence
  if (result.response !== undefined) {
    return {
      finalResponse: result.response,
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
  const hasCorrelationId = Boolean(message.correlationId);

  return {
    hasCorrelationId,
    isAskPattern: hasCorrelationId,
    isSendPattern: !hasCorrelationId,
  };
}
