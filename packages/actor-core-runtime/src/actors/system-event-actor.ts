/**
 * @module actor-core/runtime/actors/system-event-actor
 * @description System event actor for pure actor model event distribution
 *
 * This actor handles all system-level events and distributes them to interested
 * actors via message passing, eliminating the need for Observable/Subject patterns.
 *
 * Note: This is a transitional implementation. In a true pure actor model,
 * event subscribers would be actors themselves, not callbacks.
 */

import type { ActorBehavior, ActorMessage, JsonValue } from '../actor-system.js';
import { Logger } from '../logger.js';

const log = Logger.namespace('SYSTEM_EVENT_ACTOR');

// ========================================================================================
// TYPE GUARDS
// ========================================================================================

/**
 * Type guard for SystemEventPayload
 */
function isSystemEventPayload(value: unknown): value is SystemEventPayload {
  return (
    value !== null &&
    typeof value === 'object' &&
    'eventType' in value &&
    typeof (value as Record<string, unknown>).eventType === 'string' &&
    'timestamp' in value &&
    typeof (value as Record<string, unknown>).timestamp === 'number'
  );
}

/**
 * Type guard for ClusterEventPayload
 */
function isClusterEventPayload(value: unknown): value is ClusterEventPayload {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('eventType' in value) ||
    !('node' in value) ||
    !('timestamp' in value)
  ) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  const validEventTypes = ['node-up', 'node-down', 'leader-changed'];

  return (
    validEventTypes.includes(String(obj.eventType)) &&
    typeof obj.node === 'string' &&
    typeof obj.timestamp === 'number'
  );
}

// ========================================================================================
// SYSTEM EVENT MESSAGE TYPES
// ========================================================================================

/**
 * System event payload - must be JSON-serializable
 */
export interface SystemEventPayload {
  eventType: string;
  timestamp: number;
  data?: JsonValue;
}

/**
 * Subscribe to system events
 */
export interface SubscribeToSystemEvents extends ActorMessage {
  type: 'SUBSCRIBE_TO_SYSTEM_EVENTS';
  payload: {
    subscriberPath: string; // Use path instead of full address
    eventTypes?: string[]; // Optional filter for specific event types
  };
}

/**
 * Unsubscribe from system events
 */
export interface UnsubscribeFromSystemEvents extends ActorMessage {
  type: 'UNSUBSCRIBE_FROM_SYSTEM_EVENTS';
  payload: {
    subscriberPath: string;
  };
}

/**
 * System event notification
 */
export interface SystemEventNotification extends ActorMessage {
  type: 'SYSTEM_EVENT_NOTIFICATION';
  payload: JsonValue; // Will be a SystemEvent but typed as JsonValue for compatibility
}

/**
 * Emit a system event
 */
export interface EmitSystemEvent extends ActorMessage {
  type: 'EMIT_SYSTEM_EVENT';
  payload: JsonValue; // Will be a SystemEvent but typed as JsonValue for compatibility
}

export type SystemEventActorMessage =
  | SubscribeToSystemEvents
  | UnsubscribeFromSystemEvents
  | SystemEventNotification
  | EmitSystemEvent;

// ========================================================================================
// SYSTEM EVENT ACTOR CONTEXT
// ========================================================================================

export interface SystemEventActorContext {
  subscribers: Map<
    string,
    {
      path: string;
      eventTypes?: string[];
      isCallback?: boolean; // True if this is a callback-based subscriber
    }
  >;
  eventHistory: SystemEventPayload[];
  maxHistorySize: number;
}

// ========================================================================================
// SYSTEM EVENT ACTOR BEHAVIOR
// ========================================================================================

/**
 * Create the system event actor behavior
 */
export function createSystemEventActor(
  maxHistorySize = 100
): ActorBehavior<SystemEventActorMessage, SystemEventActorContext, ActorMessage> {
  return {
    context: {
      subscribers: new Map(),
      eventHistory: [],
      maxHistorySize,
    },

    async onMessage({ message, context }) {
      switch (message.type) {
        case 'SUBSCRIBE_TO_SYSTEM_EVENTS': {
          const { subscriberPath, eventTypes } = message.payload;

          log.debug('Adding system event subscriber', {
            subscriber: subscriberPath,
            eventTypes,
          });

          context.subscribers.set(subscriberPath, {
            path: subscriberPath,
            eventTypes,
          });

          // Send recent events to new subscriber
          const recentEvents = context.eventHistory.slice(-10);
          const eventsToSend: ActorMessage[] = recentEvents
            .filter((event) => !eventTypes || eventTypes.includes(event.eventType))
            .map((event) => ({
              type: 'SYSTEM_EVENT_NOTIFICATION',
              payload: {
                eventType: event.eventType,
                timestamp: event.timestamp,
                data: event.data || null,
              },
              timestamp: Date.now(),
              version: '1.0.0',
            }));

          return {
            context,
            emit: eventsToSend,
          };
        }

        case 'UNSUBSCRIBE_FROM_SYSTEM_EVENTS': {
          const { subscriberPath } = message.payload;
          const subscriberKey = subscriberPath;

          log.debug('Removing system event subscriber', {
            subscriber: subscriberKey,
          });

          context.subscribers.delete(subscriberKey);

          return { context };
        }

        case 'EMIT_SYSTEM_EVENT': {
          // Type guard for system event payload
          if (!isSystemEventPayload(message.payload)) {
            log.error('Invalid system event payload');
            return { context };
          }

          const event = message.payload;

          log.debug('Emitting system event', {
            eventType: event.eventType,
            subscriberCount: context.subscribers.size,
          });

          // Add to history
          context.eventHistory.push(event);
          if (context.eventHistory.length > context.maxHistorySize) {
            context.eventHistory.shift();
          }

          // In pure actor model, emit the event directly
          // Subscribers will receive it via the actor system's event mechanism
          return {
            context,
            emit: {
              type: event.eventType,
              payload: event.data || {},
              timestamp: event.timestamp,
              version: '1.0.0',
            },
          };
        }

        default:
          log.warn('Unknown message type', { type: message.type });
          return { context };
      }
    },

    async onStart({ context }) {
      log.info('System event actor started', {
        maxHistorySize: context.maxHistorySize,
      });

      // Emit initial system event
      const startEvent: SystemEventPayload = {
        eventType: 'system.event.actor.started',
        timestamp: Date.now(),
      };

      context.eventHistory.push(startEvent);

      return { context };
    },

    async onStop({ context }) {
      log.info('System event actor stopping', {
        subscriberCount: context.subscribers.size,
        eventCount: context.eventHistory.length,
      });
    },
  };
}

// ========================================================================================
// CLUSTER EVENT ACTOR
// ========================================================================================

/**
 * Cluster event payload - must be JSON-serializable
 */
export interface ClusterEventPayload {
  eventType: 'node-up' | 'node-down' | 'leader-changed';
  node: string;
  timestamp: number;
}

/**
 * Subscribe to cluster events
 */
export interface SubscribeToClusterEvents extends ActorMessage {
  type: 'SUBSCRIBE_TO_CLUSTER_EVENTS';
  payload: {
    subscriberPath: string;
  };
}

/**
 * Unsubscribe from cluster events
 */
export interface UnsubscribeFromClusterEvents extends ActorMessage {
  type: 'UNSUBSCRIBE_FROM_CLUSTER_EVENTS';
  payload: {
    subscriberPath: string;
  };
}

/**
 * Cluster event notification
 */
export interface ClusterEventNotification extends ActorMessage {
  type: 'CLUSTER_EVENT_NOTIFICATION';
  payload: JsonValue; // Will be a ClusterEvent but typed as JsonValue for compatibility
}

/**
 * Emit a cluster event
 */
export interface EmitClusterEvent extends ActorMessage {
  type: 'EMIT_CLUSTER_EVENT';
  payload: JsonValue; // Will be a ClusterEvent but typed as JsonValue for compatibility
}

export type ClusterEventActorMessage =
  | SubscribeToClusterEvents
  | UnsubscribeFromClusterEvents
  | ClusterEventNotification
  | EmitClusterEvent;

/**
 * Cluster event actor context
 */
export interface ClusterEventActorContext {
  subscribers: Map<string, string>; // Map of callback ID to actor path
  currentLeader?: string;
  activeNodes: Set<string>;
}

/**
 * Create the cluster event actor behavior
 */
export function createClusterEventActor(): ActorBehavior<
  ClusterEventActorMessage,
  ClusterEventActorContext,
  ActorMessage
> {
  return {
    context: {
      subscribers: new Map(),
      activeNodes: new Set(),
    },

    async onMessage({ message, context }) {
      switch (message.type) {
        case 'SUBSCRIBE_TO_CLUSTER_EVENTS': {
          const { subscriberPath } = message.payload;
          const subscriberKey = subscriberPath;

          log.debug('Adding cluster event subscriber', {
            subscriber: subscriberKey,
          });

          context.subscribers.set(subscriberKey, subscriberPath);

          // Send current cluster state to new subscriber
          const currentState: ActorMessage[] = [];
          if (context.currentLeader) {
            const leaderEvent: ClusterEventPayload = {
              eventType: 'leader-changed',
              node: context.currentLeader,
              timestamp: Date.now(),
            };
            currentState.push({
              type: 'CLUSTER_EVENT_NOTIFICATION',
              payload: {
                eventType: leaderEvent.eventType,
                node: leaderEvent.node,
                timestamp: leaderEvent.timestamp,
              },
              timestamp: Date.now(),
              version: '1.0.0',
            });
          }

          return {
            context,
            emit: currentState,
          };
        }

        case 'UNSUBSCRIBE_FROM_CLUSTER_EVENTS': {
          const { subscriberPath } = message.payload;
          const subscriberKey = subscriberPath;

          log.debug('Removing cluster event subscriber', {
            subscriber: subscriberKey,
          });

          context.subscribers.delete(subscriberKey);

          return { context };
        }

        case 'EMIT_CLUSTER_EVENT': {
          // Type guard for cluster event payload
          if (!isClusterEventPayload(message.payload)) {
            log.error('Invalid cluster event payload');
            return { context };
          }

          const event = message.payload;

          log.debug('Emitting cluster event', {
            eventType: event.eventType,
            node: event.node,
            subscriberCount: context.subscribers.size,
          });

          // Update cluster state
          switch (event.eventType) {
            case 'node-up':
              context.activeNodes.add(event.node);
              break;
            case 'node-down':
              context.activeNodes.delete(event.node);
              break;
            case 'leader-changed':
              context.currentLeader = event.node;
              break;
          }

          // Forward to all subscribers
          const notifications: ActorMessage[] = [];
          for (const [_key, _subscriberPath] of context.subscribers) {
            notifications.push({
              type: 'CLUSTER_EVENT_NOTIFICATION',
              payload: {
                eventType: event.eventType,
                node: event.node,
                timestamp: event.timestamp,
              },
              timestamp: Date.now(),
              version: '1.0.0',
            });
          }

          return {
            context,
            emit: notifications,
          };
        }

        default:
          log.warn('Unknown message type', { type: message.type });
          return { context };
      }
    },

    async onStart({ context }) {
      log.info('Cluster event actor started');
      return { context };
    },

    async onStop({ context }) {
      log.info('Cluster event actor stopping', {
        subscriberCount: context.subscribers.size,
        activeNodes: context.activeNodes.size,
      });
    },
  };
}
