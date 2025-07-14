/**
 * @module framework/core/actor-event-bus
 * @description Actor-to-Actor Event Bus for the Actor-Web Framework
 * @author Agent A (Tech Lead) - 2025-14-07
 *
 * This implements the event emission system that allows actors to emit events
 * to subscribers, enabling decoupled actor-to-actor communication patterns.
 *
 * Key Features:
 * - Type-safe event emission and subscription
 * - Proper cleanup and memory management
 * - Error handling with graceful degradation
 * - Performance optimized for high-throughput scenarios
 * - Follows Actor-Web Framework patterns and standards
 */

import { Logger } from './dev-mode.js';

// Use scoped logger as recommended in Testing Guide
const log = Logger.namespace('ACTOR_EVENT_BUS');

/**
 * Unsubscribe function returned by event subscriptions
 */
export type Unsubscribe = () => void;

/**
 * Event listener function type
 */
export type EventListener<TEvent> = (event: TEvent) => void;

/**
 * Actor Event Bus for managing event emission and subscription between actors
 *
 * This is separate from ReactiveEventBus which handles DOM events.
 * ActorEventBus handles actor-to-actor communication events.
 */
export class ActorEventBus<TEvent = unknown> {
  private listeners = new Set<EventListener<TEvent>>();
  private isDestroyed = false;

  /**
   * Emit an event to all subscribers
   * @param event - The event to emit
   */
  emit(event: TEvent): void {
    if (this.isDestroyed) {
      log.warn('Attempted to emit event on destroyed event bus', { event });
      return;
    }

    // Create a snapshot of listeners to avoid issues with concurrent modifications
    const currentListeners = Array.from(this.listeners);

    log.debug('Emitting event to subscribers', {
      event,
      listenerCount: currentListeners.length,
    });

    // Emit to all listeners with proper error handling
    for (const listener of currentListeners) {
      try {
        listener(event);
      } catch (error) {
        log.error('Error in event listener:', { error, event });
        // Continue processing other listeners even if one fails
      }
    }
  }

  /**
   * Subscribe to events emitted by this bus
   * @param listener - Function to call when events are emitted
   * @returns Unsubscribe function to stop receiving events
   */
  subscribe(listener: EventListener<TEvent>): Unsubscribe {
    if (this.isDestroyed) {
      log.warn('Attempted to subscribe to destroyed event bus');
      return () => {}; // Return no-op unsubscribe function
    }

    this.listeners.add(listener);

    log.debug('Added event listener', {
      totalListeners: this.listeners.size,
    });

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
      log.debug('Removed event listener', {
        totalListeners: this.listeners.size,
      });
    };
  }

  /**
   * Get the current number of subscribers
   * @returns Number of active subscribers
   */
  get subscriberCount(): number {
    return this.listeners.size;
  }

  /**
   * Check if the event bus has any subscribers
   * @returns true if there are active subscribers
   */
  get hasSubscribers(): boolean {
    return this.listeners.size > 0;
  }

  /**
   * Remove all subscribers and mark as destroyed
   * Called during actor cleanup to prevent memory leaks
   */
  destroy(): void {
    log.debug('Destroying event bus', {
      subscriberCount: this.listeners.size,
    });

    this.listeners.clear();
    this.isDestroyed = true;
  }

  /**
   * Check if the event bus is destroyed
   * @returns true if destroyed
   */
  get destroyed(): boolean {
    return this.isDestroyed;
  }
}
