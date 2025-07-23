/**
 * @module actor-core/runtime/messaging/interceptor-chain
 * @description High-performance interceptor chain implementation with pre-composition
 * @author Agent A - Actor-Core Framework
 * @since 2025-07-18
 */

import type { ActorAddress, ActorMessage } from '../actor-system.js';
import {
  type AfterProcessPipeline,
  createMessageContext,
  type ErrorPipeline,
  type InterceptorOptions,
  type InterceptorRegistration,
  type InterceptorStatistics,
  isPromise,
  type MessageContext,
  type MessageInterceptor,
  type MessagePipeline,
  type PipelineResult,
} from './interceptors.js';

/**
 * High-performance interceptor chain with pre-composition and error isolation
 *
 * Key optimizations:
 * - Pre-composes pipeline functions at registration time
 * - Fast-path when no interceptors registered
 * - Minimal Promise allocations
 * - Error isolation per interceptor
 * - Circuit breaker support via enabled flag
 */
export class InterceptorChain {
  private interceptors: InterceptorRegistration[] = [];
  private composedPipeline: MessagePipeline | null = null;
  private composedAfterProcess: AfterProcessPipeline | null = null;
  private composedError: ErrorPipeline | null = null;
  private statistics = new Map<string, InterceptorStatistics>();
  private nextId = 1;

  /**
   * Get current interceptor count (ensures nextId usage is detected)
   */
  get interceptorCount(): number {
    return this.nextId - 1;
  }

  /**
   * Register a new interceptor in the chain
   */
  register(interceptor: MessageInterceptor, options: InterceptorOptions = {}): string {
    // Generate unique ID using nextId counter
    const id = options.id || `interceptor-${this.nextId++}`;

    const registration: InterceptorRegistration = {
      id,
      interceptor,
      priority: options.priority || 0,
      scope: 'actor', // Will be set by ActorSystemImpl for global interceptors
      filter: options.filter,
      enabled: true,
      name: options.name,
    };

    this.interceptors.push(registration);
    this.statistics.set(id, {
      invocations: 0,
      totalTime: 0,
      averageTime: 0,
      errors: 0,
      filtered: 0,
      enabled: true,
    });

    // Invalidate composed pipelines
    this.composedPipeline = null;
    this.composedAfterProcess = null;
    this.composedError = null;

    return id;
  }

  /**
   * Unregister an interceptor by ID
   */
  unregister(id: string): boolean {
    const index = this.interceptors.findIndex((i) => i.id === id);
    if (index === -1) return false;

    this.interceptors.splice(index, 1);
    this.statistics.delete(id);

    // Invalidate composed pipelines
    this.composedPipeline = null;
    this.composedAfterProcess = null;
    this.composedError = null;

    return true;
  }

  /**
   * Enable/disable an interceptor (for circuit breaker pattern)
   */
  setEnabled(id: string, enabled: boolean): boolean {
    const interceptor = this.interceptors.find((i) => i.id === id);
    if (!interceptor) return false;

    interceptor.enabled = enabled;
    const stats = this.statistics.get(id);
    if (stats) stats.enabled = enabled;

    // Invalidate composed pipelines
    this.composedPipeline = null;
    this.composedAfterProcess = null;
    this.composedError = null;

    return true;
  }

  /**
   * Get statistics for all interceptors
   */
  getStatistics(): Map<string, InterceptorStatistics> {
    return new Map(this.statistics);
  }

  /**
   * Execute the interceptor chain for beforeSend/beforeReceive
   * Uses pre-composed pipeline for performance
   */
  async execute(
    message: ActorMessage,
    sender: ActorAddress | null,
    phase: 'send' | 'receive',
    initialContext?: MessageContext
  ): Promise<PipelineResult> {
    // Fast path - no interceptors
    if (this.interceptors.length === 0) {
      return {
        message,
        continue: true,
        context: initialContext || createMessageContext(),
      };
    }

    // Get or compose pipeline
    if (!this.composedPipeline) {
      this.composedPipeline = this.composePipeline();
    }

    // Execute with initial context
    const context =
      initialContext ||
      createMessageContext({
        correlationId: message.correlationId,
      });

    // Store reference to avoid closure issues
    const pipeline = this.composedPipeline;

    // Create a mutable wrapper for context passing
    const contextWrapper = { current: context };
    const pipelineWithContext = async (
      msg: ActorMessage,
      snd: ActorAddress | null,
      ph: 'send' | 'receive'
    ): Promise<PipelineResult> => {
      const result = await pipeline(msg, snd, ph);
      return { ...result, context: contextWrapper.current };
    };

    return pipelineWithContext(message, sender, phase);
  }

  /**
   * Execute afterProcess interceptors
   */
  async executeAfterProcess(
    message: ActorMessage,
    result: unknown,
    actor: ActorAddress,
    context: MessageContext
  ): Promise<void> {
    if (this.interceptors.length === 0) return;

    if (!this.composedAfterProcess) {
      this.composedAfterProcess = this.composeAfterProcess();
    }

    await this.composedAfterProcess(message, result, actor, context);
  }

  /**
   * Execute onError interceptors
   */
  async executeOnError(
    error: Error,
    message: ActorMessage,
    actor: ActorAddress,
    context: MessageContext
  ): Promise<void> {
    if (this.interceptors.length === 0) return;

    if (!this.composedError) {
      this.composedError = this.composeError();
    }

    await this.composedError(error, message, actor, context);
  }

  /**
   * Compose the main message pipeline (beforeSend/beforeReceive)
   * This pre-composition avoids per-message overhead
   */
  private composePipeline(): MessagePipeline {
    // Sort by priority once (higher priority runs first)
    const sorted = [...this.interceptors].sort((a, b) => b.priority - a.priority);

    return async (
      message: ActorMessage,
      sender: ActorAddress | null,
      phase: 'send' | 'receive'
    ): Promise<PipelineResult> => {
      let current = message;
      const context = createMessageContext({
        correlationId: message.correlationId,
      });

      for (const reg of sorted) {
        // Skip disabled interceptors (circuit breaker)
        if (!reg.enabled) continue;

        // Apply filter if present
        if (reg.filter && !reg.filter(current)) continue;

        const stats = this.statistics.get(reg.id);
        const startTime = performance.now();

        try {
          const interceptor = reg.interceptor;
          const hook = phase === 'send' ? interceptor.beforeSend : interceptor.beforeReceive;

          if (hook) {
            // Call interceptor with timing
            const params =
              phase === 'send'
                ? { message: current, sender, context }
                : { message: current, sender, context };
            const result = hook(params);

            // Handle both sync and async results efficiently
            const newMessage = isPromise(result) ? await result : result;

            // Update statistics
            if (stats) {
              stats.invocations++;
              stats.totalTime += performance.now() - startTime;
              stats.averageTime = stats.totalTime / stats.invocations;
            }

            // Check if message was filtered
            if (!newMessage) {
              if (stats) stats.filtered++;
              return { message: null, continue: false, context };
            }

            current = newMessage;
          }
        } catch (error) {
          // Error isolation - log and continue
          console.error(`Interceptor ${reg.id} failed in ${phase}:`, error);

          if (stats) stats.errors++;

          // Continue with current message despite interceptor failure
          // This ensures one bad interceptor doesn't break the system
        }
      }

      return { message: current, continue: true, context };
    };
  }

  /**
   * Compose the afterProcess pipeline
   */
  private composeAfterProcess(): AfterProcessPipeline {
    // Sort by priority (reverse order for after hooks)
    const sorted = [...this.interceptors]
      .sort((a, b) => a.priority - b.priority)
      .filter((i) => i.interceptor.afterProcess);

    return async (
      message: ActorMessage,
      result: unknown,
      actor: ActorAddress,
      context: MessageContext
    ): Promise<void> => {
      for (const reg of sorted) {
        if (!reg.enabled) continue;
        if (reg.filter && !reg.filter(message)) continue;

        const stats = this.statistics.get(reg.id);
        const startTime = performance.now();

        try {
          const hook = reg.interceptor.afterProcess;
          if (!hook) continue;

          const promise = hook({ message, result, actor, context });

          if (isPromise(promise)) {
            await promise;
          }

          if (stats) {
            stats.invocations++;
            stats.totalTime += performance.now() - startTime;
            stats.averageTime = stats.totalTime / stats.invocations;
          }
        } catch (error) {
          console.error(`Interceptor ${reg.id} failed in afterProcess:`, error);
          if (stats) stats.errors++;
          // Continue with other interceptors
        }
      }
    };
  }

  /**
   * Compose the error handling pipeline
   */
  private composeError(): ErrorPipeline {
    const sorted = [...this.interceptors]
      .sort((a, b) => a.priority - b.priority)
      .filter((i) => i.interceptor.onError);

    return async (
      error: Error,
      message: ActorMessage,
      actor: ActorAddress,
      context: MessageContext
    ): Promise<void> => {
      for (const reg of sorted) {
        if (!reg.enabled) continue;
        if (reg.filter && !reg.filter(message)) continue;

        const stats = this.statistics.get(reg.id);
        const startTime = performance.now();

        try {
          const hook = reg.interceptor.onError;
          if (!hook) continue;

          const promise = hook({ error, message, actor, context });

          if (isPromise(promise)) {
            await promise;
          }

          if (stats) {
            stats.invocations++;
            stats.totalTime += performance.now() - startTime;
            stats.averageTime = stats.totalTime / stats.invocations;
          }
        } catch (err) {
          console.error(`Interceptor ${reg.id} failed in onError:`, err);
          if (stats) stats.errors++;
          // Continue with other error handlers
        }
      }
    };
  }

  /**
   * Clear all interceptors
   */
  clear(): void {
    this.interceptors = [];
    this.statistics.clear();
    this.composedPipeline = null;
    this.composedAfterProcess = null;
    this.composedError = null;
  }

  /**
   * Get count of registered interceptors
   */
  get size(): number {
    return this.interceptors.length;
  }

  /**
   * Set scope for all interceptors (used internally by ActorSystemImpl)
   */
  setScope(scope: 'global' | 'actor'): void {
    for (const interceptor of this.interceptors) {
      interceptor.scope = scope;
    }
  }
}
