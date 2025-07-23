/**
 * @module actor-core/runtime/messaging/dead-letter-queue
 * @description Dead letter queue for undeliverable messages
 * @author Actor-Web Framework Team
 */

import type { ActorMessage } from '../actor-system.js';
import { Logger } from '../logger.js';
import { createActorInterval } from '../pure-xstate-utilities.js';

/**
 * Dead letter - represents a message that couldn't be delivered
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
  private deadLetters: DeadLetter[] = [];
  private cleanupStopFn: (() => void) | null = null; // XState interval stop function
  private readonly maxSize: number;
  private readonly retentionPeriod: number;
  private readonly logger = Logger.namespace('DEAD_LETTER_QUEUE');
  private readonly config: Required<DeadLetterQueueConfig>;

  constructor(config: DeadLetterQueueConfig = {}) {
    this.maxSize = config.maxSize ?? 1000;
    this.retentionPeriod = config.ttl ?? 24 * 60 * 60 * 1000; // 24 hours
    this.config = {
      maxSize: config.maxSize ?? 1000,
      ttl: config.ttl ?? 24 * 60 * 60 * 1000, // 24 hours
      onDeadLetter: config.onDeadLetter ?? (() => {}),
      persistent: config.persistent ?? false,
    };

    // Start cleanup interval
    if (this.retentionPeriod > 0) {
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
    this.deadLetters.push(deadLetter);

    // Enforce max size
    if (this.deadLetters.length > this.maxSize) {
      const removed = this.deadLetters.shift();
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
    return [...this.deadLetters];
  }

  /**
   * Get dead letters for a specific actor
   */
  getByActor(actorId: string): ReadonlyArray<DeadLetter> {
    return this.deadLetters.filter((letter) => letter.targetActorId === actorId);
  }

  /**
   * Get dead letters by message type
   */
  getByMessageType(type: string): ReadonlyArray<DeadLetter> {
    return this.deadLetters.filter((letter) => letter.message.type === type);
  }

  /**
   * Remove a dead letter
   */
  remove(index: number): DeadLetter | undefined {
    const [removed] = this.deadLetters.splice(index, 1);
    return removed;
  }

  /**
   * Clear all dead letters
   */
  clear(): void {
    const count = this.deadLetters.length;
    this.deadLetters = [];
    this.logger.info('Dead letter queue cleared', { count });
  }

  /**
   * Get queue size
   */
  size(): number {
    return this.deadLetters.length;
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
    if (this.deadLetters.length === 0) {
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

    for (const letter of this.deadLetters) {
      // Count message types
      messageTypes[letter.message.type] = (messageTypes[letter.message.type] || 0) + 1;

      // Count actors
      actors[letter.targetActorId] = (actors[letter.targetActorId] || 0) + 1;
    }

    return {
      size: this.deadLetters.length,
      oldestTimestamp: this.deadLetters[0].timestamp,
      newestTimestamp: this.deadLetters[this.deadLetters.length - 1].timestamp,
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
    const letter = this.deadLetters[index];
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
   * Start cleanup interval using pure XState
   */
  private startCleanup(): void {
    // ✅ PURE ACTOR MODEL: Use XState interval instead of setInterval
    this.cleanupStopFn = createActorInterval(() => {
      this.cleanup();
    }, 60 * 1000); // Run cleanup every minute
  }

  /**
   * Stop cleanup interval
   */
  private stopCleanup(): void {
    if (this.cleanupStopFn) {
      this.cleanupStopFn();
      this.cleanupStopFn = null;
    }
  }

  /**
   * Clean up expired dead letters
   */
  private cleanup(): void {
    const now = Date.now();
    const before = this.deadLetters.length;

    this.deadLetters = this.deadLetters.filter((letter) => {
      const age = now - letter.timestamp;
      return age < this.retentionPeriod;
    });

    const removed = before - this.deadLetters.length;
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
    this.stopCleanup();
  }
}
