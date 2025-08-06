/**
 * @module actor-core/runtime/pure-xstate-utilities
 * @description Pure XState utilities for timeout and delay management
 *
 * This module provides clean, simple XState-based utilities that replace
 * JavaScript timers (setTimeout, setInterval) with pure XState patterns.
 *
 * Key Features:
 * - XState setup() for optimal TypeScript inference
 * - Pure XState 'after' transitions (zero JavaScript timers)
 * - Simple, clean API for common timeout patterns
 * - Full type safety without any type casting
 *
 * @author Pure Actor Model Implementation Team
 * @version 3.0.0 - Clean XState utilities
 */

import type { AnyActor } from 'xstate';
import { createActor, setup } from 'xstate';
import { Logger } from './logger.js';

const log = Logger.namespace('PURE_XSTATE');

// ============================================================================
// PURE ACTOR DELAY ALTERNATIVE
// ============================================================================

/**
 * Creates a delay actor that requires explicit START event
 * More pure actor model - exposes actor directly for manual control
 *
 * @param ms - Delay in milliseconds
 * @returns Delay actor that can be controlled manually
 */
export function createDelayActor(ms: number) {
  const delayMachine = setup({
    types: {
      context: {} as { delay: number },
      events: {} as { type: 'START' | 'CANCEL' },
    },
  }).createMachine({
    id: 'manualDelay',
    initial: 'idle',
    context: { delay: ms },
    states: {
      idle: {
        on: {
          START: 'waiting',
        },
      },
      waiting: {
        // ✅ PURE XSTATE: Delay only starts after START event
        after: {
          [ms]: 'completed',
        },
        on: {
          CANCEL: 'cancelled',
        },
      },
      completed: {
        type: 'final',
      },
      cancelled: {
        type: 'final',
      },
    },
  });

  return createActor(delayMachine);
}

/**
 * Utility to wait for delay actor completion
 * Bridges actor model with Promise for convenience
 */
export function waitForDelayActor(
  delayActor: ReturnType<typeof createDelayActor>
): Promise<'completed' | 'cancelled'> {
  return new Promise((resolve) => {
    const subscription = delayActor.subscribe((state) => {
      if (state.matches('completed')) {
        subscription.unsubscribe();
        resolve('completed');
      } else if (state.matches('cancelled')) {
        subscription.unsubscribe();
        resolve('cancelled');
      }
    });
  });
}

// ============================================================================
// PURE XSTATE DELAY (ORIGINAL - CONVENIENCE WRAPPER)
// ============================================================================

/**
 * Pure XState delay using setup() - zero JavaScript timers
 * Convenience wrapper that auto-starts for setTimeout replacement
 *
 * @param ms - Delay in milliseconds
 * @returns Promise that resolves after delay
 */
export function createActorDelay(ms: number): Promise<void> {
  const delayMachine = setup({
    types: {
      context: {} as { delay: number },
      events: {} as { type: 'START' }, // Use proper event type instead of never
    },
  }).createMachine({
    id: 'delay',
    initial: 'waiting',
    context: { delay: ms },
    states: {
      waiting: {
        // ✅ PURE XSTATE: Use 'after' transition - no setTimeout needed
        after: {
          [ms]: 'completed',
        },
      },
      completed: {
        type: 'final',
      },
    },
  });

  return new Promise<void>((resolve) => {
    const delayActor = createActor(delayMachine);

    delayActor.subscribe((state) => {
      if (state.matches('completed')) {
        // ✅ CRITICAL FIX: Stop the actor to prevent memory leak
        delayActor.stop();
        resolve();
      }
    });

    delayActor.start();
  });
}

// ============================================================================
// PURE XSTATE INTERVAL
// ============================================================================

/**
 * Pure XState interval using setup() - zero JavaScript timers
 * Replaces: setInterval(callback, ms)
 *
 * @param callback - Function to execute on each interval
 * @param ms - Interval in milliseconds
 * @returns Function to stop the interval
 */
export function createActorInterval(callback: () => void, ms: number): () => void {
  const intervalMachine = setup({
    types: {
      context: {} as { intervalMs: number },
      events: {} as { type: 'STOP' },
    },
    actions: {
      executeCallback: () => {
        try {
          callback();
        } catch (error) {
          log.error('Interval callback error', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
  }).createMachine({
    id: 'interval',
    initial: 'running',
    context: { intervalMs: ms },
    states: {
      running: {
        // ✅ PURE XSTATE: Use 'after' transition for intervals - no setInterval
        after: {
          [ms]: {
            target: 'running', // Loop back to running
            actions: 'executeCallback',
          },
        },
        on: {
          STOP: 'stopped',
        },
      },
      stopped: {
        type: 'final',
      },
    },
  });

  const intervalActor = createActor(intervalMachine);
  intervalActor.start();

  // Return stop function
  return () => {
    intervalActor.send({ type: 'STOP' });
    intervalActor.stop();
  };
}

// ============================================================================
// PURE XSTATE TIMEOUT MANAGER
// ============================================================================

/**
 * Simple XState-based timeout manager
 * Handles multiple concurrent timeouts using pure XState patterns
 */
export class PureXStateTimeoutManager {
  private timeouts = new Map<
    string,
    {
      actor: AnyActor;
      callback: () => void;
    }
  >();

  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: <it's being used in the setTimeout method>
  private _idCounter = 0;

  /**
   * Schedule a timeout using pure XState
   * @param callback - Function to call when timeout expires
   * @param delay - Delay in milliseconds
   * @returns Timeout ID for cancellation
   */
  setTimeout(callback: () => void, delay: number): string {
    const timeoutId = `timeout-${Date.now()}-${this._idCounter++}`;

    const timeoutMachine = setup({
      types: {
        context: {} as { delay: number; timeoutId: string },
        events: {} as { type: 'CANCEL' },
      },
    }).createMachine({
      id: 'timeout',
      initial: 'waiting',
      context: { delay, timeoutId },
      states: {
        waiting: {
          // ✅ PURE XSTATE: Use 'after' transition instead of setTimeout
          after: {
            [delay]: 'completed',
          },
          on: {
            CANCEL: 'cancelled',
          },
        },
        completed: {
          type: 'final',
        },
        cancelled: {
          type: 'final',
        },
      },
    });

    const timeoutActor = createActor(timeoutMachine);

    timeoutActor.subscribe((state) => {
      if (state.matches('completed')) {
        // Execute callback and cleanup
        callback();
        timeoutActor.stop(); // ✅ CRITICAL FIX: Stop the actor to prevent event loop leak
        this.timeouts.delete(timeoutId);
      } else if (state.matches('cancelled')) {
        // Just cleanup
        timeoutActor.stop(); // ✅ CRITICAL FIX: Stop the actor to prevent event loop leak
        this.timeouts.delete(timeoutId);
      }
    });

    // Store reference for cancellation
    this.timeouts.set(timeoutId, { actor: timeoutActor, callback });

    timeoutActor.start();

    return timeoutId;
  }

  /**
   * Cancel a scheduled timeout
   * @param timeoutId - ID returned by setTimeout
   */
  clearTimeout(timeoutId: string): void {
    const timeout = this.timeouts.get(timeoutId);
    if (timeout) {
      timeout.actor.send({ type: 'CANCEL' });
      timeout.actor.stop();
      this.timeouts.delete(timeoutId);
    }
  }

  /**
   * Clear all scheduled timeouts
   */
  clearAllTimeouts(): void {
    for (const [_timeoutId, timeout] of this.timeouts) {
      timeout.actor.send({ type: 'CANCEL' });
      timeout.actor.stop();
    }
    this.timeouts.clear();
  }

  /**
   * Get count of active timeouts
   */
  getActiveTimeoutCount(): number {
    return this.timeouts.size;
  }

  /**
   * Stop all timeouts and cleanup
   */
  destroy(): void {
    this.clearAllTimeouts();
  }
}

// ============================================================================
// CORRELATION MANAGER WITH PURE XSTATE
// ============================================================================

/**
 * Correlation manager using pure XState timeout management
 * Zero JavaScript timers - everything through XState
 */
export class PureXStateCorrelationManager {
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      createdAt: number;
      timeoutMs: number;
    }
  >();

  private timeoutManager = new PureXStateTimeoutManager();
  private requestCounter = 0;

  generateId(): string {
    this.requestCounter++;
    return `corr-${Date.now()}-${this.requestCounter}`;
  }

  async registerRequest<T>(correlationId: string, timeout: number): Promise<T> {
    // ✅ CORRECT: Check if correlation ID is already in use
    if (this.pendingRequests.has(correlationId)) {
      throw new Error(`Correlation ID already in use: ${correlationId}`);
    }

    return new Promise<T>((resolve, reject) => {
      // Store the pending request
      this.pendingRequests.set(correlationId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        createdAt: Date.now(),
        timeoutMs: timeout,
      });

      // ✅ PURE XSTATE: Use XState timeout manager instead of setTimeout
      this.timeoutManager.setTimeout(() => {
        this.handleTimeout(correlationId);
      }, timeout);

      log.debug('Request registered with pure XState timeout', {
        correlationId,
        timeout,
      });
    });
  }

  handleResponse(correlationId: string, response: unknown): void {
    log.debug('🔍 CORRELATION DEBUG: handleResponse called', {
      correlationId,
      hasPendingRequest: this.pendingRequests.has(correlationId),
      pendingRequestsCount: this.pendingRequests.size,
      allPendingIds: Array.from(this.pendingRequests.keys()),
    });

    const pendingRequest = this.pendingRequests.get(correlationId);
    if (!pendingRequest) {
      log.debug('🔍 CORRELATION DEBUG: No pending request found for correlationId:', correlationId);
      return;
    }

    // Remove from pending requests
    this.pendingRequests.delete(correlationId);

    log.debug('🔍 CORRELATION DEBUG: Resolving pending request for:', correlationId);

    // Resolve the promise
    pendingRequest.resolve(response);

    log.debug('Request completed successfully', { correlationId });
  }

  handleError(correlationId: string, error: Error): void {
    const pendingRequest = this.pendingRequests.get(correlationId);
    if (!pendingRequest) return;

    // Remove from pending requests
    this.pendingRequests.delete(correlationId);

    // Reject the promise with the error
    pendingRequest.reject(error);

    log.debug('Request failed with error', { correlationId, error: error.message });
  }

  handleTimeout(correlationId: string): void {
    const pendingRequest = this.pendingRequests.get(correlationId);
    if (!pendingRequest) return;

    // Remove from pending requests
    this.pendingRequests.delete(correlationId);

    // Create timeout error
    const duration = Date.now() - pendingRequest.createdAt;
    const error = new Error(
      `Request ${correlationId} timed out after ${duration}ms (configured: ${pendingRequest.timeoutMs}ms)`
    );

    // Reject the promise
    pendingRequest.reject(error);

    log.debug('Request timed out via pure XState', { correlationId, duration });
  }

  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  clearAllRequests(): void {
    // Cancel all XState timeouts
    this.timeoutManager.clearAllTimeouts();

    // Reject all pending requests
    for (const [correlationId, request] of this.pendingRequests) {
      request.reject(new Error(`Correlation manager cleared: ${correlationId}`));
    }

    this.pendingRequests.clear();
    log.debug('All requests cleared');
  }

  destroy(): void {
    this.clearAllRequests();
    this.timeoutManager.destroy();
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

// All exports are already declared inline above, no need for duplicate exports
