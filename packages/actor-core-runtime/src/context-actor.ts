/**
 * @module actor-core/runtime/context-actor
 * @description Context-based actor implementation without XState dependency
 *
 * This module provides a lightweight actor implementation for context-based
 * actors that don't need full state machine capabilities.
 */

import type { ActorInstance } from './actor-instance.js';
import { Logger } from './logger.js';
import type { ActorSnapshot, ActorStatus, Message } from './types.js';

const log = Logger.namespace('CONTEXT_ACTOR');

/**
 * Lightweight context-based actor implementation.
 * Provides the same interface as XState actors but manages context directly.
 * Implements ActorInstance for polymorphic storage in the actor system.
 */
export class ContextActor<TContext = Record<string, unknown>> implements ActorInstance {
  private context: TContext;
  private readonly actorId: string;
  private actorStatus: ActorStatus = 'idle';

  constructor(id: string, initialContext: TContext) {
    this.actorId = id;
    this.context = initialContext;
  }

  get id(): string {
    return this.actorId;
  }

  get status(): ActorStatus {
    return this.actorStatus;
  }

  /**
   * Get current snapshot (compatible with XState Actor interface)
   */
  getSnapshot(): ActorSnapshot & { context: TContext } {
    return {
      value: 'active',
      context: this.context,
      status: this.actorStatus === 'running' ? 'running' : this.actorStatus,
      error: undefined,
      matches: (state: string) => state === 'active',
      can: () => true,
      hasTag: () => false,
      toJSON: () => ({ value: 'active', context: this.context }),
    };
  }

  /**
   * Send a message to the actor.
   * For context actors, this is typically handled by the system's message processor.
   */
  send<T extends { type: string }>(event: T): void {
    if (this.actorStatus !== 'running') {
      throw new Error(`Cannot send message to ${this.actorStatus} actor`);
    }

    log.debug('🔍 CONTEXT ACTOR DEBUG: send() called', {
      actorId: this.actorId,
      eventType: event.type,
      event,
    });

    // Note: Context updates are typically handled by the behavior's onMessage handler
    // which returns a new context. The direct send() method is mainly for
    // compatibility with the ActorInstance interface.
  }

  /**
   * Ask the actor a question and wait for a response
   */
  async ask<T>(_message: Message, _timeout?: number): Promise<T> {
    // For now, return a placeholder implementation
    // This will be properly implemented with the actor system integration
    throw new Error(`Ask pattern not yet implemented for ContextActor ${this.actorId}`);
  }

  /**
   * Start the actor
   */
  start(): void {
    if (this.actorStatus !== 'idle') {
      throw new Error(`Cannot start actor in ${this.actorStatus} state`);
    }
    this.actorStatus = 'running';
  }

  /**
   * Stop the actor
   */
  stop(): void {
    this.actorStatus = 'stopped';
  }

  /**
   * Update context directly
   */
  updateContext(newContext: TContext): void {
    this.context = newContext;
  }

  /**
   * Get current context (returns a copy for immutability)
   */
  getContext(): TContext {
    // Return a shallow copy to maintain immutability
    return { ...this.context };
  }

  /**
   * Get the type of this actor instance
   */
  getType(): 'context' {
    return 'context';
  }

  /**
   * Get internal state for debugging
   */
  getInternalState(): { status: ActorStatus; context: TContext } {
    return {
      status: this.actorStatus,
      context: this.context,
    };
  }
}

/**
 * Type guard to check if an actor is a context-based actor
 */
export function isContextActor(actor: unknown): actor is ContextActor {
  return actor instanceof ContextActor;
}
