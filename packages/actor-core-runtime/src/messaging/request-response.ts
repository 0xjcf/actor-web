/**
 * @module actor-core/runtime/messaging/request-response
 * @description Request/response pattern implementation for Actor-Core runtime
 * @author Agent A (Tech Lead) - 2025-07-15
 */

import { TimeoutError, generateCorrelationId } from '../actor-ref.js';
import type { AskOptions, EventMetadata, QueryEvent } from '../types.js';

// ========================================================================================
// REQUEST CONTEXT & MANAGEMENT
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
 * Internal tracking for pending requests
 */
interface PendingRequest<TResponse = unknown> {
  resolve: (value: TResponse) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
  retryTimeoutId?: NodeJS.Timeout;
  startTime: number;
  attempt: number;
  maxRetries: number;
  retryDelay: number;
  metadata: EventMetadata;
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

// ========================================================================================
// REQUEST/RESPONSE MANAGER
// ========================================================================================

/**
 * Manages request/response correlation for the ask pattern
 */
export class RequestResponseManager {
  private pendingRequests = new Map<string, PendingRequest<unknown>>();
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
   * Create a request with correlation ID and return promise
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

    // Create promise with retry logic
    const promise = new Promise<TResponse>((resolve, reject) => {
      this.requestStats.total++;

      const executeRequest = (attempt: number): void => {
        const timeoutId = setTimeout(() => {
          this.pendingRequests.delete(correlationId);

          if (attempt < retries) {
            // Retry with exponential backoff
            const delay = this.calculateRetryDelay(retryDelay, attempt);
            const retryTimeoutId = setTimeout(() => executeRequest(attempt + 1), delay);

            this.pendingRequests.set(correlationId, {
              resolve: resolve as (value: unknown) => void,
              reject,
              timeoutId,
              retryTimeoutId,
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
          timeoutId,
          startTime: Date.now(),
          attempt,
          maxRetries: retries,
          retryDelay,
          metadata,
        });
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
   * Handle a response for a pending request
   */
  handleResponse<TResponse>(correlationId: string, response: TResponse): boolean {
    const request = this.pendingRequests.get(correlationId);
    if (!request) {
      return false;
    }

    // Clear timeouts
    clearTimeout(request.timeoutId);
    if (request.retryTimeoutId) {
      clearTimeout(request.retryTimeoutId);
    }

    // Update statistics
    this.requestStats.completed++;
    this.requestStats.totalResponseTime += Date.now() - request.startTime;

    // Resolve the promise
    request.resolve(response);
    this.pendingRequests.delete(correlationId);

    return true;
  }

  /**
   * Handle an error for a pending request
   */
  handleError(correlationId: string, error: Error): boolean {
    const request = this.pendingRequests.get(correlationId);
    if (!request) {
      return false;
    }

    // Clear timeouts
    clearTimeout(request.timeoutId);
    if (request.retryTimeoutId) {
      clearTimeout(request.retryTimeoutId);
    }

    // Update statistics
    this.requestStats.error++;

    // Reject the promise
    request.reject(error);
    this.pendingRequests.delete(correlationId);

    return true;
  }

  /**
   * Get current statistics
   */
  getStats(): RequestResponseStats {
    const avgResponseTime =
      this.requestStats.completed > 0
        ? this.requestStats.totalResponseTime / this.requestStats.completed
        : 0;

    return {
      pendingCount: this.pendingRequests.size,
      totalRequests: this.requestStats.total,
      completedRequests: this.requestStats.completed,
      timeoutRequests: this.requestStats.timeout,
      errorRequests: this.requestStats.error,
      averageResponseTime: avgResponseTime,
    };
  }

  /**
   * Cleanup all pending requests
   */
  cleanup(): void {
    for (const [_correlationId, request] of this.pendingRequests) {
      clearTimeout(request.timeoutId);
      if (request.retryTimeoutId) {
        clearTimeout(request.retryTimeoutId);
      }
      request.reject(new Error('Request manager cleanup'));
    }
    this.pendingRequests.clear();
  }

  /**
   * Extract request type from query for tracking
   */
  private extractRequestType(query: unknown): string {
    if (typeof query === 'object' && query !== null && 'type' in query) {
      return String((query as { type: unknown }).type);
    }
    return 'unknown';
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(baseDelay: number, attempt: number): number {
    return baseDelay * 2 ** (attempt - 1);
  }
}
