/**
 * @module actor-core/runtime/actors/event-broker-actor
 * @description Event Broker Actor for Topic-Based Pub/Sub Communication
 *
 * This actor implements pure message-based pub/sub following FRAMEWORK-STANDARD:
 * - All interactions through messages (SUBSCRIBE, UNSUBSCRIBE, PUBLISH)
 * - Wildcard topic matching support (e.g., 'user.*', 'orders.created.*')
 * - Location transparency for distributed scenarios
 * - No direct method calls or singleton patterns
 * - Proper supervision integration
 *
 * @author Agent A - Actor-Core Framework
 * @version 1.0.0
 */

import type { ActorInstance } from '../actor-instance.js';
import type { ActorDependencies, ActorMessage, JsonValue } from '../actor-system.js';
import { Logger } from '../logger.js';
import type { DomainEvent, MessagePlan } from '../message-plan.js';
import { createSendInstruction } from '../message-plan.js';
import { createNullActorRef } from '../utils/null-actor.js';

const log = Logger.namespace('EVENT_BROKER_ACTOR');

// ============================================================================
// EVENT BROKER MESSAGE TYPES (FRAMEWORK-STANDARD Compliant)
// ============================================================================

/**
 * Subscribe to a topic or pattern
 */
export interface SubscribeMessage extends ActorMessage {
  type: 'SUBSCRIBE';
  readonly topic: string;
  readonly pattern?: string; // For wildcard matching like 'user.*'
  readonly subscriber: string; // Actor address
}

/**
 * Unsubscribe from a topic or pattern
 */
export interface UnsubscribeMessage extends ActorMessage {
  type: 'UNSUBSCRIBE';
  readonly topic: string;
  readonly pattern?: string;
  readonly subscriber: string; // Actor address
}

/**
 * Publish an event to a topic
 */
export interface PublishMessage extends ActorMessage {
  type: 'PUBLISH';
  readonly topic: string;
  readonly event: JsonValue; // Event data as JSON-serializable value
  readonly publisherId?: string; // Optional publisher identification
}

/**
 * Get broker statistics
 */
export interface GetBrokerStatsMessage extends ActorMessage {
  type: 'GET_BROKER_STATS';
  readonly requestor: string; // Actor address to send response to
}

/**
 * Union type for all Event Broker messages
 */
export type EventBrokerMessage =
  | SubscribeMessage
  | UnsubscribeMessage
  | PublishMessage
  | GetBrokerStatsMessage;

// ============================================================================
// EVENT BROKER CONTEXT AND STATE
// ============================================================================

/**
 * Event Broker Actor Context (stored in XState machine)
 */
export interface EventBrokerContext {
  readonly subscriptions: Map<string, Set<string>>; // topic -> Set<subscriber addresses>
  readonly wildcardSubscriptions: Map<string, Set<string>>; // pattern -> Set<subscriber addresses>
  readonly messageCount: number;
  readonly publishCount: number;
  readonly subscriptionCount: number;
}

/**
 * Initial context for Event Broker
 */
export function createInitialEventBrokerContext(): EventBrokerContext {
  return {
    subscriptions: new Map(),
    wildcardSubscriptions: new Map(),
    messageCount: 0,
    publishCount: 0,
    subscriptionCount: 0,
  };
}

// ============================================================================
// TYPE GUARDS (FRAMEWORK-STANDARD compliant)
// ============================================================================

/**
 * Type guard for SubscribeMessage
 */
function isSubscribeMessage(message: ActorMessage): message is SubscribeMessage {
  return (
    message.type === 'SUBSCRIBE' &&
    message !== null &&
    typeof message === 'object' &&
    'topic' in message &&
    'subscriber' in message &&
    typeof message.topic === 'string' &&
    typeof message.subscriber === 'string'
  );
}

/**
 * Type guard for UnsubscribeMessage
 */
function isUnsubscribeMessage(message: ActorMessage): message is UnsubscribeMessage {
  return (
    message.type === 'UNSUBSCRIBE' &&
    message !== null &&
    typeof message === 'object' &&
    'topic' in message &&
    'subscriber' in message &&
    typeof message.topic === 'string' &&
    typeof message.subscriber === 'string'
  );
}

/**
 * Type guard for PublishMessage
 */
function isPublishMessage(message: ActorMessage): message is PublishMessage {
  return (
    message.type === 'PUBLISH' &&
    message !== null &&
    typeof message === 'object' &&
    'topic' in message &&
    'event' in message &&
    typeof message.topic === 'string' &&
    typeof message.event === 'object' &&
    message.event !== null
  );
}

/**
 * Type guard for GetBrokerStatsMessage
 */
function isGetBrokerStatsMessage(message: ActorMessage): message is GetBrokerStatsMessage {
  return (
    message.type === 'GET_BROKER_STATS' &&
    message !== null &&
    typeof message === 'object' &&
    'requestor' in message &&
    typeof message.requestor === 'string'
  );
}

// ============================================================================
// EVENT TYPE EXTRACTION (Type-safe JsonValue handling)
// ============================================================================

/**
 * Safely extract event type from JsonValue event data
 */
function getEventType(event: JsonValue): string {
  if (event && typeof event === 'object' && !Array.isArray(event) && 'type' in event) {
    const eventObj = event as { type: unknown };
    return typeof eventObj.type === 'string' ? eventObj.type : 'unknown';
  }
  return 'unknown';
}

// ============================================================================
// WILDCARD PATTERN MATCHING
// ============================================================================

/**
 * Check if a topic matches a wildcard pattern
 * Supports patterns like 'user.*', 'orders.created.*', etc.
 */
function matchesPattern(topic: string, pattern: string): boolean {
  if (pattern === '*') {
    return true; // Match all topics
  }

  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2); // Remove '.*'
    return topic.startsWith(`${prefix}.`) || topic === prefix;
  }

  if (pattern.includes('*')) {
    // Convert wildcard pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.') // Escape dots
      .replace(/\*/g, '.*'); // Convert * to .*

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(topic);
  }

  return topic === pattern;
}

/**
 * Find all subscribers matching a topic (direct + wildcard patterns)
 */
function findMatchingSubscribers(
  topic: string,
  subscriptions: Map<string, Set<string>>,
  wildcardSubscriptions: Map<string, Set<string>>
): Set<string> {
  const matches = new Set<string>();

  // Add direct topic subscribers
  const directSubscribers = subscriptions.get(topic);
  if (directSubscribers) {
    directSubscribers.forEach((subscriber) => matches.add(subscriber));
  }

  // Add wildcard pattern matches
  for (const [pattern, subscribers] of wildcardSubscriptions.entries()) {
    if (matchesPattern(topic, pattern)) {
      subscribers.forEach((subscriber) => matches.add(subscriber));
    }
  }

  return matches;
}

// ============================================================================
// EVENT BROKER ACTOR BEHAVIOR
// ============================================================================

/**
 * Create Event Broker Actor Behavior (FRAMEWORK-STANDARD compliant)
 *
 * This pure actor handles topic-based pub/sub through messages only:
 * - SUBSCRIBE: Add subscriber to topic/pattern
 * - UNSUBSCRIBE: Remove subscriber from topic/pattern
 * - PUBLISH: Fan-out event to all matching subscribers
 * - GET_BROKER_STATS: Return broker statistics
 */
export function createEventBrokerBehavior() {
  return {
    async onMessage({
      message,
      machine,
      dependencies,
    }: {
      message: ActorMessage;
      machine: ActorInstance;
      dependencies: ActorDependencies;
    }): Promise<MessagePlan | undefined> {
      const context = machine.getSnapshot().context as EventBrokerContext;

      log.debug('Event broker received message', {
        messageType: message.type,
        actorId: dependencies.actorId,
        subscriptionCount: context.subscriptionCount,
      });

      // Update message count
      const newContext = {
        ...context,
        messageCount: context.messageCount + 1,
      };

      if (isSubscribeMessage(message)) {
        return await handleSubscribe(message, newContext, dependencies);
      }
      if (isUnsubscribeMessage(message)) {
        return await handleUnsubscribe(message, newContext, dependencies);
      }
      if (isPublishMessage(message)) {
        return await handlePublish(message, newContext, dependencies);
      }
      if (isGetBrokerStatsMessage(message)) {
        return await handleGetBrokerStats(message, newContext, dependencies);
      }
      log.warn('Unknown message type received by event broker', {
        messageType: message.type,
        actorId: dependencies.actorId,
      });

      // Return domain event for unknown message
      return {
        type: 'BROKER_UNKNOWN_MESSAGE',
        messageType: message.type,
        timestamp: Date.now(),
      };
    },
  };
}

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================

/**
 * Handle SUBSCRIBE message - Add subscriber to topic/pattern
 */
async function handleSubscribe(
  message: SubscribeMessage,
  context: EventBrokerContext,
  dependencies: ActorDependencies
): Promise<MessagePlan> {
  const { topic, pattern, subscriber } = message;

  log.debug('Handling subscription', {
    topic,
    pattern,
    subscriber,
    actorId: dependencies.actorId,
  });

  // Determine if this is a wildcard pattern subscription
  const isWildcard = pattern || topic.includes('*');
  const subscriptionKey = pattern || topic;

  // Get the appropriate subscription map
  const subscriptionMap = isWildcard ? context.wildcardSubscriptions : context.subscriptions;

  // Add subscriber to the topic/pattern
  if (!subscriptionMap.has(subscriptionKey)) {
    subscriptionMap.set(subscriptionKey, new Set());
  }

  const subscribers = subscriptionMap.get(subscriptionKey) || new Set<string>();
  const wasNew = !subscribers.has(subscriber);
  subscribers.add(subscriber);

  // Update context
  const newContext = {
    ...context,
    subscriptionCount: wasNew ? context.subscriptionCount + 1 : context.subscriptionCount,
  };

  // Update machine state
  dependencies.actor.send({
    type: 'SUBSCRIPTION_ADDED',
    topic: subscriptionKey,
    subscriber,
    isWildcard,
  });

  // Return domain event for successful subscription
  return {
    type: 'SUBSCRIPTION_ADDED',
    topic: subscriptionKey,
    subscriber,
    isWildcard,
    totalSubscriptions: newContext.subscriptionCount,
    timestamp: Date.now(),
  };
}

/**
 * Handle UNSUBSCRIBE message - Remove subscriber from topic/pattern
 */
async function handleUnsubscribe(
  message: UnsubscribeMessage,
  context: EventBrokerContext,
  dependencies: ActorDependencies
): Promise<MessagePlan> {
  const { topic, pattern, subscriber } = message;

  log.debug('Handling unsubscription', {
    topic,
    pattern,
    subscriber,
    actorId: dependencies.actorId,
  });

  // Determine if this is a wildcard pattern unsubscription
  const isWildcard = pattern || topic.includes('*');
  const subscriptionKey = pattern || topic;

  // Get the appropriate subscription map
  const subscriptionMap = isWildcard ? context.wildcardSubscriptions : context.subscriptions;

  // Remove subscriber from the topic/pattern
  const subscribers = subscriptionMap.get(subscriptionKey);
  let wasRemoved = false;

  if (subscribers) {
    wasRemoved = subscribers.delete(subscriber);

    // Clean up empty subscription sets
    if (subscribers.size === 0) {
      subscriptionMap.delete(subscriptionKey);
    }
  }

  // Update context
  const newContext = {
    ...context,
    subscriptionCount: wasRemoved ? context.subscriptionCount - 1 : context.subscriptionCount,
  };

  // Update machine state
  dependencies.actor.send({
    type: 'SUBSCRIPTION_REMOVED',
    topic: subscriptionKey,
    subscriber,
    isWildcard,
  });

  // Return domain event for successful unsubscription
  return {
    type: 'SUBSCRIPTION_REMOVED',
    topic: subscriptionKey,
    subscriber,
    isWildcard,
    totalSubscriptions: newContext.subscriptionCount,
    wasRemoved,
    timestamp: Date.now(),
  };
}

/**
 * Handle PUBLISH message - Fan-out event to all matching subscribers
 */
async function handlePublish(
  message: PublishMessage,
  context: EventBrokerContext,
  dependencies: ActorDependencies
): Promise<MessagePlan> {
  const { topic, event, publisherId } = message;

  // Extract event type safely with type guard
  const eventType = getEventType(event);

  log.debug('Handling publish', {
    topic,
    eventType,
    publisherId,
    actorId: dependencies.actorId,
  });

  // Find all matching subscribers
  const matchingSubscribers = findMatchingSubscribers(
    topic,
    context.subscriptions,
    context.wildcardSubscriptions
  );

  log.debug('Found matching subscribers', {
    topic,
    subscriberCount: matchingSubscribers.size,
    subscribers: Array.from(matchingSubscribers),
  });

  // Update context
  const newContext = {
    ...context,
    publishCount: context.publishCount + 1,
  };

  // Update machine state
  dependencies.actor.send({
    type: 'EVENT_PUBLISHED',
    topic,
    eventType,
    subscriberCount: matchingSubscribers.size,
  });

  // Create fan-out instructions for all matching subscribers
  const fanOutInstructions = Array.from(matchingSubscribers).map((subscriberAddress) => {
    // Create topic event message for subscriber with proper JsonValue handling
    const topicEventMessage = {
      type: 'TOPIC_EVENT',
      topic,
      event,
      publisherId: publisherId || null, // Convert undefined to null for JsonValue compatibility
    };

    // Create send instruction with null actor placeholder
    return createSendInstruction(
      createNullActorRef(subscriberAddress),
      topicEventMessage,
      'fireAndForget'
    );
  });

  // Return MessagePlan with fan-out instructions and domain event
  const domainEvent: DomainEvent = {
    type: 'EVENT_PUBLISHED',
    topic,
    eventType,
    subscriberCount: matchingSubscribers.size,
    publishCount: newContext.publishCount,
    timestamp: Date.now(),
  };

  // If no subscribers, just return the domain event
  if (fanOutInstructions.length === 0) {
    return domainEvent;
  }

  // Return both domain event and fan-out instructions
  return [domainEvent, ...fanOutInstructions];
}

/**
 * Handle GET_BROKER_STATS message - Return broker statistics
 */
async function handleGetBrokerStats(
  message: GetBrokerStatsMessage,
  context: EventBrokerContext,
  dependencies: ActorDependencies
): Promise<MessagePlan> {
  const { requestor } = message;

  log.debug('Handling stats request', {
    requestor,
    actorId: dependencies.actorId,
  });

  // Collect statistics
  const stats = {
    messageCount: context.messageCount,
    publishCount: context.publishCount,
    subscriptionCount: context.subscriptionCount,
    directTopics: context.subscriptions.size,
    wildcardPatterns: context.wildcardSubscriptions.size,
    timestamp: Date.now(),
  };

  // Create response message with flat structure
  const statsResponseMessage = {
    type: 'BROKER_STATS_RESPONSE',
    ...stats,
  };

  // Return send instruction to requestor with null actor placeholder
  return createSendInstruction(
    createNullActorRef(requestor),
    statsResponseMessage,
    'fireAndForget'
  );
}

// ============================================================================
// SYSTEM INTEGRATION
// ============================================================================

/**
 * Well-known address for the system event broker
 */
export const SYSTEM_EVENT_BROKER_ADDRESS = 'system.event-broker';

/**
 * Create the system event broker actor (for use by ActorSystem)
 */
export function createSystemEventBroker() {
  return {
    behavior: createEventBrokerBehavior(),
    initialContext: createInitialEventBrokerContext(),
    address: SYSTEM_EVENT_BROKER_ADDRESS,
  };
}
