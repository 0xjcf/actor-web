/**
 * @module actor-core/runtime/messaging/request-response
 * @description Request/response pattern implementation for Actor-Core runtime
 * @author Agent A (Tech Lead) - 2025-07-15
 */

import { TimeoutError } from '../actor-ref.js';
import { PureXStateTimeoutManager } from '../pure-xstate-utilities.js';
import type { AskOptions, EventMetadata, QueryEvent } from '../types.js';
import { generateCorrelationId } from '../utils/factories.js';
// ==================================
// ========================================================================================

/**
 * Context for a pending request with timeout and retry logic
 */
export interface RequestContext<TResponse> {
  readonly correlationId: string;
  readonly queryEvent: QueryEvent;
  readonly promise: Promise<TResponse>;
  readonly createdAt: number;
  readonly timeout: number;
  readonly retries: number;
  readonly currentAttempt: number;
}

/**
 * Configuration options for RequestResponseManager
 */
export interface RequestResponseManagerOptions {
  defaultTimeout?: number;
  defaultRetries?: number;
  defaultRetryDelay?: number;
}

/**
 * Statistics about request/response operations
 */
export interface RequestResponseStats {
  pendingCount: number;
  totalRequests: number;
  completedRequests: number;
  timeoutRequests: number;
  errorRequests: number;
  averageResponseTime: number;
}

// Use XStateRequestResponseManager which provides pure actor model compliance

// ============================================================================
// PURE ACTOR MODEL REQUEST-RESPONSE MANAGER
// ============================================================================

/**
 * XState version of PendingRequest without timeoutId
 */
interface XStatePendingRequest<TResponse = unknown> {
  readonly resolve: (value: TResponse) => void;
  readonly reject: (error: Error) => void;
  readonly startTime: number;
  readonly attempt: number;
  readonly maxRetries: number;
  readonly retryDelay: number;
  readonly metadata: EventMetadata;
}

/**
 * XState-based RequestResponseManager for pure actor model compliance
 * Replaces setTimeout with XState-based scheduling
 */
export class XStateRequestResponseManager {
  private pendingRequests = new Map<string, XStatePendingRequest<unknown>>();
  private timeoutIds = new Map<string, string>(); // Track timeout IDs separately
  private timeoutManager = new PureXStateTimeoutManager();
  private requestStats = {
    total: 0,
    completed: 0,
    timeout: 0,
    error: 0,
    totalResponseTime: 0,
  };

  private readonly defaultTimeout: number;
  private readonly defaultRetries: number;
  private readonly defaultRetryDelay: number;

  constructor(options: RequestResponseManagerOptions = {}) {
    this.defaultTimeout = options.defaultTimeout ?? 5000;
    this.defaultRetries = options.defaultRetries ?? 0;
    this.defaultRetryDelay = options.defaultRetryDelay ?? 1000;
  }

  /**
   * Create a request with XState-based timeout management
   */
  createRequest<TQuery, TResponse>(
    query: TQuery,
    options: AskOptions = {}
  ): RequestContext<TResponse> {
    const correlationId = options.correlationId ?? generateCorrelationId();
    const timeout = options.timeout ?? this.defaultTimeout;
    const retries = options.retries ?? this.defaultRetries;
    const retryDelay = options.retryDelay ?? this.defaultRetryDelay;

    // Create metadata with correlation tracking
    const metadata: EventMetadata = {
      correlationId,
      timestamp: Date.now(),
      ...options.metadata,
    };

    // Create query event
    const queryEvent: QueryEvent<TQuery> = {
      type: 'query',
      request: this.extractRequestType(query),
      params: query,
      correlationId,
      timeout,
      metadata,
    };

    // ✅ PURE ACTOR MODEL: Create promise with XState scheduling
    const promise = new Promise<TResponse>((resolve, reject) => {
      this.requestStats.total++;

      const executeRequest = (attempt: number): void => {
        // ✅ Use XState scheduler instead of setTimeout
        const timeoutId = this.timeoutManager.setTimeout(() => {
          this.pendingRequests.delete(correlationId);

          if (attempt < retries) {
            // ✅ Retry with XState delay instead of setTimeout
            const delay = this.calculateRetryDelay(retryDelay, attempt);

            this.timeoutManager.setTimeout(() => executeRequest(attempt + 1), delay);

            this.pendingRequests.set(correlationId, {
              resolve: resolve as (value: unknown) => void,
              reject,
              startTime: Date.now(),
              attempt: attempt + 1,
              maxRetries: retries,
              retryDelay,
              metadata,
            });
          } else {
            // Final timeout
            this.requestStats.timeout++;
            reject(new TimeoutError(timeout, 'ask'));
          }
        }, timeout);

        this.pendingRequests.set(correlationId, {
          resolve: resolve as (value: unknown) => void,
          reject,
          startTime: Date.now(),
          attempt,
          maxRetries: retries,
          retryDelay,
          metadata,
        });

        // Store timeout ID for cancellation
        this.timeoutIds.set(correlationId, timeoutId);
      };

      executeRequest(1);
    });

    return {
      correlationId,
      queryEvent,
      promise,
      createdAt: Date.now(),
      timeout,
      retries,
      currentAttempt: 1,
    };
  }

  /**
   * Handle response for correlation ID
   */
  handleResponse(correlationId: string, response: unknown): void {
    const pendingRequest = this.pendingRequests.get(correlationId);
    if (!pendingRequest) {
      return;
    }

    // Cancel XState timeout if we have the timeout ID
    const timeoutId = this.timeoutIds.get(correlationId);
    if (timeoutId) {
      this.timeoutManager.clearTimeout(timeoutId);
    }

    // Update statistics
    this.requestStats.completed++;
    this.requestStats.totalResponseTime += Date.now() - pendingRequest.startTime;

    // Clean up and resolve
    this.pendingRequests.delete(correlationId);
    this.timeoutIds.delete(correlationId); // Clean up timeout ID
    pendingRequest.resolve(response);
  }

  /**
   * Handle error for correlation ID
   */
  handleError(correlationId: string, error: Error): void {
    const pendingRequest = this.pendingRequests.get(correlationId);
    if (!pendingRequest) {
      return;
    }

    // Cancel XState timeout if we have the timeout ID
    const timeoutId = this.timeoutIds.get(correlationId);
    if (timeoutId) {
      this.timeoutManager.clearTimeout(timeoutId);
    }

    // Update statistics
    this.requestStats.error++;

    // Clean up and reject
    this.pendingRequests.delete(correlationId);
    this.timeoutIds.delete(correlationId); // Clean up timeout ID
    pendingRequest.reject(error);
  }

  /**
   * Get current statistics
   */
  getStats() {
    return {
      ...this.requestStats,
      pending: this.pendingRequests.size,
      averageResponseTime:
        this.requestStats.completed > 0
          ? this.requestStats.totalResponseTime / this.requestStats.completed
          : 0,
    };
  }

  /**
   * Clear all pending requests
   */
  clear(): void {
    // Cancel all XState timeouts
    this.timeoutManager.clearAllTimeouts();

    // Reject all pending requests
    for (const [_correlationId, pendingRequest] of this.pendingRequests) {
      pendingRequest.reject(new Error('Request manager cleared'));
    }

    this.pendingRequests.clear();
    this.timeoutIds.clear(); // Clear all timeout IDs

    // Reset statistics
    this.requestStats.total = 0;
    this.requestStats.completed = 0;
    this.requestStats.timeout = 0;
    this.requestStats.error = 0;
    this.requestStats.totalResponseTime = 0;
  }

  /**
   * Extract request type from query (utility method)
   */
  private extractRequestType(query: unknown): string {
    if (query && typeof query === 'object' && 'type' in query) {
      return String(query.type);
    }
    return 'unknown';
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(baseDelay: number, attempt: number): number {
    return baseDelay * 2 ** (attempt - 1);
  }

  /**
   * Stop the timeout manager
   */
  stop(): void {
    this.clear();
    this.timeoutManager.destroy();
  }
}
