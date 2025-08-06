/**
 * @module actor-core/runtime/messaging/mailbox
 * @description Mailbox implementation for async actor message queueing
 * @author Agent A - 2025-07-18
 */

import type { ActorMessage } from '../actor-system.js';

/**
 * Overflow strategies for when mailbox reaches capacity
 */
export enum OverflowStrategy {
  /** Drop new messages when mailbox is full */
  DROP = 'drop',
  /** Block/park the sender until space is available */
  PARK = 'park',
  /** Throw an error when mailbox is full */
  FAIL = 'fail',
}

/**
 * Message envelope for internal mailbox handling
 */
export interface MessageEnvelope {
  readonly id: string;
  readonly message: ActorMessage;
  readonly enqueueTime: number;
}

/**
 * Statistics about mailbox performance
 */
export interface MailboxStatistics {
  readonly size: number;
  readonly capacity: number;
  readonly totalEnqueued: number;
  readonly totalDequeued: number;
  readonly totalDropped: number;
  readonly totalFailed: number;
  readonly utilizationRatio: number;
}

/**
 * Configuration for BoundedMailbox
 */
export interface MailboxConfig {
  readonly capacity: number;
  readonly overflowStrategy: OverflowStrategy;
  readonly enableMetrics: boolean;
}

/**
 * Error thrown when mailbox operations fail
 */
export class MailboxError extends Error {
  constructor(
    message: string,
    public readonly strategy: OverflowStrategy
  ) {
    super(message);
    this.name = 'MailboxError';
  }
}

/**
 * BoundedMailbox implementation with configurable overflow strategies
 * Implements the Mailbox interface from types.ts
 */
export class BoundedMailbox {
  private queue: MessageEnvelope[] = [];
  private parkedSenders: Array<{
    resolve: (success: boolean) => void;
    reject: (error: Error) => void;
    message: ActorMessage;
  }> = [];
  private stopped = false;

  // Metrics
  private totalEnqueued = 0;
  private totalDequeued = 0;
  private totalDropped = 0;
  private totalFailed = 0;

  constructor(public readonly config: MailboxConfig) {
    if (config.capacity <= 0) {
      throw new Error('Mailbox capacity must be greater than 0');
    }
  }

  /**
   * Create a BoundedMailbox with default configuration
   */
  static create(overrides: Partial<MailboxConfig> = {}): BoundedMailbox {
    const defaultConfig: MailboxConfig = {
      capacity: 1000,
      overflowStrategy: OverflowStrategy.DROP,
      enableMetrics: true,
    };

    return new BoundedMailbox({ ...defaultConfig, ...overrides });
  }

  get statistics(): MailboxStatistics {
    return {
      size: this.queue.length,
      capacity: this.config.capacity,
      totalEnqueued: this.totalEnqueued,
      totalDequeued: this.totalDequeued,
      totalDropped: this.totalDropped,
      totalFailed: this.totalFailed,
      utilizationRatio: this.queue.length / this.config.capacity,
    };
  }

  /**
   * Enqueue a message, returns true if successful, false if dropped
   * For PARK strategy, returns a promise that resolves when enqueued
   */
  enqueue(message: ActorMessage): boolean | Promise<boolean> {
    if (this.stopped) {
      throw new MailboxError('Cannot enqueue to stopped mailbox', this.config.overflowStrategy);
    }

    // Check if we have space
    if (this.queue.length < this.config.capacity) {
      this.doEnqueue(message);
      return true;
    }

    // Handle overflow based on strategy
    switch (this.config.overflowStrategy) {
      case OverflowStrategy.DROP:
        this.totalDropped++;
        return false;

      case OverflowStrategy.FAIL:
        this.totalFailed++;
        throw new MailboxError(
          `Mailbox capacity exceeded (${this.config.capacity}). Message dropped.`,
          OverflowStrategy.FAIL
        );

      case OverflowStrategy.PARK:
        return this.parkSender(message);

      default:
        throw new Error(`Unknown overflow strategy: ${this.config.overflowStrategy}`);
    }
  }

  /**
   * Dequeue the next message
   */
  dequeue(): ActorMessage | undefined {
    if (this.stopped) {
      return undefined;
    }

    const envelope = this.queue.shift();
    if (envelope) {
      this.totalDequeued++;

      // Try to unpark a sender if we have space
      this.tryUnparkSender();

      return envelope.message;
    }

    return undefined;
  }

  /**
   * Get current mailbox size
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Clear all messages
   */
  clear(): void {
    this.queue.length = 0;
    // Reject all parked senders
    this.rejectAllParkedSenders('Mailbox cleared');
  }

  /**
   * Check if mailbox is full
   */
  isFull(): boolean {
    return this.queue.length >= this.config.capacity;
  }

  /**
   * Check if mailbox is empty
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Stop the mailbox and release resources
   */
  stop(): void {
    this.stopped = true;
    this.clear();
    this.rejectAllParkedSenders('Mailbox stopped');
  }

  private doEnqueue(message: ActorMessage): void {
    const envelope: MessageEnvelope = {
      id: this.generateMessageId(),
      message,
      enqueueTime: Date.now(),
    };

    this.queue.push(envelope);
    this.totalEnqueued++;
  }

  private parkSender(message: ActorMessage): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.parkedSenders.push({
        resolve,
        reject,
        message,
      });
    });
  }

  private tryUnparkSender(): void {
    if (this.parkedSenders.length > 0 && !this.isFull()) {
      const parkedSender = this.parkedSenders.shift();
      if (parkedSender) {
        try {
          this.doEnqueue(parkedSender.message);
          parkedSender.resolve(true);
        } catch (error) {
          parkedSender.reject(error as Error);
        }
      }
    }
  }

  private rejectAllParkedSenders(reason: string): void {
    while (this.parkedSenders.length > 0) {
      const parkedSender = this.parkedSenders.shift();
      if (parkedSender) {
        parkedSender.reject(new MailboxError(reason, OverflowStrategy.PARK));
      }
    }
  }

  private generateMessageId(): string {
    return `msg-${Date.now()}`;
  }
}

/**
 * Factory functions for creating mailboxes with common configurations
 */
export const createMailbox = {
  /**
   * Create a mailbox that drops messages when full
   */
  dropping(capacity = 1000): BoundedMailbox {
    return BoundedMailbox.create({
      capacity,
      overflowStrategy: OverflowStrategy.DROP,
      enableMetrics: true,
    });
  },

  /**
   * Create a mailbox that parks senders when full
   */
  parking(capacity = 1000): BoundedMailbox {
    return BoundedMailbox.create({
      capacity,
      overflowStrategy: OverflowStrategy.PARK,
      enableMetrics: true,
    });
  },

  /**
   * Create a mailbox that fails when full
   */
  failing(capacity = 1000): BoundedMailbox {
    return BoundedMailbox.create({
      capacity,
      overflowStrategy: OverflowStrategy.FAIL,
      enableMetrics: true,
    });
  },
};
