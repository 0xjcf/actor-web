/**
 * @module actor-core/runtime/correlation-manager
 * @description Correlation Manager for Ask Pattern Request-Response Communication
 *
 * This module implements correlation ID management for the ask pattern, providing
 * unique identifier generation, request tracking, timeout handling, and automatic
 * resource cleanup to prevent memory leaks in distributed actor communication.
 *
 * Key Features:
 * - UUID-based correlation ID generation for collision resistance
 * - Promise-based request tracking with automatic correlation
 * - Configurable timeout handling with cleanup
 * - Memory leak prevention through proper resource management
 * - Mock implementation for deterministic testing
 *
 * @author OTP Implementation Team
 * @version 1.0.0
 */

import { Logger } from './logger.js';
import type { ActorMessage } from './message-plan.js';

// ✅ PURE ACTOR MODEL: Import XState-based timeout management
import { PureXStateCorrelationManager as XStateCorrelationManager } from './pure-xstate-utilities.js';

const log = Logger.namespace('CORRELATION_MANAGER');

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * Correlation manager interface for ask pattern support
 * Manages request-response correlation with automatic cleanup
 */
export interface CorrelationManager {
  /** Generate a unique correlation ID */
  generateId(): string;

  /** Register a request and return a promise that resolves with the response */
  registerRequest<T>(correlationId: string, timeout: number): Promise<T>;

  /** Handle a response for a given correlation ID */
  handleResponse(correlationId: string, response: ActorMessage): void;

  /** Handle timeout for a given correlation ID */
  handleTimeout(correlationId: string): void;

  /** Get the number of pending requests (for monitoring) */
  getPendingRequestCount(): number;

  /** Clear all pending requests (for cleanup) */
  clearAllRequests(): void;
}

/**
 * Configuration options for correlation manager
 */
export interface CorrelationManagerConfig {
  /** Default timeout for requests in milliseconds */
  defaultTimeout: number;

  /** Maximum number of concurrent requests */
  maxConcurrentRequests: number;

  /** Whether to enable debug logging */
  enableDebugLogging: boolean;

  /** Custom ID prefix for debugging */
  idPrefix?: string;
}

/**
 * Default configuration for correlation manager
 */
export const DEFAULT_CORRELATION_CONFIG: CorrelationManagerConfig = {
  defaultTimeout: 30000, // 30 seconds
  maxConcurrentRequests: 10000,
  enableDebugLogging: false,
  idPrefix: 'corr',
};

// ============================================================================
// INTERNAL TYPES
// ============================================================================

/**
 * Internal request tracking structure
 */
interface PendingRequest<T = unknown> {
  /** Promise resolver function */
  resolve: (value: T) => void;

  /** Promise rejector function */
  reject: (error: Error) => void;

  /** Timeout handle for cleanup */
  timeoutHandle: number | NodeJS.Timeout;

  /** Timestamp when request was created */
  createdAt: number;

  /** Timeout duration in milliseconds */
  timeoutMs: number;
}

// ============================================================================
// DEFAULT CORRELATION MANAGER
// ============================================================================

/**
 * @deprecated Legacy DefaultCorrelationManager with setTimeout violations
 * ❌ VIOLATES PURE ACTOR MODEL - Uses setTimeout
 *
 * Use PureXStateCorrelationManager (via createCorrelationManager()) instead
 * for pure actor model compliance. This implementation will be removed in a future version.
 *
 * @see PureXStateCorrelationManager
 * @see createCorrelationManager
 */
export class DefaultCorrelationManager implements CorrelationManager {
  private readonly config: CorrelationManagerConfig;
  // Using any here is acceptable: type-erased container pattern
  // Type safety is maintained at promise resolution points
  // biome-ignore lint/suspicious/noExplicitAny: Type-erased container pattern for correlation manager
  private readonly pendingRequests = new Map<string, PendingRequest<any>>();
  private requestCounter = 0;

  constructor(config: Partial<CorrelationManagerConfig> = {}) {
    this.config = { ...DEFAULT_CORRELATION_CONFIG, ...config };

    if (this.config.enableDebugLogging) {
      log.debug('Correlation manager initialized', {
        defaultTimeout: this.config.defaultTimeout,
        maxConcurrentRequests: this.config.maxConcurrentRequests,
        idPrefix: this.config.idPrefix,
      });
    }
  }

  /**
   * Generate a unique correlation ID
   * Uses timestamp + counter + random for collision resistance
   */
  generateId(): string {
    const timestamp = Date.now();
    const counter = ++this.requestCounter;
    const random = Math.random().toString(36).substr(2, 9);

    const prefix = this.config.idPrefix || 'corr';
    const id = `${prefix}-${timestamp}-${counter}-${random}`;

    if (this.config.enableDebugLogging) {
      log.debug('Generated correlation ID', { id });
    }

    return id;
  }

  /**
   * Register a request and return a promise that resolves with the response
   * Automatically sets up timeout handling and resource cleanup
   */
  async registerRequest<T>(correlationId: string, timeout: number): Promise<T> {
    // Check if we're at capacity
    if (this.pendingRequests.size >= this.config.maxConcurrentRequests) {
      throw new Error(
        `Correlation manager at capacity: ${this.config.maxConcurrentRequests} concurrent requests`
      );
    }

    // Check if correlation ID is already in use
    if (this.pendingRequests.has(correlationId)) {
      throw new Error(`Correlation ID already in use: ${correlationId}`);
    }

    const timeoutMs = timeout > 0 ? timeout : this.config.defaultTimeout;

    return new Promise<T>((resolve, reject) => {
      // Set up timeout handling
      const timeoutHandle = setTimeout(() => {
        this.handleTimeout(correlationId);
      }, timeoutMs);

      // Store the pending request
      const pendingRequest: PendingRequest<T> = {
        resolve,
        reject,
        timeoutHandle,
        createdAt: Date.now(),
        timeoutMs,
      };

      this.pendingRequests.set(correlationId, pendingRequest);

      if (this.config.enableDebugLogging) {
        log.debug('Registered request', {
          correlationId,
          timeoutMs,
          pendingCount: this.pendingRequests.size,
        });
      }
    });
  }

  /**
   * Handle a response for a given correlation ID
   * Resolves the corresponding promise and cleans up resources
   */
  handleResponse(correlationId: string, response: ActorMessage): void {
    const pendingRequest = this.pendingRequests.get(correlationId);

    if (!pendingRequest) {
      if (this.config.enableDebugLogging) {
        log.warn('Received response for unknown correlation ID', {
          correlationId,
          responseType: response.type,
        });
      }
      return;
    }

    // Clear the timeout
    clearTimeout(pendingRequest.timeoutHandle as number);

    // Remove from pending requests
    this.pendingRequests.delete(correlationId);

    // Resolve the promise
    try {
      pendingRequest.resolve(response);

      if (this.config.enableDebugLogging) {
        const duration = Date.now() - pendingRequest.createdAt;
        log.debug('Request completed successfully', {
          correlationId,
          duration,
          pendingCount: this.pendingRequests.size,
        });
      }
    } catch (error) {
      log.error('Error resolving request promise', {
        correlationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Handle timeout for a given correlation ID
   * Rejects the corresponding promise and cleans up resources
   */
  handleTimeout(correlationId: string): void {
    const pendingRequest = this.pendingRequests.get(correlationId);

    if (!pendingRequest) {
      // Already handled or cleaned up
      return;
    }

    // Remove from pending requests
    this.pendingRequests.delete(correlationId);

    // Create timeout error
    const duration = Date.now() - pendingRequest.createdAt;
    const error = new Error(
      `Request ${correlationId} timed out after ${duration}ms (configured: ${pendingRequest.timeoutMs}ms)`
    );

    // Reject the promise
    try {
      pendingRequest.reject(error);

      if (this.config.enableDebugLogging) {
        log.debug('Request timed out', {
          correlationId,
          duration,
          configuredTimeout: pendingRequest.timeoutMs,
          pendingCount: this.pendingRequests.size,
        });
      }
    } catch (rejectionError) {
      log.error('Error rejecting timed out request', {
        correlationId,
        error: rejectionError instanceof Error ? rejectionError.message : 'Unknown error',
      });
    }
  }

  /**
   * Get the number of pending requests (for monitoring)
   */
  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Clear all pending requests (for cleanup)
   * This will reject all pending promises with a cleanup error
   */
  clearAllRequests(): void {
    const requestCount = this.pendingRequests.size;

    if (requestCount === 0) {
      return;
    }

    // Create cleanup error
    const cleanupError = new Error(
      'Correlation manager shutting down - all pending requests cancelled'
    );

    // Reject all pending requests and clear timeouts
    for (const [correlationId, pendingRequest] of this.pendingRequests.entries()) {
      try {
        clearTimeout(pendingRequest.timeoutHandle as number);
        pendingRequest.reject(cleanupError);
      } catch (error) {
        log.error('Error during request cleanup', {
          correlationId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Clear the map
    this.pendingRequests.clear();

    if (this.config.enableDebugLogging) {
      log.debug('Cleared all pending requests', { requestCount });
    }
  }

  /**
   * Get statistics about the correlation manager (for monitoring)
   */
  getStats() {
    return {
      pendingRequests: this.pendingRequests.size,
      maxConcurrentRequests: this.config.maxConcurrentRequests,
      requestCounter: this.requestCounter,
      config: this.config,
    };
  }
}

// ============================================================================
// MOCK CORRELATION MANAGER
// ============================================================================

/**
 * Mock correlation manager for deterministic testing
 * Provides predictable behavior without actual timeouts
 */
export class MockCorrelationManager implements CorrelationManager {
  // Using any here is acceptable: type-erased container pattern
  // Type safety is maintained at promise resolution points
  // biome-ignore lint/suspicious/noExplicitAny: Type-erased container pattern for correlation manager
  private readonly pendingRequests = new Map<string, PendingRequest<any>>();
  private readonly state = { idCounter: 0 };
  public readonly responses = new Map<string, ActorMessage>();
  public readonly timeouts = new Set<string>();

  /**
   * Generate a predictable correlation ID for testing
   */
  generateId(): string {
    return `mock-corr-${++this.state.idCounter}`;
  }

  /**
   * Register a request (mock implementation)
   */
  async registerRequest<T>(correlationId: string, timeout: number): Promise<T> {
    if (this.pendingRequests.has(correlationId)) {
      throw new Error(`Mock: Correlation ID already in use: ${correlationId}`);
    }

    return new Promise<T>((resolve, reject) => {
      const pendingRequest: PendingRequest<T> = {
        resolve,
        reject,
        timeoutHandle: 0, // No actual timeout in mock
        createdAt: Date.now(),
        timeoutMs: timeout,
      };

      this.pendingRequests.set(correlationId, pendingRequest);
    });
  }

  /**
   * Handle response (mock implementation)
   */
  handleResponse(correlationId: string, response: ActorMessage): void {
    const pendingRequest = this.pendingRequests.get(correlationId);

    if (!pendingRequest) {
      return;
    }

    this.responses.set(correlationId, response);
    this.pendingRequests.delete(correlationId);
    // Type safety maintained: caller expects ActorMessage type
    pendingRequest.resolve(response);
  }

  /**
   * Handle timeout (mock implementation)
   */
  handleTimeout(correlationId: string): void {
    const pendingRequest = this.pendingRequests.get(correlationId);

    if (!pendingRequest) {
      return;
    }

    this.timeouts.add(correlationId);
    this.pendingRequests.delete(correlationId);
    pendingRequest.reject(new Error(`Mock timeout: ${correlationId}`));
  }

  /**
   * Get pending request count
   */
  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Clear all requests
   */
  clearAllRequests(): void {
    for (const [_correlationId, pendingRequest] of this.pendingRequests.entries()) {
      pendingRequest.reject(new Error('Mock cleanup'));
    }
    this.pendingRequests.clear();
  }

  /**
   * Mock-specific helper methods for testing
   */

  /** Manually trigger timeout for testing */
  triggerTimeout(correlationId: string): void {
    this.handleTimeout(correlationId);
  }

  /** Check if correlation ID is pending */
  hasPendingRequest(correlationId: string): boolean {
    return this.pendingRequests.has(correlationId);
  }

  /** Get all pending correlation IDs */
  getPendingCorrelationIds(): string[] {
    return Array.from(this.pendingRequests.keys());
  }

  /** Reset all state for testing */
  reset(): void {
    this.clearAllRequests();
    this.responses.clear();
    this.timeouts.clear();
    this.state.idCounter = 0;
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a correlation manager with optional configuration
 * ✅ PURE ACTOR MODEL: Uses XState-based scheduling instead of setTimeout
 */
export function createCorrelationManager(
  _config?: Partial<CorrelationManagerConfig>
): CorrelationManager {
  // Use pure actor model implementation by default
  return new XStateCorrelationManager();

  // Legacy implementation (setTimeout violations) available if needed:
  // return new DefaultCorrelationManager(config);
}

/**
 * Create a mock correlation manager for testing
 */
export function createMockCorrelationManager(): MockCorrelationManager {
  return new MockCorrelationManager();
}

// ============================================================================
// PURE ACTOR MODEL EXPORTS
// ============================================================================

/**
 * Export the XState-based correlation manager for pure actor model compliance
 * This replaces setTimeout with XState-based scheduling
 */
export { XStateCorrelationManager };

/**
 * Create a pure actor model correlation manager using XState
 * This is the preferred implementation for production use
 */
export function createPureCorrelationManager(): CorrelationManager {
  return new XStateCorrelationManager();
}
