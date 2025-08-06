/**
 * @module actor-core/runtime/actor-event-bus
 * @description Actor-to-Actor Event Bus for the Actor-Web Framework
 * @author Agent A (Tech Lead) - 2025-07-15
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

import { Logger } from './logger.js';

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
  getSubscriberCount(): number {
    return this.listeners.size;
  }

  /**
   * Check if the event bus has been destroyed
   * @returns True if destroyed, false otherwise
   */
  getIsDestroyed(): boolean {
    return this.isDestroyed;
  }

  /**
   * Destroy the event bus and cleanup all listeners
   * After calling this, no more events can be emitted or subscribed to
   */
  destroy(): void {
    log.debug('Destroying event bus', {
      listenerCount: this.listeners.size,
    });

    this.listeners.clear();
    this.isDestroyed = true;
  }

  /**
   * Get debug information about the event bus
   * @returns Debug information object
   */
  getDebugInfo(): {
    listenerCount: number;
    isDestroyed: boolean;
  } {
    return {
      listenerCount: this.listeners.size,
      isDestroyed: this.isDestroyed,
    };
  }
}
