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

import type { ActorMessage } from './actor-system.js';

// ✅ PURE ACTOR MODEL: Import XState-based timeout management
import { PureXStateCorrelationManager as XStateCorrelationManager } from './pure-xstate-utilities.js';

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

  /** Handle an error for a given correlation ID */
  handleError(correlationId: string, error: Error): void;

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
// MOCK CORRELATION MANAGER
// ============================================================================

/**
 * Mock correlation manager for deterministic testing
 * Provides predictable behavior without actual timeouts
 */
export class MockCorrelationManager implements CorrelationManager {
  private readonly pendingRequests = new Map<string, PendingRequest<unknown>>();
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

      this.pendingRequests.set(correlationId, pendingRequest as PendingRequest<unknown>);
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
   * Handle error (mock implementation)
   */
  handleError(correlationId: string, error: Error): void {
    const pendingRequest = this.pendingRequests.get(correlationId);

    if (!pendingRequest) {
      return;
    }

    this.pendingRequests.delete(correlationId);
    pendingRequest.reject(error);
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
  // Use pure actor model implementation (XState-based, zero setTimeout violations)
  return new XStateCorrelationManager();
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
