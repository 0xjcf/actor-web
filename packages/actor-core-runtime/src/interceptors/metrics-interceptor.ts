/**
 * @module actor-core/runtime/interceptors/metrics-interceptor
 * @description Minimal overhead metrics collection interceptor
 * @author Agent A - Actor-Core Framework
 * @since 2025-07-18
 */

import type { ActorMessage } from '../actor-system.js';
import type {
  AfterProcessParams,
  BeforeReceiveParams,
  BeforeSendParams,
  MessageInterceptor,
  OnErrorParams,
} from '../messaging/interceptors.js';
import { createActorInterval } from '../pure-xstate-utilities.js';

/**
 * Metrics data structure for an actor
 */
export interface ActorMetrics {
  /** Total messages sent */
  messagesSent: number;
  /** Total messages received */
  messagesReceived: number;
  /** Total messages processed successfully */
  messagesProcessed: number;
  /** Total errors */
  errors: number;
  /** Message processing times in milliseconds */
  processingTimes: number[];
  /** Average processing time */
  averageProcessingTime: number;
  /** Min processing time */
  minProcessingTime: number;
  /** Max processing time */
  maxProcessingTime: number;
  /** P95 processing time */
  p95ProcessingTime: number;
  /** P99 processing time */
  p99ProcessingTime: number;
  /** Queue depth samples */
  queueDepths: number[];
  /** Current queue depth */
  currentQueueDepth: number;
  /** Last update timestamp */
  lastUpdated: number;
}

/**
 * Configuration options for metrics interceptor
 */
export interface MetricsOptions {
  /** Maximum number of timing samples to keep */
  maxTimingSamples?: number;
  /** Maximum number of queue depth samples */
  maxQueueDepthSamples?: number;
  /** Export interval in milliseconds */
  exportInterval?: number;
  /** Export callback */
  onExport?: (metrics: Map<string, ActorMetrics>) => void;
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((sorted.length * p) / 100) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

/**
 * High-performance metrics interceptor with minimal overhead
 *
 * Features:
 * - WeakMap-based timing to prevent memory leaks
 * - Bounded sample storage
 * - Efficient percentile calculations
 * - Optional periodic export
 */
export class MetricsInterceptor implements MessageInterceptor {
  private metrics = new Map<string, ActorMetrics>();
  private messageTimings = new WeakMap<ActorMessage, { actor: string; startTime: number }>();
  private exportStopFn: (() => void) | null = null; // XState interval stop function
  private readonly maxTimingSamples: number;
  private readonly maxQueueDepthSamples: number;

  constructor(private options: MetricsOptions = {}) {
    this.maxTimingSamples = options.maxTimingSamples || 1000;
    this.maxQueueDepthSamples = options.maxQueueDepthSamples || 100;

    // Start export timer if configured using pure XState
    if (options.exportInterval && options.exportInterval > 0 && options.onExport) {
      // ✅ PURE ACTOR MODEL: Use XState interval instead of setInterval
      this.exportStopFn = createActorInterval(() => this.export(), options.exportInterval);
    }
  }

  async beforeSend({ message, sender }: BeforeSendParams): Promise<ActorMessage> {
    if (sender) {
      const metrics = this.getOrCreateMetrics(sender.path);
      metrics.messagesSent++;
      metrics.lastUpdated = Date.now();
    }
    return message;
  }

  async beforeReceive({ message, context }: BeforeReceiveParams): Promise<ActorMessage> {
    // Get actor path from context (set by ActorSystemImpl)
    const actorPath = context.metadata.get('actorPath') as string;
    if (actorPath) {
      const metrics = this.getOrCreateMetrics(actorPath);
      metrics.messagesReceived++;
      metrics.lastUpdated = Date.now();

      // Start timing for this message
      this.messageTimings.set(message, {
        actor: actorPath,
        startTime: performance.now(),
      });

      // Record queue depth if available
      const queueDepth = context.metadata.get('queueDepth') as number | undefined;
      if (queueDepth !== undefined) {
        metrics.currentQueueDepth = queueDepth;
        metrics.queueDepths.push(queueDepth);

        // Keep bounded samples
        if (metrics.queueDepths.length > this.maxQueueDepthSamples) {
          metrics.queueDepths.shift();
        }
      }
    }
    return message;
  }

  async afterProcess({ message, actor }: AfterProcessParams): Promise<void> {
    const timing = this.messageTimings.get(message);
    if (timing) {
      const duration = performance.now() - timing.startTime;
      const metrics = this.getOrCreateMetrics(actor.path);

      metrics.messagesProcessed++;
      metrics.processingTimes.push(duration);

      // Keep bounded samples
      if (metrics.processingTimes.length > this.maxTimingSamples) {
        metrics.processingTimes.shift();
      }

      // Update statistics
      this.updateTimingStats(metrics);
      metrics.lastUpdated = Date.now();

      // Clean up
      this.messageTimings.delete(message);
    }
  }

  async onError({ message, actor }: OnErrorParams): Promise<void> {
    const metrics = this.getOrCreateMetrics(actor.path);
    metrics.errors++;
    metrics.lastUpdated = Date.now();

    // Clean up timing if it exists
    this.messageTimings.delete(message);
  }

  /**
   * Get or create metrics for an actor
   */
  private getOrCreateMetrics(actorPath: string): ActorMetrics {
    let metrics = this.metrics.get(actorPath);
    if (!metrics) {
      metrics = {
        messagesSent: 0,
        messagesReceived: 0,
        messagesProcessed: 0,
        errors: 0,
        processingTimes: [],
        averageProcessingTime: 0,
        minProcessingTime: 0,
        maxProcessingTime: 0,
        p95ProcessingTime: 0,
        p99ProcessingTime: 0,
        queueDepths: [],
        currentQueueDepth: 0,
        lastUpdated: Date.now(),
      };
      this.metrics.set(actorPath, metrics);
    }
    return metrics;
  }

  /**
   * Update timing statistics
   */
  private updateTimingStats(metrics: ActorMetrics): void {
    if (metrics.processingTimes.length === 0) return;

    // Calculate average
    const sum = metrics.processingTimes.reduce((a, b) => a + b, 0);
    metrics.averageProcessingTime = sum / metrics.processingTimes.length;

    // Sort for percentiles (create a copy to avoid mutating original)
    const sorted = [...metrics.processingTimes].sort((a, b) => a - b);

    metrics.minProcessingTime = sorted[0];
    metrics.maxProcessingTime = sorted[sorted.length - 1];
    metrics.p95ProcessingTime = percentile(sorted, 95);
    metrics.p99ProcessingTime = percentile(sorted, 99);
  }

  /**
   * Export metrics via callback
   */
  export(): void {
    if (this.options.onExport) {
      // Create a copy to avoid external mutations
      const copy = new Map<string, ActorMetrics>();
      for (const [path, metrics] of this.metrics) {
        copy.set(path, { ...metrics });
      }
      this.options.onExport(copy);
    }
  }

  /**
   * Get current metrics snapshot
   */
  getMetrics(): Map<string, ActorMetrics> {
    const copy = new Map<string, ActorMetrics>();
    for (const [path, metrics] of this.metrics) {
      copy.set(path, { ...metrics });
    }
    return copy;
  }

  /**
   * Reset metrics for an actor
   */
  resetMetrics(actorPath: string): void {
    this.metrics.delete(actorPath);
  }

  /**
   * Reset all metrics
   */
  resetAllMetrics(): void {
    this.metrics.clear();
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    // Stop export timer
    if (this.exportStopFn) {
      this.exportStopFn();
      this.exportStopFn = null;
    }
    this.export(); // Final export
    this.metrics.clear();
    this.messageTimings = new WeakMap();
  }
}

/**
 * Create a pre-configured metrics interceptor
 */
export function createMetricsInterceptor(options?: MetricsOptions): MetricsInterceptor {
  return new MetricsInterceptor(options);
}
