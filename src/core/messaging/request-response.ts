/**
 * @module framework/core/messaging/request-response
 * @description Enhanced request/response pattern implementation with correlation IDs
 * @author Agent A (Tech Lead) - 2025-07-10
 */

import {
  type AskOptions,
  type EventMetadata,
  type QueryEvent,
  type ResponseEvent,
  TimeoutError,
  generateCorrelationId,
} from '../actors/actor-ref.js';

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
 * Statistics about request/response operations
 */
export interface RequestResponseStats {
  pendingCount: number;
  totalRequests: number;
  completedRequests: number;
  timeoutRequests: number;
  errorRequests: number;
  averageResponseTime: number;
  requests: Array<{
    id: string;
    duration: number;
    attempt: number;
    status: 'pending' | 'completed' | 'timeout' | 'error';
  }>;
}

// ========================================================================================
// REQUEST/RESPONSE MANAGER
// ========================================================================================

/**
 * Manages request/response correlation for the ask pattern with advanced features
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
   * @param query - The query to send
   * @param options - Request options including timeout and retries
   * @returns Request context with query event and promise
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
            reject(
              new TimeoutError(
                `Request ${correlationId} timed out after ${timeout}ms (${retries + 1} attempts)`,
                timeout,
                correlationId
              )
            );
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

      executeRequest(0);
    });

    return {
      correlationId,
      queryEvent,
      promise,
      createdAt: Date.now(),
      timeout,
      retries,
      currentAttempt: 0,
    };
  }

  /**
   * Handle a response for a pending request
   * @param response - The response envelope
   */
  handleResponse<TResponse>(response: ResponseEvent<TResponse>): void {
    const pending = this.pendingRequests.get(response.correlationId);
    if (!pending) {
      // Response for unknown or already completed request
      console.warn(`Received response for unknown request: ${response.correlationId}`);
      return;
    }

    this.pendingRequests.delete(response.correlationId);
    this.clearTimeouts(pending);

    // Update stats
    const responseTime = Date.now() - pending.startTime;
    this.requestStats.totalResponseTime += responseTime;

    if (response.error) {
      this.requestStats.error++;
      pending.reject(response.error);
    } else {
      this.requestStats.completed++;
      pending.resolve(response.result as TResponse);
    }
  }

  /**
   * Cancel a pending request
   * @param correlationId - The request correlation ID
   * @param reason - Optional cancellation reason
   */
  cancelRequest(correlationId: string, reason = 'Request cancelled'): void {
    const pending = this.pendingRequests.get(correlationId);
    if (pending) {
      this.pendingRequests.delete(correlationId);
      this.clearTimeouts(pending);
      pending.reject(new Error(`${reason}: ${correlationId}`));
    }
  }

  /**
   * Cancel all pending requests (typically during cleanup)
   * @param reason - Cancellation reason
   */
  cancelAllRequests(reason = 'Manager cleanup'): void {
    for (const [correlationId, pending] of this.pendingRequests) {
      this.clearTimeouts(pending);
      pending.reject(new Error(`${reason}: ${correlationId}`));
    }
    this.pendingRequests.clear();
  }

  /**
   * Get the number of pending requests
   */
  getPendingCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Get comprehensive statistics about request/response operations
   */
  getStats(): RequestResponseStats {
    const now = Date.now();
    const pendingRequests = Array.from(this.pendingRequests.entries()).map(([id, req]) => ({
      id,
      duration: now - req.startTime,
      attempt: req.attempt,
      status: 'pending' as const,
    }));

    const averageResponseTime =
      this.requestStats.completed > 0
        ? this.requestStats.totalResponseTime / this.requestStats.completed
        : 0;

    return {
      pendingCount: pendingRequests.length,
      totalRequests: this.requestStats.total,
      completedRequests: this.requestStats.completed,
      timeoutRequests: this.requestStats.timeout,
      errorRequests: this.requestStats.error,
      averageResponseTime,
      requests: pendingRequests,
    };
  }

  /**
   * Clean up manager resources
   */
  cleanup(): void {
    this.cancelAllRequests('Manager cleanup');
  }

  // ========================================================================================
  // PRIVATE HELPER METHODS
  // ========================================================================================

  private extractRequestType<TQuery>(query: TQuery): string {
    if (typeof query === 'string') {
      return query;
    }
    if (typeof query === 'object' && query !== null && 'type' in query) {
      return String((query as { type: unknown }).type);
    }
    return 'unknown';
  }

  private calculateRetryDelay(baseDelay: number, attempt: number): number {
    // Exponential backoff with jitter
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.3; // ±15% jitter
    return Math.floor(exponentialDelay * (1 + jitter));
  }

  private clearTimeouts(pending: PendingRequest<unknown>): void {
    clearTimeout(pending.timeoutId);
    if (pending.retryTimeoutId) {
      clearTimeout(pending.retryTimeoutId);
    }
  }
}

// ========================================================================================
// FACTORY FUNCTIONS
// ========================================================================================

/**
 * Configuration options for RequestResponseManager
 */
export interface RequestResponseManagerOptions {
  defaultTimeout?: number;
  defaultRetries?: number;
  defaultRetryDelay?: number;
}

/**
 * Create a new RequestResponseManager instance
 */
export function createRequestResponseManager(
  options?: RequestResponseManagerOptions
): RequestResponseManager {
  return new RequestResponseManager(options);
}

/**
 * Create a query object with proper typing
 */
export function createQuery<TRequest, TResponse>(
  request: string,
  params?: TRequest,
  metadata?: EventMetadata
): QueryEvent<TRequest> {
  return {
    type: 'query',
    request,
    params,
    correlationId: generateCorrelationId(),
    metadata: {
      timestamp: Date.now(),
      ...metadata,
    },
  };
}

/**
 * Create a response object with proper typing
 */
export function createResponse<TResult>(
  correlationId: string,
  result?: TResult,
  error?: Error,
  metadata?: EventMetadata
): ResponseEvent<TResult> {
  return {
    type: 'response',
    correlationId,
    result,
    error,
    metadata: {
      timestamp: Date.now(),
      ...metadata,
    },
  };
}

// ========================================================================================
// UTILITY FUNCTIONS
// ========================================================================================

/**
 * Check if a request has timed out based on its creation time
 */
export function isRequestTimedOut(
  requestContext: RequestContext<unknown>,
  currentTime = Date.now()
): boolean {
  return currentTime - requestContext.createdAt > requestContext.timeout;
}

/**
 * Calculate the remaining timeout for a request
 */
export function getRemainingTimeout(
  requestContext: RequestContext<unknown>,
  currentTime = Date.now()
): number {
  const elapsed = currentTime - requestContext.createdAt;
  return Math.max(0, requestContext.timeout - elapsed);
}

/**
 * Validate that a correlation ID is well-formed
 */
export function isValidCorrelationId(correlationId: string): boolean {
  return (
    typeof correlationId === 'string' &&
    correlationId.length > 0 &&
    /^[a-f0-9-]{36}$/.test(correlationId)
  );
}
