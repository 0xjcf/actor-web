/**
 * @module actor-core/runtime/interceptors/retry-interceptor
 * @description Message retry interceptor with exponential backoff and circuit breaker
 */

import type { ActorMessage, ActorSystem } from '../actor-system.js';
import { Logger } from '../logger.js';
import type { MessageInterceptor, OnErrorParams } from '../messaging/interceptors.js';
// ✅ PURE ACTOR MODEL: Import XState-based scheduling utilities
import { PureXStateTimeoutManager } from '../pure-xstate-utilities.js';

const log = Logger.namespace('RETRY_INTERCEPTOR');

/**
 * Configuration options for retry interceptor
 */
export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxRetries?: number;
  /** Initial delay in milliseconds */
  initialDelay?: number;
  /** Maximum delay in milliseconds */
  maxDelay?: number;
  /** Backoff multiplier (e.g., 2 for exponential) */
  backoffMultiplier?: number;
  /** Circuit breaker failure threshold */
  circuitThreshold?: number;
  /** Circuit breaker reset timeout in milliseconds */
  circuitResetTimeout?: number;
  /** Filter function to determine if an error is retryable */
  isRetryable?: (error: Error) => boolean;
  /** Filter function to determine if a message should be retried */
  shouldRetry?: (message: ActorMessage) => boolean;
  /** Callback when retry is scheduled */
  onRetry?: (message: ActorMessage, attempt: number, delay: number) => void;
  /** Callback when max retries exceeded */
  onMaxRetriesExceeded?: (message: ActorMessage, error: Error) => void;
  /** Callback when circuit breaker opens */
  onCircuitOpen?: () => void;
  /** Callback when circuit breaker closes */
  onCircuitClose?: () => void;
  /** Callback when circuit breaker half-opens */
  onCircuitHalfOpen?: () => void;
}

/**
 * Retry metadata stored per message
 */
interface RetryMetadata {
  attempts: number;
  firstError?: Error;
  lastError?: Error;
  firstAttemptTime: number;
}

/**
 * Circuit breaker states
 */
enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Default retryable error checker
 */
function defaultIsRetryable(error: Error): boolean {
  // Don't retry on programming errors
  if (error.name === 'TypeError' || error.name === 'ReferenceError') {
    return false;
  }

  // Don't retry on validation errors
  if (error.message.includes('validation') || error.message.includes('invalid')) {
    return false;
  }

  // Retry on network/timeout errors
  if (error.message.includes('timeout') || error.message.includes('network')) {
    return true;
  }

  // Default: retry
  return true;
}

/**
 * Retry interceptor with exponential backoff and circuit breaker
 *
 * Features:
 * - Exponential backoff with jitter
 * - Circuit breaker pattern
 * - Configurable retry predicates
 * - Memory-efficient using WeakMap
 * - Comprehensive metrics and callbacks
 */
export class RetryInterceptor implements MessageInterceptor {
  private retryMetadata = new WeakMap<ActorMessage, RetryMetadata>();
  private failures = 0;
  private circuitState = CircuitState.CLOSED;
  private circuitOpenedAt = 0;
  private resetTimer?: string; // Timeout ID for circuit breaker reset
  private readonly maxRetries: number;
  private readonly initialDelay: number;
  private readonly maxDelay: number;
  private readonly backoffMultiplier: number;
  private readonly circuitThreshold: number;
  private readonly circuitResetTimeout: number;
  private readonly isRetryable: (error: Error) => boolean;
  private readonly shouldRetry: (message: ActorMessage) => boolean;

  // ✅ PURE ACTOR MODEL: XState timeout manager for pure scheduling
  private timeoutManager = new PureXStateTimeoutManager();

  // Reference to actor system for re-sending messages
  private actorSystem: ActorSystem | null = null;

  constructor(private options: RetryOptions = {}) {
    this.maxRetries = options.maxRetries ?? 3;
    this.initialDelay = options.initialDelay ?? 100;
    this.maxDelay = options.maxDelay ?? 10000;
    this.backoffMultiplier = options.backoffMultiplier ?? 2;
    this.circuitThreshold = options.circuitThreshold ?? 10;
    this.circuitResetTimeout = options.circuitResetTimeout ?? 60000;
    this.isRetryable = options.isRetryable ?? defaultIsRetryable;
    this.shouldRetry = options.shouldRetry ?? (() => true);
  }

  /**
   * Set the actor system reference (called by ActorSystemImpl)
   */
  setActorSystem(system: ActorSystem): void {
    this.actorSystem = system;
  }

  async onError({ error, message, actor }: OnErrorParams): Promise<void> {
    // Check circuit breaker state
    if (this.circuitState === CircuitState.OPEN) {
      log.debug('Circuit breaker is open, not retrying', {
        messageType: message.type,
        actor: actor.path,
      });
      return;
    }

    // Check if message should be retried
    if (!this.shouldRetry(message)) {
      log.debug('Message not eligible for retry', {
        messageType: message.type,
        reason: 'shouldRetry returned false',
      });
      return;
    }

    // Check if error is retryable
    if (!this.isRetryable(error)) {
      log.debug('Error not retryable', {
        messageType: message.type,
        errorType: error.name,
        errorMessage: error.message,
      });
      return;
    }

    // Get or create retry metadata
    let metadata = this.retryMetadata.get(message);
    if (!metadata) {
      metadata = {
        attempts: 0,
        firstError: error,
        firstAttemptTime: Date.now(),
      };
      this.retryMetadata.set(message, metadata);
    }

    metadata.attempts++;
    metadata.lastError = error;

    // Check if max retries exceeded
    if (metadata.attempts >= this.maxRetries) {
      log.warn('Max retries exceeded', {
        messageType: message.type,
        actor: actor.path,
        attempts: metadata.attempts,
        duration: Date.now() - metadata.firstAttemptTime,
      });

      // Clean up metadata
      this.retryMetadata.delete(message);

      // Notify callback
      this.options.onMaxRetriesExceeded?.(message, error);

      // Update circuit breaker
      this.recordFailure();

      return;
    }

    // Calculate retry delay with exponential backoff and jitter
    const baseDelay = Math.min(
      this.initialDelay * this.backoffMultiplier ** (metadata.attempts - 1),
      this.maxDelay
    );

    // Add jitter (±25%)
    const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
    const delay = Math.round(baseDelay + jitter);

    log.debug('Scheduling retry', {
      messageType: message.type,
      actor: actor.path,
      attempt: metadata.attempts,
      delay,
      maxRetries: this.maxRetries,
    });

    // Notify callback
    this.options.onRetry?.(message, metadata.attempts, delay);

    // ✅ PURE ACTOR MODEL: Schedule retry using XState timeout manager
    this.timeoutManager.setTimeout(() => {
      if (!this.actorSystem) {
        log.error('Actor system not set, cannot retry message');
        return;
      }

      // Check circuit breaker again before retry
      if (this.circuitState === CircuitState.OPEN) {
        log.debug('Circuit breaker opened during retry delay', {
          messageType: message.type,
        });
        return;
      }

      // If half-open, this is a test request
      if (this.circuitState === CircuitState.HALF_OPEN) {
        log.debug('Testing circuit breaker with retry', {
          messageType: message.type,
        });
      }

      try {
        // Re-send the message
        this.actorSystem.lookup(actor.path).then((actor) => {
          if (actor) {
            actor.send(message);
          }
        });
      } catch (retryError) {
        log.error('Failed to retry message', {
          messageType: message.type,
          actor: actor.path,
          error: retryError instanceof Error ? retryError.message : String(retryError),
        });

        // Record failure for circuit breaker
        this.recordFailure();
      }
    }, delay);
  }

  /**
   * Record a failure for circuit breaker tracking
   */
  private recordFailure(): void {
    this.failures++;

    if (this.circuitState === CircuitState.HALF_OPEN) {
      // Test failed, reopen circuit
      this.openCircuit();
    } else if (
      this.circuitState === CircuitState.CLOSED &&
      this.failures >= this.circuitThreshold
    ) {
      // Threshold exceeded, open circuit
      this.openCircuit();
    }
  }

  /**
   * Record a success (called externally when message succeeds)
   */
  recordSuccess(message: ActorMessage): void {
    // Clean up any retry metadata
    this.retryMetadata.delete(message);

    if (this.circuitState === CircuitState.HALF_OPEN) {
      // Test succeeded, close circuit
      this.closeCircuit();
    }
  }

  /**
   * Open circuit breaker
   */
  private openCircuit(): void {
    if (this.circuitState === CircuitState.OPEN) return;

    log.warn('Opening circuit breaker', {
      failures: this.failures,
      threshold: this.circuitThreshold,
    });

    this.circuitState = CircuitState.OPEN;
    this.circuitOpenedAt = Date.now();

    // ✅ PURE ACTOR MODEL: Schedule reset to half-open using XState
    this.resetTimer = this.timeoutManager.setTimeout(() => {
      this.halfOpenCircuit();
    }, this.circuitResetTimeout);

    // Notify callback
    this.options.onCircuitOpen?.();
  }

  /**
   * Half-open circuit breaker
   */
  private halfOpenCircuit(): void {
    this.circuitState = CircuitState.HALF_OPEN;
    this.resetTimer = undefined;

    log.debug('Circuit breaker half-opened');
    this.options.onCircuitHalfOpen?.();
  }

  /**
   * Close circuit breaker
   */
  private closeCircuit(): void {
    if (this.circuitState === CircuitState.CLOSED) return;

    log.info('Closing circuit breaker', {
      previousState: this.circuitState,
      failures: this.failures,
    });

    this.circuitState = CircuitState.CLOSED;
    this.failures = 0;

    // Clear reset timer
    if (this.resetTimer) {
      this.timeoutManager.clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }

    // Notify callback
    this.options.onCircuitClose?.();
  }

  /**
   * Get current circuit breaker state
   */
  getCircuitState(): {
    state: CircuitState;
    failures: number;
    openedAt?: number;
  } {
    return {
      state: this.circuitState,
      failures: this.failures,
      openedAt: this.circuitState === CircuitState.OPEN ? this.circuitOpenedAt : undefined,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  resetCircuit(): void {
    this.closeCircuit();
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.retryMetadata = new WeakMap();
    this.timeoutManager.destroy(); // Stop all XState timeout actors
  }
}

/**
 * Create a pre-configured retry interceptor
 */
export function createRetryInterceptor(options?: RetryOptions): RetryInterceptor {
  return new RetryInterceptor(options);
}

/**
 * Create a retry interceptor for specific error types
 */
export function createTypedRetryInterceptor(
  errorTypes: string[],
  options?: RetryOptions
): RetryInterceptor {
  return new RetryInterceptor({
    ...options,
    isRetryable: (error) => {
      if (errorTypes.includes(error.name)) {
        return true;
      }
      return options?.isRetryable?.(error) ?? false;
    },
  });
}

/**
 * Create a retry interceptor for specific message types
 */
export function createMessageTypeRetryInterceptor(
  messageTypes: string[],
  options?: RetryOptions
): RetryInterceptor {
  return new RetryInterceptor({
    ...options,
    shouldRetry: (message) => {
      if (!messageTypes.includes(message.type)) {
        return false;
      }
      return options?.shouldRetry?.(message) ?? true;
    },
  });
}
