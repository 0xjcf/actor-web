/**
 * Request-Response Pattern Implementation
 *
 * Enables synchronous-style communication over asynchronous actor messaging.
 * Supports timeouts, error handling, and automatic cleanup.
 */

import type { BaseMessage, QueryMessage, ResponseMessage } from './actor-ref.js';
import { ActorTimeoutError } from './actor-ref.js';

// ============================================================================
// REQUEST-RESPONSE MANAGER
// ============================================================================

/**
 * Manages pending requests and their responses
 */
export class RequestResponseManager {
  private pendingRequests = new Map<string, PendingRequest>();
  private defaultTimeout = 5000; // 5 seconds

  /**
   * Create a new request with timeout handling
   */
  createRequest<T>(query: QueryMessage, timeout: number = this.defaultTimeout): Promise<T> {
    const { responseId } = query;

    return new Promise<T>((resolve, reject) => {
      // Setup timeout
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(responseId);
        reject(new ActorTimeoutError('unknown', timeout));
      }, timeout);

      // Store pending request
      this.pendingRequests.set(responseId, {
        responseId,
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId,
        timestamp: Date.now(),
      });
    });
  }

  /**
   * Handle incoming response message
   */
  handleResponse(response: ResponseMessage): boolean {
    const pendingRequest = this.pendingRequests.get(response.responseId);

    if (!pendingRequest) {
      // Response for unknown request - might be late or duplicate
      return false;
    }

    // Clear timeout
    clearTimeout(pendingRequest.timeoutId);
    this.pendingRequests.delete(response.responseId);

    // Resolve or reject based on response
    if (response.error) {
      pendingRequest.reject(response.error);
    } else {
      pendingRequest.resolve(response.data);
    }

    return true;
  }

  /**
   * Get number of pending requests
   */
  getPendingCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Cancel all pending requests
   */
  cleanup(): void {
    for (const [, request] of this.pendingRequests) {
      clearTimeout(request.timeoutId);
      request.reject(new Error('Request manager cleanup'));
    }
    this.pendingRequests.clear();
  }

  /**
   * Cancel a specific request
   */
  cancelRequest(responseId: string): boolean {
    const request = this.pendingRequests.get(responseId);
    if (request) {
      clearTimeout(request.timeoutId);
      this.pendingRequests.delete(responseId);
      request.reject(new Error('Request cancelled'));
      return true;
    }
    return false;
  }

  /**
   * Set default timeout for new requests
   */
  setDefaultTimeout(timeout: number): void {
    this.defaultTimeout = timeout;
  }
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

interface PendingRequest {
  responseId: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  timestamp: number;
}

// ============================================================================
// QUERY RESPONSE UTILITIES
// ============================================================================

/**
 * Enhanced query message with automatic response ID generation
 */
export function createQuery(type: string, payload?: unknown, timeout?: number): QueryMessage {
  const baseQuery: QueryMessage = {
    type,
    responseId: generateResponseId(),
    timestamp: Date.now(),
    timeout,
  };

  // Add payload if provided
  if (payload !== undefined) {
    (baseQuery as QueryMessage & { payload?: unknown }).payload = payload;
  }

  return baseQuery;
}

/**
 * Create a response message for a given query
 */
export function createResponse(query: QueryMessage, data: unknown, error?: Error): ResponseMessage {
  return {
    type: 'RESPONSE',
    responseId: query.responseId,
    data,
    error,
    timestamp: Date.now(),
  };
}

/**
 * Generate unique response ID
 */
function generateResponseId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================================================
// QUERYABLE MACHINE ENHANCER
// ============================================================================

/**
 * Query handler function type
 */
export type QueryHandler<TContext = unknown> = (
  context: TContext,
  query: QueryMessage
) => unknown | Promise<unknown>;

/**
 * Registry of query handlers for a machine
 */
export interface QueryHandlerRegistry<TContext = unknown> {
  [queryType: string]: QueryHandler<TContext>;
}

/**
 * Enhanced machine configuration with query support
 */
export interface QueryableMachineConfig {
  queryHandlers?: QueryHandlerRegistry;
  defaultQueryTimeout?: number;
  enableQueryLogging?: boolean;
}

/**
 * Create query handling action for XState machines
 */
export function createQueryAction<TContext>(handlers: QueryHandlerRegistry<TContext>) {
  return ({ context, event }: { context: TContext; event: BaseMessage }) => {
    // Check if this is a query message
    if (!('responseId' in event) || typeof event.responseId !== 'string') {
      return; // Not a query, ignore
    }

    const query = event as QueryMessage;
    const handler = handlers[query.type];

    if (!handler) {
      // No handler for this query type - create error response
      createResponse(query, null, new Error(`No handler for query type: ${query.type}`));

      // Note: In real implementation, this would send the response back
      console.warn('No query handler for:', query.type);
      return;
    }

    try {
      // Execute handler
      const result = handler(context, query);

      if (result instanceof Promise) {
        // Async handler
        result
          .then((data) => {
            createResponse(query, data);
            // Send response back to requester
            // This would be implemented in the actual ActorRef
          })
          .catch((error) => {
            createResponse(query, null, error);
            // Send error response back
          });
      } else {
        // Sync handler
        createResponse(query, result);
        // Send response back immediately
      }
    } catch (error) {
      // Handler threw an error
      createResponse(query, null, error instanceof Error ? error : new Error(String(error)));
      // Send error response back
    }
  };
}

// ============================================================================
// COMMON QUERY PATTERNS
// ============================================================================

/**
 * Standard query types for common actor operations
 */
export const StandardQueries = {
  GET_STATE: 'GET_STATE',
  GET_CONTEXT: 'GET_CONTEXT',
  GET_STATUS: 'GET_STATUS',
  CAN_TRANSITION: 'CAN_TRANSITION',
  GET_CHILDREN: 'GET_CHILDREN',
  HEALTH_CHECK: 'HEALTH_CHECK',
} as const;

/**
 * Create standard query handlers for basic actor operations
 */
export function createStandardQueryHandlers<TContext>(): QueryHandlerRegistry<TContext> {
  return {
    [StandardQueries.GET_STATE]: (context) => {
      // This would return current state in real implementation
      return { type: 'state_snapshot', context };
    },

    [StandardQueries.GET_CONTEXT]: (context) => {
      return context;
    },

    [StandardQueries.GET_STATUS]: () => {
      return { status: 'running', timestamp: Date.now() };
    },

    [StandardQueries.HEALTH_CHECK]: () => {
      return { healthy: true, timestamp: Date.now() };
    },
  };
}
