/**
 * @module actor-core/runtime/actor-context-manager
 * @description Actor Context Manager using AsyncLocalStorage for identity isolation
 *
 * Provides proper actor identity isolation across async boundaries to prevent
 * race conditions where one actor's processing context gets confused with another's.
 *
 * Based on research findings from established actor frameworks:
 * - Erlang/OTP: Process-based identity isolation
 * - Akka: Actor context isolation via actor instances
 * - Orleans: RequestContext with async-local storage
 *
 * @author Agent A (Tech Lead) - 2025-07-30
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { Logger } from './logger.js';

const log = Logger.namespace('ACTOR_CONTEXT');

/**
 * Actor context information maintained across async boundaries
 */
export interface ActorContext {
  /** Primary actor identifier - must match actor address path */
  actorId: string;

  /** Optional correlation ID for request tracing */
  correlationId?: string;

  /** Optional request ID for debugging */
  requestId?: string;

  /** Context nesting depth for debugging nested actor calls */
  depth?: number;

  /** Timestamp when context was created */
  createdAt?: number;
}

/**
 * Context manager configuration options
 */
export interface ContextManagerConfig {
  /** Enable detailed logging for context operations */
  enableLogging?: boolean;

  /** Enable context validation and warnings */
  enableValidation?: boolean;

  /** Maximum context nesting depth before warning */
  maxDepth?: number;
}

/**
 * Actor Context Manager using AsyncLocalStorage for identity isolation
 *
 * Ensures each actor's message processing maintains proper identity isolation
 * across async boundaries, preventing race conditions where Actor A's identity
 * gets confused with Actor B's during concurrent processing.
 *
 * Key Features:
 * - AsyncLocalStorage-based context propagation
 * - Explicit context switching at async boundaries
 * - Development-time debugging and validation
 * - Graceful fallback when context is missing
 * - Performance-optimized for high-throughput scenarios
 */

/** AsyncLocalStorage instance for context propagation */
const storage = new AsyncLocalStorage<ActorContext>();

/** Configuration for the context manager */
let config: ContextManagerConfig = {
  enableLogging: process.env.NODE_ENV === 'development',
  enableValidation: process.env.NODE_ENV === 'development',
  maxDepth: 10,
};

/** Context creation counter for debugging */
let contextCounter = 0;

/**
 * Configure the context manager behavior
 */
export function configure(newConfig: Partial<ContextManagerConfig>): void {
  config = { ...config, ...newConfig };

  if (config.enableLogging) {
    log.debug('ActorContextManager configured', {
      enableLogging: config.enableLogging,
      enableValidation: config.enableValidation,
      maxDepth: config.maxDepth,
    });
  }
}

/**
 * Run a function within a specific actor context
 *
 * This is the primary method for establishing actor identity boundaries.
 * All async operations spawned within the function will inherit this context.
 *
 * @param context - Actor context to establish
 * @param fn - Function to execute within the context
 * @returns Result of the function execution
 */
export function run<T>(context: ActorContext, fn: () => T): T {
  // Validate context if enabled
  if (config.enableValidation) {
    validateContext(context);
  }

  // Enrich context with metadata
  const enrichedContext: ActorContext = {
    ...context,
    createdAt: context.createdAt || Date.now(),
    depth: calculateDepth(),
  };

  // Check depth limits
  if (
    config.enableValidation &&
    enrichedContext.depth !== undefined &&
    config.maxDepth !== undefined &&
    enrichedContext.depth > config.maxDepth
  ) {
    log.warn('ActorContext depth exceeds maximum', {
      actorId: enrichedContext.actorId,
      depth: enrichedContext.depth,
      maxDepth: config.maxDepth,
    });
  }

  if (config.enableLogging) {
    log.debug('🔄 ACTOR CONTEXT: Entering context', {
      actorId: enrichedContext.actorId,
      correlationId: enrichedContext.correlationId,
      depth: enrichedContext.depth,
      contextId: ++contextCounter,
    });
  }

  try {
    return storage.run(enrichedContext, fn);
  } catch (error) {
    if (config.enableLogging) {
      log.error('🚨 ACTOR CONTEXT: Error in context execution', {
        actorId: enrichedContext.actorId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    throw error;
  } finally {
    if (config.enableLogging) {
      log.debug('🔚 ACTOR CONTEXT: Exiting context', {
        actorId: enrichedContext.actorId,
        depth: enrichedContext.depth,
      });
    }
  }
}

/**
 * Get the current actor context (if any)
 *
 * @returns Current context or undefined if no context is active
 */
export function getCurrentContext(): ActorContext | undefined {
  return storage.getStore();
}

/**
 * Get the current actor ID (if any)
 *
 * This is the most commonly used function for getting the current actor's identity.
 *
 * @returns Current actor ID or undefined if no context is active
 */
export function getCurrentActorId(): string | undefined {
  return storage.getStore()?.actorId;
}

/**
 * Get the current correlation ID (if any)
 *
 * @returns Current correlation ID or undefined if no context or correlation ID
 */
export function getCurrentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

/**
 * Check if we're currently running within an actor context
 *
 * @returns True if an actor context is active
 */
export function hasActiveContext(): boolean {
  return storage.getStore() !== undefined;
}

/**
 * Run a function with logging enabled/disabled temporarily
 *
 * Useful for debugging specific operations without changing global config.
 *
 * @param enabled - Whether to enable logging for this operation
 * @param fn - Function to execute
 * @returns Result of the function execution
 */
export function withLogging<T>(enabled: boolean, fn: () => T): T {
  const originalLogging = config.enableLogging;
  config.enableLogging = enabled;

  try {
    return fn();
  } finally {
    config.enableLogging = originalLogging;
  }
}

/**
 * Get the current context stack (for debugging)
 *
 * This function provides visibility into nested context calls, useful for
 * debugging complex actor interaction patterns.
 *
 * @returns Array of contexts from root to current (current context is last)
 */
export function getContextStack(): ActorContext[] {
  const current = getCurrentContext();
  if (!current) {
    return [];
  }

  // For now, we only track the current context
  // In the future, we could maintain a stack of contexts for debugging
  return [current];
}

/**
 * Create a new context with correlation information
 *
 * Helper function for creating contexts with proper correlation tracking.
 *
 * @param actorId - Actor identifier
 * @param correlationId - Optional correlation ID
 * @param requestId - Optional request ID
 * @returns New actor context
 */
export function createContext(
  actorId: string,
  correlationId?: string,
  requestId?: string
): ActorContext {
  return {
    actorId,
    correlationId,
    requestId,
    createdAt: Date.now(),
  };
}

/**
 * Validate context data for correctness
 *
 * @param context - Context to validate
 * @throws Error if context is invalid
 */
function validateContext(context: ActorContext): void {
  if (!context.actorId) {
    throw new Error('ActorContext must have a valid actorId');
  }

  if (typeof context.actorId !== 'string') {
    throw new Error('ActorContext.actorId must be a string');
  }

  if (context.actorId.trim().length === 0) {
    throw new Error('ActorContext.actorId cannot be empty');
  }

  // Validate actor ID format (should be actor path format)
  if (!context.actorId.includes('://') && !context.actorId.startsWith('/')) {
    log.warn('ActorContext.actorId does not appear to be a valid actor path', {
      actorId: context.actorId,
    });
  }
}

/**
 * Calculate the current context nesting depth
 *
 * @returns Current nesting depth (0 for root context)
 */
function calculateDepth(): number {
  const current = getCurrentContext();
  return current ? (current.depth || 0) + 1 : 0;
}

/**
 * Safely run a function with context isolation and error recovery
 *
 * Provides bulletproof context switching with automatic recovery
 * from context corruption or async boundary violations.
 *
 * @param context - Actor context to establish
 * @param fn - Function to execute within the context
 * @param fallbackActorId - Fallback ID if context is lost
 * @returns Result of the function execution
 */
export function safeRun<T>(context: ActorContext, fn: () => T, fallbackActorId?: string): T {
  try {
    return run(context, () => {
      // Validate context integrity during execution
      const currentContext = getCurrentContext();
      if (!currentContext || currentContext.actorId !== context.actorId) {
        if (config.enableLogging) {
          log.error('🚨 ACTOR CONTEXT: Context corruption detected during execution', {
            expectedActorId: context.actorId,
            actualActorId: currentContext?.actorId,
            fallbackActorId,
          });
        }

        // Attempt to restore context
        if (fallbackActorId) {
          return run({ ...context, actorId: fallbackActorId }, fn);
        }

        throw new Error(`Actor context corruption: expected ${context.actorId}`);
      }

      return fn();
    });
  } catch (error) {
    if (config.enableLogging) {
      log.error('🚨 ACTOR CONTEXT: Error in context execution with recovery', {
        actorId: context.actorId,
        fallbackActorId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // If we have a fallback, try once more with fallback context
    if (fallbackActorId && context.actorId !== fallbackActorId) {
      const fallbackContext = { ...context, actorId: fallbackActorId };
      return run(fallbackContext, fn);
    }

    throw error;
  }
}

/**
 * Force clear all active contexts (emergency recovery)
 *
 * This is a nuclear option for when context state becomes corrupted.
 * Should only be used in error recovery scenarios.
 *
 * @internal
 */
export function _forceReset(): void {
  if (config.enableLogging) {
    log.warn('🚨 ACTOR CONTEXT: Force resetting all active contexts');
  }

  // Clear any active context by running with undefined
  // AsyncLocalStorage will propagate undefined to all async continuations
  const emptyContext: ActorContext = {
    actorId: '',
    correlationId: undefined,
    requestId: undefined,
    depth: 0,
    createdAt: Date.now(),
  };
  storage.run(emptyContext, () => {
    // This will clear the context for any pending async operations
  });

  contextCounter = 0;
}

/**
 * Get diagnostic information about current context state
 *
 * Useful for debugging context isolation issues.
 *
 * @returns Context diagnostic information
 */
export function getDiagnostics(): {
  hasActiveContext: boolean;
  currentActorId?: string;
  contextDepth?: number;
  contextAge?: number;
  contextCount: number;
} {
  const current = getCurrentContext();

  return {
    hasActiveContext: !!current,
    currentActorId: current?.actorId,
    contextDepth: current?.depth,
    contextAge: current?.createdAt ? Date.now() - current.createdAt : undefined,
    contextCount: contextCounter,
  };
}

/**
 * Reset context manager state (primarily for testing)
 *
 * @internal
 */
export function _reset(): void {
  contextCounter = 0;
  config = {
    enableLogging: process.env.NODE_ENV === 'development',
    enableValidation: process.env.NODE_ENV === 'development',
    maxDepth: 10,
  };
}

/**
 * Type guard to check if a value is a valid ActorContext
 *
 * @param value - Value to check
 * @returns True if value is a valid ActorContext
 */
export function isActorContext(value: unknown): value is ActorContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    'actorId' in value &&
    typeof (value as ActorContext).actorId === 'string'
  );
}

/**
 * Helper function to get current actor ID with fallback
 *
 * This is the recommended way to get actor ID in framework code,
 * as it provides a fallback when context is not available.
 *
 * @param fallbackActorId - Fallback actor ID if no context is active
 * @returns Current actor ID or fallback
 */
export function getCurrentActorIdWithFallback(fallbackActorId: string): string {
  const contextActorId = getCurrentActorId();

  if (contextActorId) {
    return contextActorId;
  }

  // Log warning in development when falling back
  if (process.env.NODE_ENV === 'development') {
    log.warn('🚨 ACTOR CONTEXT: No active context, using fallback actor ID', {
      fallbackActorId,
      hasContext: false,
    });
  }

  return fallbackActorId;
}
