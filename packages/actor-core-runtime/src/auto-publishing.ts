/**
 * @module actor-core/runtime/auto-publishing
 * @description Auto-Publishing Event System - Phase 2.1 Task Group 4
 *
 * Implements automatic detection of actors that emit events and provides
 * infrastructure for subscription management without explicit configuration.
 *
 * Key Features:
 * - Detects actors with emit arrays in behavior definitions
 * - Lazy initialization of subscription infrastructure
 * - Type inference for publishable events
 * - Integration with existing subscription system
 */

import type { ActorRef } from './actor-ref.js';
import type { ActorBehavior, ActorMessage } from './actor-system.js';
import type { OTPContextHandler, XStateMachineHandler } from './create-actor.js';
import { Logger } from './logger.js';
import type { MessagePlan } from './message-plan.js';

const log = Logger.namespace('AUTO_PUBLISHING');

/**
 * Subscription info with event filters
 */
export interface SubscriberInfo {
  /** The subscriber actor reference */
  actor: ActorRef;
  /** Event types to filter (empty array means all events) */
  eventTypes: string[];
}

/**
 * Metadata about an actor's publishable events
 */
export interface PublishableEventMetadata {
  /** The actor ID that can publish events */
  actorId: string;
  /** Set of event types this actor can emit */
  eventTypes: Set<string>;
  /** Whether subscription infrastructure has been initialized */
  infrastructureInitialized: boolean;
  /** Track active subscribers with their event filters */
  subscribers: Map<string, SubscriberInfo>;
}

/**
 * Registry of actors that can publish events
 */
export class AutoPublishingRegistry {
  private publishableActors = new Map<string, PublishableEventMetadata>();

  /**
   * Analyze a behavior to detect if it emits events
   */
  analyzeActorBehavior<TMessage, TEmitted>(
    actorId: string,
    behavior: ActorBehavior<TMessage, TEmitted>
  ): PublishableEventMetadata | null {
    log.debug('🔍 AUTO-PUBLISHING DEBUG: analyzeActorBehavior called', {
      actorId,
      behaviorKeys: Object.keys(behavior || {}),
      behaviorType: typeof behavior,
    });

    log.debug('Analyzing actor behavior for auto-publishing', { actorId });

    // Check if behavior has explicit emit capability markers
    const hasEmitCapability = this.detectEmitCapability(behavior);

    log.debug('🔍 AUTO-PUBLISHING DEBUG: detectEmitCapability result', {
      actorId,
      hasEmitCapability,
    });

    if (hasEmitCapability) {
      // Check if already registered to preserve existing subscribers
      const existingMetadata = this.publishableActors.get(actorId);
      if (existingMetadata) {
        log.debug(
          '🔍 AUTO-PUBLISHING DEBUG: Actor already registered, returning existing metadata',
          {
            actorId,
            existingSubscribers: existingMetadata.subscribers.size,
          }
        );
        return existingMetadata;
      }

      const metadata: PublishableEventMetadata = {
        actorId,
        eventTypes: new Set<string>(),
        infrastructureInitialized: false,
        subscribers: new Map(),
      };

      this.publishableActors.set(actorId, metadata);

      log.debug('🔍 AUTO-PUBLISHING DEBUG: Actor registered for auto-publishing', {
        actorId,
        hasExplicitEmit: true,
        totalPublishers: this.publishableActors.size,
      });

      log.info('Actor registered for auto-publishing', {
        actorId,
        hasExplicitEmit: true,
      });

      return metadata;
    }

    log.debug('🔍 AUTO-PUBLISHING DEBUG: Actor NOT registered (no emit capability)', {
      actorId,
    });

    return null;
  }

  /**
   * Detect if a behavior has emit capability
   */
  private detectEmitCapability<TMessage, TEmitted>(
    behavior: ActorBehavior<TMessage, TEmitted>
  ): boolean {
    log.debug('Detecting emit capability', {
      hasOnMessage: behavior.onMessage !== undefined,
      hasPublishableEvents: 'publishableEvents' in behavior,
    });

    // Check if onMessage handler is defined
    if (behavior.onMessage !== undefined) {
      // This is a compile-time check, runtime detection would require
      // analyzing actual message handler returns
      log.debug('Actor has onMessage handler, assuming emit capability');
      return true; // Conservative: assume any actor might emit
    }

    // Check for explicit publishable events marker
    if ('publishableEvents' in behavior && Array.isArray(behavior.publishableEvents)) {
      log.debug('Actor has publishableEvents marker');
      return true;
    }

    log.debug('No emit capability detected');
    return false;
  }

  /**
   * Get metadata for a publishable actor
   */
  getPublishableActor(actorId: string): PublishableEventMetadata | undefined {
    return this.publishableActors.get(actorId);
  }

  /**
   * Initialize subscription infrastructure for an actor (lazy)
   */
  initializeInfrastructure(actorId: string): void {
    const metadata = this.publishableActors.get(actorId);
    if (!metadata) {
      throw new Error(`Actor ${actorId} is not registered for auto-publishing`);
    }

    if (metadata.infrastructureInitialized) {
      log.debug('Infrastructure already initialized', { actorId });
      return;
    }

    log.info('Initializing subscription infrastructure', { actorId });

    // Mark as initialized
    metadata.infrastructureInitialized = true;

    // Infrastructure setup happens in the actor system when first subscriber connects
  }

  /**
   * Track event types emitted by an actor (runtime detection)
   */
  trackEmittedEvent(actorId: string, eventType: string): void {
    log.debug('trackEmittedEvent called', {
      actorId,
      eventType,
      hasMetadata: this.publishableActors.has(actorId),
    });

    const metadata = this.publishableActors.get(actorId);
    if (metadata) {
      if (!metadata.eventTypes.has(eventType)) {
        log.debug('New event type detected', { actorId, eventType });
        metadata.eventTypes.add(eventType);
      } else {
        log.debug('Event type already tracked', { actorId, eventType });
      }
    } else {
      log.warn('No metadata found for actor when tracking event', { actorId, eventType });
    }
  }

  /**
   * Get all event types an actor can emit
   */
  getPublishableEvents(actorId: string): string[] {
    const metadata = this.publishableActors.get(actorId);
    return metadata ? Array.from(metadata.eventTypes) : [];
  }

  /**
   * Add a subscriber to an actor's events
   */
  addSubscriber(
    publisherId: string,
    subscriberId: string,
    subscriber: ActorRef,
    eventTypes: string[] = []
  ): void {
    log.debug('🔍 AUTO-PUBLISHING DEBUG: addSubscriber called', {
      publisherId,
      subscriberId,
      eventTypes,
      hasPublisher: this.publishableActors.has(publisherId),
      allPublishers: Array.from(this.publishableActors.keys()),
    });

    const metadata = this.publishableActors.get(publisherId);
    if (!metadata) {
      throw new Error(`Actor ${publisherId} is not registered for auto-publishing`);
    }

    metadata.subscribers.set(subscriberId, {
      actor: subscriber,
      eventTypes,
    });

    log.debug('🔍 AUTO-PUBLISHING DEBUG: Subscriber added successfully', {
      publisherId,
      subscriberId,
      eventTypes,
      totalSubscribers: metadata.subscribers.size,
    });

    log.debug('Subscriber added', { publisherId, subscriberId, eventTypes });
  }

  /**
   * Remove a subscriber from an actor's events
   */
  removeSubscriber(publisherId: string, subscriberId: string): void {
    const metadata = this.publishableActors.get(publisherId);
    if (metadata) {
      metadata.subscribers.delete(subscriberId);
      log.debug('Subscriber removed', { publisherId, subscriberId });
    }
  }

  /**
   * Get all subscribers for an actor
   */
  getSubscribers(publisherId: string): SubscriberInfo[] {
    const metadata = this.publishableActors.get(publisherId);
    return metadata ? Array.from(metadata.subscribers.values()) : [];
  }

  /**
   * Get subscribers for a specific event type
   */
  getSubscribersForEvent(publisherId: string, eventType: string): ActorRef[] {
    log.debug('🔍 AUTO-PUBLISHING DEBUG: getSubscribersForEvent called', {
      publisherId,
      eventType,
      hasPublisher: this.publishableActors.has(publisherId),
      allPublishers: Array.from(this.publishableActors.keys()),
      publisherMetadata: this.publishableActors.get(publisherId),
    });

    const metadata = this.publishableActors.get(publisherId);
    if (!metadata) {
      log.debug('🔍 AUTO-PUBLISHING DEBUG: No metadata found for publisher', {
        publisherId,
        eventType,
      });
      return [];
    }

    const subscribers: ActorRef[] = [];
    log.debug('🔍 AUTO-PUBLISHING DEBUG: Checking subscribers', {
      publisherId,
      eventType,
      totalSubscribers: metadata.subscribers.size,
      subscriberEntries: Array.from(metadata.subscribers.entries()).map(([id, info]) => ({
        id,
        eventTypes: info.eventTypes,
        actorPath: info.actor.address.path,
      })),
    });

    for (const subscriberInfo of metadata.subscribers.values()) {
      // If no event filter specified, or event type matches filter
      if (subscriberInfo.eventTypes.length === 0 || subscriberInfo.eventTypes.includes(eventType)) {
        subscribers.push(subscriberInfo.actor);
      }
    }

    log.debug('🔍 AUTO-PUBLISHING DEBUG: Returning subscribers', {
      publisherId,
      eventType,
      subscriberCount: subscribers.length,
      totalSubscribers: metadata.subscribers.size,
      subscribers: subscribers.map((s) => s.address.path),
    });

    return subscribers;
  }

  /**
   * Clear all registrations (for testing)
   */
  clear(): void {
    this.publishableActors.clear();
  }
}

/**
 * Analyze message plan to detect emitted events
 */
export function analyzeMessagePlan(plan: MessagePlan): string[] {
  const eventTypes: string[] = [];

  if (!plan) return eventTypes;

  const instructions = Array.isArray(plan) ? plan : [plan];

  for (const instruction of instructions) {
    if ('emit' in instruction && Array.isArray(instruction.emit)) {
      for (const event of instruction.emit) {
        if (
          event &&
          typeof event === 'object' &&
          'type' in event &&
          typeof event.type === 'string'
        ) {
          eventTypes.push(event.type);
        }
      }
    }
  }

  return eventTypes;
}

/**
 * Type guard to check if handler returns emit arrays
 */
export function hasEmitCapability<T>(
  handler: OTPContextHandler<T, unknown> | XStateMachineHandler<T> | unknown
): handler is { emit?: unknown[] } {
  // This is a type-level check, actual runtime detection happens
  // when processing message handler returns
  return typeof handler === 'function';
}

/**
 * Create subscription message for auto-publishing
 */
export function createSubscribeMessage(
  subscriberId: string,
  events: string[]
): ActorMessage<{
  type: 'SUBSCRIBE';
  subscriberId: string;
  events: string[];
}> {
  return {
    type: 'SUBSCRIBE',
    subscriberId,
    events,
    _timestamp: Date.now(),
    _version: '2.0.0',
  };
}

/**
 * Create unsubscribe message for auto-publishing
 */
export function createUnsubscribeMessage(subscriberId: string): ActorMessage<{
  type: 'UNSUBSCRIBE';
  subscriberId: string;
}> {
  return {
    type: 'UNSUBSCRIBE',
    subscriberId,
    _timestamp: Date.now(),
    _version: '2.0.0',
  };
}
