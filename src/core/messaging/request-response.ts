/**
 * @module framework/core/messaging/request-response
 * @description Request/response pattern implementation with correlation IDs
 * @author Agent A - 2025-01-10
 */

import { TimeoutError } from '../actors/actor-ref.js';
import type { Query, RequestEnvelope, ResponseEnvelope } from './message-types.js';

/**
 * Manages request/response correlation for the ask pattern
 */
export class RequestResponseManager {
  private pendingRequests = new Map<string, PendingRequest>();
  private defaultTimeout: number;

  constructor(defaultTimeout = 5000) {
    this.defaultTimeout = defaultTimeout;
  }

  /**
   * Create a request and return a promise that resolves with the response
   * @param query - The query to send
   * @param timeout - Optional timeout override
   * @returns Promise resolving to the response
   */
  createRequest<TRequest, TResponse>(
    query: Query<TRequest, TResponse>,
    timeout?: number
  ): { envelope: RequestEnvelope<TRequest>; promise: Promise<TResponse> } {
    const id = generateCorrelationId();
    const requestTimeout = timeout ?? this.defaultTimeout;

    const envelope: RequestEnvelope<TRequest> = {
      id,
      query,
      timestamp: Date.now(),
      timeout: requestTimeout,
    };

    const promise = new Promise<TResponse>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new TimeoutError(`Request ${id} timed out after ${requestTimeout}ms`, requestTimeout)
        );
      }, requestTimeout);

      this.pendingRequests.set(id, {
        resolve,
        reject,
        timeoutId,
        startTime: Date.now(),
      });
    });

    return { envelope, promise };
  }

  /**
   * Handle a response for a pending request
   * @param response - The response envelope
   */
  handleResponse<TResponse>(response: ResponseEnvelope<TResponse>): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      // Response for unknown or already completed request
      return;
    }

    this.pendingRequests.delete(response.id);
    clearTimeout(pending.timeoutId);

    if (response.error) {
      pending.reject(response.error);
    } else {
      pending.resolve(response.result as TResponse);
    }
  }

  /**
   * Cancel a pending request
   * @param id - The request correlation ID
   */
  cancelRequest(id: string): void {
    const pending = this.pendingRequests.get(id);
    if (pending) {
      this.pendingRequests.delete(id);
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(`Request ${id} was cancelled`));
    }
  }

  /**
   * Clean up all pending requests
   */
  cleanup(): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(`Request ${id} cancelled due to cleanup`));
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
   * Get statistics about pending requests
   */
  getStats(): RequestStats {
    const now = Date.now();
    const pendingRequests = Array.from(this.pendingRequests.entries()).map(([id, req]) => ({
      id,
      duration: now - req.startTime,
    }));

    return {
      pendingCount: pendingRequests.length,
      requests: pendingRequests,
      oldestDuration:
        pendingRequests.length > 0 ? Math.max(...pendingRequests.map((r) => r.duration)) : 0,
    };
  }
}

/**
 * Generate a unique correlation ID using UUID v4
 */
function generateCorrelationId(): string {
  // UUID v4 implementation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Internal type for tracking pending requests
 */
interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
  startTime: number;
}

/**
 * Statistics about pending requests
 */
export interface RequestStats {
  pendingCount: number;
  requests: Array<{ id: string; duration: number }>;
  oldestDuration: number;
}

/**
 * Create a query object with proper typing
 */
export function createQuery<TRequest, TResponse>(
  request: string,
  params?: TRequest
): Query<TRequest, TResponse> {
  return {
    type: 'query',
    request,
    params,
  };
}
