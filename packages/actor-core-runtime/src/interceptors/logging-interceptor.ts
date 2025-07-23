/**
 * @module actor-core/runtime/interceptors/logging-interceptor
 * @description High-performance logging interceptor with batching and sampling
 * @author Agent A - Actor-Core Framework
 * @since 2025-07-18
 */

import type { ActorMessage } from '../actor-system.js';
import { Logger } from '../logger.js';
import type {
  AfterProcessParams,
  BeforeReceiveParams,
  BeforeSendParams,
  MessageInterceptor,
  OnErrorParams,
} from '../messaging/interceptors.js';
// ✅ PURE ACTOR MODEL: Import XState-based interval function
import { createActorInterval } from '../pure-xstate-utilities.js';

const log = Logger.namespace('LOGGING_INTERCEPTOR');

/**
 * Log entry structure for buffered logging
 */
export interface LogEntry {
  timestamp: number;
  messageType: string;
  sender?: string;
  target?: string;
  size: number;
  phase: 'send' | 'receive' | 'process' | 'error';
  duration?: number;
  error?: string;
}

/**
 * Configuration options for the logging interceptor
 */
export interface LoggingOptions {
  /** Sample rate (0-1), 1 means log everything, 0.1 means log 10% */
  sampleRate?: number;
  /** Flush interval in milliseconds */
  flushInterval?: number;
  /** Maximum buffer size before forced flush */
  maxBufferSize?: number;
  /** Log level for messages */
  level?: 'debug' | 'info' | 'warn' | 'error';
  /** Whether to include message payload in logs */
  includePayload?: boolean;
  /** Custom logger instance */
  logger?: typeof log;
}

/**
 * Estimate the size of a message for logging purposes
 */
function estimateSize(message: ActorMessage): number {
  try {
    return JSON.stringify(message).length;
  } catch {
    return -1; // Unable to estimate
  }
}

/**
 * High-performance logging interceptor with batching and sampling
 *
 * Features:
 * - Minimal overhead with fire-and-forget logging
 * - Batched writes to reduce I/O
 * - Sampling support for high-throughput scenarios
 * - Structured logging format
 */
export class LoggingInterceptor implements MessageInterceptor {
  private buffer: LogEntry[] = [];
  // Change timer type to match XState interval return type
  private flushTimer: (() => void) | null = null;
  private messageTimings = new WeakMap<ActorMessage, number>();
  private logger: typeof log;

  constructor(private options: LoggingOptions = {}) {
    this.logger = options.logger || log;

    // ✅ PURE ACTOR MODEL: Start flush timer using XState interval instead of setInterval
    if (options.flushInterval && options.flushInterval > 0) {
      this.flushTimer = createActorInterval(() => this.flush(), options.flushInterval);
    }
  }

  async beforeSend({ message, sender }: BeforeSendParams): Promise<ActorMessage> {
    if (this.shouldSample()) {
      this.buffer.push({
        timestamp: Date.now(),
        messageType: message.type,
        sender: sender?.path,
        target: undefined, // Will be set in target actor
        size: estimateSize(message),
        phase: 'send',
      });

      this.checkBuffer();
    }
    return message;
  }

  async beforeReceive({ message, sender, context }: BeforeReceiveParams): Promise<ActorMessage> {
    if (this.shouldSample()) {
      // Track timing for afterProcess
      this.messageTimings.set(message, performance.now());

      this.buffer.push({
        timestamp: Date.now(),
        messageType: message.type,
        sender: sender?.path || message.sender?.path,
        target: context.metadata.get('actorPath') as string,
        size: estimateSize(message),
        phase: 'receive',
      });

      this.checkBuffer();
    }
    return message;
  }

  async afterProcess({ message, actor }: AfterProcessParams): Promise<void> {
    if (this.shouldSample()) {
      const startTime = this.messageTimings.get(message);
      const duration = startTime ? performance.now() - startTime : undefined;

      // Clean up timing
      this.messageTimings.delete(message);

      this.buffer.push({
        timestamp: Date.now(),
        messageType: message.type,
        sender: message.sender?.path,
        target: actor.path,
        size: estimateSize(message),
        phase: 'process',
        duration,
      });

      this.checkBuffer();
    }
  }

  async onError({ error, message, actor }: OnErrorParams): Promise<void> {
    // Always log errors (no sampling)
    this.buffer.push({
      timestamp: Date.now(),
      messageType: message.type,
      sender: message.sender?.path,
      target: actor.path,
      size: estimateSize(message),
      phase: 'error',
      error: error.message,
    });

    this.checkBuffer();
  }

  /**
   * Check if we should sample this message
   */
  private shouldSample(): boolean {
    const rate = this.options.sampleRate;
    return rate === undefined || rate === 1 || Math.random() < rate;
  }

  /**
   * Check buffer size and flush if needed
   */
  private checkBuffer(): void {
    const maxSize = this.options.maxBufferSize || 1000;
    if (this.buffer.length >= maxSize) {
      this.flush();
    }
  }

  /**
   * Flush buffered logs
   */
  flush(): void {
    if (this.buffer.length === 0) return;

    const entries = this.buffer.splice(0, this.buffer.length);
    const level = this.options.level || 'debug';

    // Log as a batch for efficiency
    this.logger[level]('Actor message activity', {
      count: entries.length,
      entries: this.options.includePayload
        ? entries
        : entries.map((e) => ({
            ...e,
            // Exclude potentially large payloads
            size: undefined,
          })),
    });
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.flushTimer) {
      // ✅ PURE ACTOR MODEL: Stop XState interval
      this.flushTimer(); // Call the stop function returned by createActorInterval
      this.flushTimer = null;
    }
    this.flush(); // Final flush
  }
}

/**
 * Create a pre-configured logging interceptor
 */
export function createLoggingInterceptor(options?: LoggingOptions): LoggingInterceptor {
  return new LoggingInterceptor(options);
}
