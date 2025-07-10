/**
 * @module framework/core/messaging/mailbox
 * @description BoundedMailbox implementation with backpressure handling
 * @author Agent B - 2024-01-15
 */

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
export interface MessageEnvelope<T = unknown> {
  readonly id: string;
  readonly message: T;
  readonly timestamp: number;
  readonly senderId?: string;
  readonly correlationId?: string;
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
  readonly maxSize: number;
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
 * Interface for mailbox implementations
 */
export interface Mailbox<T = unknown> {
  readonly config: MailboxConfig;
  readonly statistics: MailboxStatistics;

  /**
   * Enqueue a message, returns true if successful
   */
  enqueue(message: T, senderId?: string, correlationId?: string): boolean | Promise<boolean>;

  /**
   * Dequeue the next message, returns undefined if empty
   */
  dequeue(): MessageEnvelope<T> | undefined;

  /**
   * Peek at the next message without removing it
   */
  peek(): MessageEnvelope<T> | undefined;

  /**
   * Check if mailbox is empty
   */
  isEmpty(): boolean;

  /**
   * Check if mailbox is full
   */
  isFull(): boolean;

  /**
   * Clear all messages
   */
  clear(): void;

  /**
   * Get current mailbox size
   */
  size(): number;

  /**
   * Stop the mailbox and release resources
   */
  stop(): void;
}

/**
 * BoundedMailbox implementation with configurable overflow strategies
 */
export class BoundedMailbox<T = unknown> implements Mailbox<T> {
  private queue: MessageEnvelope<T>[] = [];
  private messageIdCounter = 0;
  private parkedSenders: Array<{
    resolve: (success: boolean) => void;
    reject: (error: Error) => void;
    message: T;
    senderId?: string;
    correlationId?: string;
  }> = [];
  private stopped = false;

  // Metrics
  private totalEnqueued = 0;
  private totalDequeued = 0;
  private totalDropped = 0;
  private totalFailed = 0;

  constructor(public readonly config: MailboxConfig) {
    // Validate configuration
    if (config.maxSize <= 0) {
      throw new Error('Mailbox maxSize must be greater than 0');
    }
  }

  /**
   * Create a BoundedMailbox with default configuration
   */
  static create<T = unknown>(overrides: Partial<MailboxConfig> = {}): BoundedMailbox<T> {
    const defaultConfig: MailboxConfig = {
      maxSize: 1000,
      overflowStrategy: OverflowStrategy.DROP,
      enableMetrics: true,
    };

    return new BoundedMailbox<T>({ ...defaultConfig, ...overrides });
  }

  get statistics(): MailboxStatistics {
    return {
      size: this.queue.length,
      capacity: this.config.maxSize,
      totalEnqueued: this.totalEnqueued,
      totalDequeued: this.totalDequeued,
      totalDropped: this.totalDropped,
      totalFailed: this.totalFailed,
      utilizationRatio: this.queue.length / this.config.maxSize,
    };
  }

  enqueue(message: T, senderId?: string, correlationId?: string): boolean | Promise<boolean> {
    if (this.stopped) {
      throw new MailboxError('Cannot enqueue to stopped mailbox', this.config.overflowStrategy);
    }

    // Check if we have space
    if (this.queue.length < this.config.maxSize) {
      this.doEnqueue(message, senderId, correlationId);
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
          `Mailbox capacity exceeded (${this.config.maxSize}). Message dropped.`,
          OverflowStrategy.FAIL
        );

      case OverflowStrategy.PARK:
        return this.parkSender(message, senderId, correlationId);

      default:
        throw new Error(`Unknown overflow strategy: ${this.config.overflowStrategy}`);
    }
  }

  dequeue(): MessageEnvelope<T> | undefined {
    if (this.stopped) {
      return undefined;
    }

    const envelope = this.queue.shift();
    if (envelope) {
      this.totalDequeued++;

      // Try to unpark a sender if we have space
      this.tryUnparkSender();
    }

    return envelope;
  }

  peek(): MessageEnvelope<T> | undefined {
    return this.queue[0];
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  isFull(): boolean {
    return this.queue.length >= this.config.maxSize;
  }

  clear(): void {
    this.queue.length = 0;
    // Reject all parked senders
    this.rejectAllParkedSenders('Mailbox cleared');
  }

  size(): number {
    return this.queue.length;
  }

  stop(): void {
    this.stopped = true;
    this.clear();
    this.rejectAllParkedSenders('Mailbox stopped');
  }

  private doEnqueue(message: T, senderId?: string, correlationId?: string): void {
    const envelope: MessageEnvelope<T> = {
      id: this.generateMessageId(),
      message,
      timestamp: Date.now(),
      senderId,
      correlationId,
    };

    this.queue.push(envelope);
    this.totalEnqueued++;
  }

  private parkSender(message: T, senderId?: string, correlationId?: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.parkedSenders.push({
        resolve,
        reject,
        message,
        senderId,
        correlationId,
      });
    });
  }

  private tryUnparkSender(): void {
    if (this.parkedSenders.length > 0 && !this.isFull()) {
      const parkedSender = this.parkedSenders.shift();
      if (parkedSender) {
        try {
          this.doEnqueue(parkedSender.message, parkedSender.senderId, parkedSender.correlationId);
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
    return `msg-${++this.messageIdCounter}-${Date.now()}`;
  }
}

/**
 * Factory function for creating mailboxes with common configurations
 */
export const createMailbox = {
  /**
   * Create a mailbox that drops messages when full
   */
  dropping<T = unknown>(maxSize = 1000): BoundedMailbox<T> {
    return BoundedMailbox.create<T>({
      maxSize,
      overflowStrategy: OverflowStrategy.DROP,
      enableMetrics: true,
    });
  },

  /**
   * Create a mailbox that parks senders when full
   */
  parking<T = unknown>(maxSize = 1000): BoundedMailbox<T> {
    return BoundedMailbox.create<T>({
      maxSize,
      overflowStrategy: OverflowStrategy.PARK,
      enableMetrics: true,
    });
  },

  /**
   * Create a mailbox that fails when full
   */
  failing<T = unknown>(maxSize = 1000): BoundedMailbox<T> {
    return BoundedMailbox.create<T>({
      maxSize,
      overflowStrategy: OverflowStrategy.FAIL,
      enableMetrics: true,
    });
  },
};
