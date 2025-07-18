/**
 * @module actor-core/runtime/messaging/dead-letter-queue
 * @description Dead letter queue for undeliverable messages
 * @author Actor-Web Framework Team
 */

import type { ActorMessage } from '../actor-system.js';
import { Logger } from '../logger.js';

/**
 * Dead letter entry with metadata
 */
export interface DeadLetter {
  /**
   * The undeliverable message
   */
  message: ActorMessage;

  /**
   * Target actor that couldn't receive the message
   */
  targetActorId: string;

  /**
   * Reason for failure
   */
  reason: string;

  /**
   * When the message was marked as undeliverable
   */
  timestamp: number;

  /**
   * Number of delivery attempts
   */
  attempts: number;

  /**
   * Original error if any
   */
  error?: Error;
}

/**
 * Dead letter queue configuration
 */
export interface DeadLetterQueueConfig {
  /**
   * Maximum number of dead letters to store
   */
  maxSize?: number;

  /**
   * Time to live for dead letters (ms)
   */
  ttl?: number;

  /**
   * Handler for dead letters
   */
  onDeadLetter?: (letter: DeadLetter) => void;

  /**
   * Enable persistence
   */
  persistent?: boolean;
}

/**
 * Dead letter queue implementation
 */
export class DeadLetterQueue {
  private queue: DeadLetter[] = [];
  private readonly logger = Logger.namespace('DEAD_LETTER_QUEUE');
  private readonly config: Required<DeadLetterQueueConfig>;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config: DeadLetterQueueConfig = {}) {
    this.config = {
      maxSize: config.maxSize ?? 1000,
      ttl: config.ttl ?? 24 * 60 * 60 * 1000, // 24 hours
      onDeadLetter: config.onDeadLetter ?? (() => {}),
      persistent: config.persistent ?? false,
    };

    // Start cleanup interval
    if (this.config.ttl > 0) {
      this.startCleanup();
    }
  }

  /**
   * Add a message to the dead letter queue
   */
  add(
    message: ActorMessage,
    targetActorId: string,
    reason: string,
    attempts = 1,
    error?: Error
  ): void {
    const deadLetter: DeadLetter = {
      message,
      targetActorId,
      reason,
      timestamp: Date.now(),
      attempts,
      error,
    };

    // Log the dead letter
    this.logger.warn('Dead letter added', {
      messageType: message.type,
      targetActorId,
      reason,
      attempts,
    });

    // Add to queue
    this.queue.push(deadLetter);

    // Enforce max size
    if (this.queue.length > this.config.maxSize) {
      const removed = this.queue.shift();
      this.logger.debug('Dead letter evicted due to size limit', {
        messageType: removed?.message.type,
      });
    }

    // Call handler
    this.config.onDeadLetter(deadLetter);

    // Persist if enabled
    if (this.config.persistent) {
      this.persist(deadLetter);
    }
  }

  /**
   * Get all dead letters
   */
  getAll(): ReadonlyArray<DeadLetter> {
    return [...this.queue];
  }

  /**
   * Get dead letters for a specific actor
   */
  getByActor(actorId: string): ReadonlyArray<DeadLetter> {
    return this.queue.filter((letter) => letter.targetActorId === actorId);
  }

  /**
   * Get dead letters by message type
   */
  getByMessageType(type: string): ReadonlyArray<DeadLetter> {
    return this.queue.filter((letter) => letter.message.type === type);
  }

  /**
   * Remove a dead letter
   */
  remove(index: number): DeadLetter | undefined {
    const [removed] = this.queue.splice(index, 1);
    return removed;
  }

  /**
   * Clear all dead letters
   */
  clear(): void {
    const count = this.queue.length;
    this.queue = [];
    this.logger.info('Dead letter queue cleared', { count });
  }

  /**
   * Get queue size
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    size: number;
    oldestTimestamp: number | null;
    newestTimestamp: number | null;
    messageTypes: Record<string, number>;
    actors: Record<string, number>;
  } {
    if (this.queue.length === 0) {
      return {
        size: 0,
        oldestTimestamp: null,
        newestTimestamp: null,
        messageTypes: {},
        actors: {},
      };
    }

    const messageTypes: Record<string, number> = {};
    const actors: Record<string, number> = {};

    for (const letter of this.queue) {
      // Count message types
      messageTypes[letter.message.type] = (messageTypes[letter.message.type] || 0) + 1;

      // Count actors
      actors[letter.targetActorId] = (actors[letter.targetActorId] || 0) + 1;
    }

    return {
      size: this.queue.length,
      oldestTimestamp: this.queue[0].timestamp,
      newestTimestamp: this.queue[this.queue.length - 1].timestamp,
      messageTypes,
      actors,
    };
  }

  /**
   * Retry a dead letter
   */
  async retry(
    index: number,
    retryFn: (message: ActorMessage, actorId: string) => Promise<void>
  ): Promise<boolean> {
    const letter = this.queue[index];
    if (!letter) {
      return false;
    }

    try {
      await retryFn(letter.message, letter.targetActorId);

      // Remove from queue on success
      this.remove(index);
      this.logger.info('Dead letter retry successful', {
        messageType: letter.message.type,
        targetActorId: letter.targetActorId,
      });

      return true;
    } catch (error) {
      // Update attempts
      letter.attempts++;
      letter.timestamp = Date.now();
      letter.error = error as Error;

      this.logger.warn('Dead letter retry failed', {
        messageType: letter.message.type,
        targetActorId: letter.targetActorId,
        attempts: letter.attempts,
        error: (error as Error).message,
      });

      return false;
    }
  }

  /**
   * Start cleanup interval
   */
  private startCleanup(): void {
    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 1000);
  }

  /**
   * Clean up expired dead letters
   */
  private cleanup(): void {
    const now = Date.now();
    const before = this.queue.length;

    this.queue = this.queue.filter((letter) => {
      const age = now - letter.timestamp;
      return age < this.config.ttl;
    });

    const removed = before - this.queue.length;
    if (removed > 0) {
      this.logger.debug('Dead letters expired', { count: removed });
    }
  }

  /**
   * Persist dead letter (stub for future implementation)
   */
  private persist(letter: DeadLetter): void {
    // TODO: Implement persistence to file/database
    this.logger.debug('Dead letter persistence not yet implemented', {
      messageType: letter.message.type,
    });
  }

  /**
   * Stop the dead letter queue
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }
}
