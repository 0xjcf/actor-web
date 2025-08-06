/**
 * Pure Actor Event Collector for Testing
 *
 * This utility provides a pure actor pattern for collecting events in tests,
 * replacing the need for external .subscribe() callbacks which violate the
 * pure actor model.
 *
 * Usage:
 * ```typescript
 * const collector = await system.spawn(createEventCollectorBehavior(), { id: 'test-collector' });
 * await collector.send(createMessage('START_COLLECTING'));
 *
 * // Events will be automatically collected
 * const response = await collector.ask(createMessage('GET_EVENTS'));
 * log.debug('Collected events:', response.events);
 * ```
 *
 * Control Messages:
 * - START_COLLECTING: Begin collecting events
 * - STOP_COLLECTING: Stop collecting events
 * - GET_EVENTS: Retrieve all collected events
 * - CLEAR_EVENTS: Clear the collection buffer
 *
 * @module EventCollector
 */

import type { ActorMessage } from '../actor-system.js';
import { Logger } from '../logger.js';
import { defineActor } from '../unified-actor-builder.js';

const log = Logger.namespace('EVENT_COLLECTOR');

/**
 * Type guard to validate ActorMessage structure
 */
function isActorMessage(msg: unknown): msg is ActorMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    'timestamp' in msg &&
    typeof (msg as ActorMessage).type === 'string'
  );
}

/**
 * GET_EVENTS message with optional waiter parameters
 */
interface GetEventsMessage extends ActorMessage {
  type: 'GET_EVENTS';
  waitForCount?: number;
  timeout?: number;
}

/**
 * Control messages for the event collector
 */
export type EventCollectorMessage =
  | GetEventsMessage
  | { type: 'CLEAR_EVENTS'; payload?: null }
  | { type: 'START_COLLECTING'; payload?: null }
  | { type: 'STOP_COLLECTING'; payload?: null };

/**
 * Response format for GET_EVENTS ask pattern
 */
export interface EventCollectorResponse {
  collectedEvents: ActorMessage[];
  totalReceived: number;
  isActive: boolean;
  error?: string;
  _correlationId?: string;
}

/**
 * Pending waiter request
 */
interface PendingWaiter {
  waitForCount: number;
  requestMessage: ActorMessage;
  waiterId: string; // Unique ID instead of timeout handle
}

/**
 * Internal timeout message
 */
interface WaiterTimeoutMessage extends ActorMessage {
  type: '_WAITER_TIMEOUT';
  waitForCount: number;
  actualCount: number;
}

/**
 * Internal message to process satisfied waiter
 */
interface ProcessSatisfiedWaiterMessage extends ActorMessage {
  type: '_PROCESS_SATISFIED_WAITER';
  waiter: PendingWaiter;
  collectedEvents: ActorMessage[];
  totalReceived: number;
  isActive: boolean;
}

/**
 * Event collector context for state persistence
 */
export interface EventCollectorContext {
  collectedEvents: ActorMessage[];
  totalReceived: number;
  isActive: boolean;
  pendingWaiters: PendingWaiter[];
  error?: string;
}

/**
 * Map to store timeout handles outside of actor context
 * This prevents serialization issues with NodeJS.Timeout objects
 */
const waiterTimeouts = new Map<string, NodeJS.Timeout>();

/**
 * Create an event collector behavior for testing subscription patterns
 *
 * The event collector uses pure actor patterns to collect events via message passing.
 * It responds to control messages and collects all other ActorMessages as events.
 *
 * ✅ Uses defineActor().withContext() for proper context persistence
 */
export function createEventCollectorBehavior() {
  return defineActor<ActorMessage>()
    .withContext<EventCollectorContext>({
      collectedEvents: [],
      totalReceived: 0,
      isActive: true,
      pendingWaiters: [],
    })
    .onMessage(({ message, actor }) => {
      const messageType = message.type || 'unknown';
      const context = actor.getSnapshot().context as EventCollectorContext;

      log.debug('📥 EVENT COLLECTOR: Message received', {
        messageType,
        isActive: context.isActive,
        totalEvents: context.collectedEvents.length,
        pendingWaiters: context.pendingWaiters.length,
        isControlMessage: [
          'GET_EVENTS',
          'CLEAR_EVENTS',
          'START_COLLECTING',
          'STOP_COLLECTING',
          '_WAITER_TIMEOUT',
          '_PROCESS_SATISFIED_WAITER',
        ].includes(messageType),
      });

      // Handle control messages
      switch (messageType) {
        case 'GET_EVENTS': {
          const getEventsMsg = message as GetEventsMessage;
          const waitForCount = getEventsMsg.waitForCount;
          const timeout = getEventsMsg.timeout || 5000; // Default 5 second timeout

          // If waitForCount is specified and we haven't collected enough events yet
          if (waitForCount !== undefined && context.collectedEvents.length < waitForCount) {
            log.debug('⏳ EVENT COLLECTOR: Deferring response until event count reached', {
              currentCount: context.collectedEvents.length,
              waitForCount,
              timeout,
            });

            // Generate unique waiter ID
            const waiterId = `waiter-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

            // Create a timeout handler that will send an error response
            const timeoutHandle = setTimeout(() => {
              // Send timeout error via the reply mechanism
              const timeoutMsg: WaiterTimeoutMessage = {
                type: '_WAITER_TIMEOUT',
                _correlationId: message._correlationId,
                waitForCount,
                actualCount: context.collectedEvents.length,
                _timestamp: Date.now(),
                _version: '1.0.0',
              };
              actor.send(timeoutMsg);
              // Clean up timeout from map
              waiterTimeouts.delete(waiterId);
            }, timeout);

            // Store timeout handle in external map
            waiterTimeouts.set(waiterId, timeoutHandle);

            // Add to pending waiters
            const newWaiter: PendingWaiter = {
              waitForCount,
              requestMessage: message,
              waiterId,
            };

            return {
              context: {
                ...context,
                pendingWaiters: [...context.pendingWaiters, newWaiter],
              },
            };
          }

          // Otherwise, respond immediately
          log.debug('📤 EVENT COLLECTOR: Sending events response', {
            eventsCount: context.collectedEvents.length,
            totalReceived: context.totalReceived,
            isActive: context.isActive,
          });

          return {
            context,
            reply: {
              collectedEvents: context.collectedEvents,
              totalReceived: context.totalReceived,
              isActive: context.isActive,
              error: undefined as string | undefined,
            },
          };
        }

        case 'CLEAR_EVENTS': {
          log.debug('🧹 EVENT COLLECTOR: Clearing events', {
            previousCount: context.collectedEvents.length,
            wasActive: context.isActive,
            pendingWaiters: context.pendingWaiters.length,
          });

          // Clear any pending waiter timeouts
          for (const waiter of context.pendingWaiters) {
            const timeoutHandle = waiterTimeouts.get(waiter.waiterId);
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
              waiterTimeouts.delete(waiter.waiterId);
            }
          }

          return {
            context: {
              ...context,
              collectedEvents: [],
              totalReceived: 0,
              pendingWaiters: [], // Clear pending waiters too
            },
          };
        }

        case 'START_COLLECTING': {
          log.debug('▶️ EVENT COLLECTOR: Starting collection', {
            wasActive: context.isActive,
            currentEvents: context.collectedEvents.length,
          });

          return {
            context: {
              ...context,
              isActive: true,
            },
          };
        }

        case 'STOP_COLLECTING': {
          log.debug('⏹️ EVENT COLLECTOR: Stopping collection', {
            wasActive: context.isActive,
            currentEvents: context.collectedEvents.length,
          });

          return {
            context: {
              ...context,
              isActive: false,
            },
          };
        }

        case '_WAITER_TIMEOUT': {
          // Handle timeout for a pending waiter
          const timeoutMsg = message as WaiterTimeoutMessage;
          const correlationId = timeoutMsg._correlationId;

          // Find and remove the waiter that timed out
          const waiterIndex = context.pendingWaiters.findIndex(
            (w) => w.requestMessage._correlationId === correlationId
          );

          if (waiterIndex >= 0) {
            const waiter = context.pendingWaiters[waiterIndex];
            log.warn('⏱️ EVENT COLLECTOR: Waiter timed out', {
              waitForCount: waiter.waitForCount,
              actualCount: context.collectedEvents.length,
              correlationId,
            });

            // Remove the waiter
            const newWaiters = [...context.pendingWaiters];
            newWaiters.splice(waiterIndex, 1);

            // Send timeout error response
            return {
              context: {
                ...context,
                pendingWaiters: newWaiters,
              },
              reply: {
                collectedEvents: context.collectedEvents,
                totalReceived: context.totalReceived,
                isActive: context.isActive,
                // Include error info in a way that's compatible with the success type
                error:
                  `Timeout waiting for ${timeoutMsg.waitForCount} events. Only received ${timeoutMsg.actualCount} events within ${(waiter.requestMessage as GetEventsMessage).timeout || 5000}ms` as
                    | string
                    | undefined,
              },
            };
          }

          return { context };
        }

        case '_PROCESS_SATISFIED_WAITER': {
          // Process a satisfied waiter (used when multiple waiters are satisfied at once)
          const satisfiedMsg = message as ProcessSatisfiedWaiterMessage;
          const waiter = satisfiedMsg.waiter;

          log.debug('📤 EVENT COLLECTOR: Processing satisfied waiter', {
            waitForCount: waiter.waitForCount,
            eventCount: satisfiedMsg.collectedEvents.length,
          });

          return {
            context,
            reply: {
              collectedEvents: satisfiedMsg.collectedEvents,
              totalReceived: satisfiedMsg.totalReceived,
              isActive: satisfiedMsg.isActive,
              error: undefined as string | undefined,
            },
          };
        }

        default: {
          log.debug('🎯 EVENT COLLECTOR: Default case', {
            messageType,
            isActive: context.isActive,
            isActorMessage: isActorMessage(message),
            message,
          });

          // This is a regular event to collect
          if (context.isActive && isActorMessage(message)) {
            log.debug('🎯 EVENT COLLECTOR: Collecting event', {
              eventType: messageType,
              eventPayload: message,
              previousCount: context.collectedEvents.length,
              newCount: context.collectedEvents.length + 1,
            });

            const newEvents = [...context.collectedEvents, message];
            const newTotal = context.totalReceived + 1;

            // Check if any pending waiters can now be satisfied
            const satisfiedWaiters: PendingWaiter[] = [];
            const remainingWaiters: PendingWaiter[] = [];

            for (const waiter of context.pendingWaiters) {
              if (newEvents.length >= waiter.waitForCount) {
                satisfiedWaiters.push(waiter);
                // Clear the timeout
                const timeoutHandle = waiterTimeouts.get(waiter.waiterId);
                if (timeoutHandle) {
                  clearTimeout(timeoutHandle);
                  waiterTimeouts.delete(waiter.waiterId);
                }
              } else {
                remainingWaiters.push(waiter);
              }
            }

            // If we have satisfied waiters, we need to send replies
            if (satisfiedWaiters.length > 0) {
              log.debug('✅ EVENT COLLECTOR: Satisfying pending waiters', {
                satisfiedCount: satisfiedWaiters.length,
                eventCount: newEvents.length,
              });

              // We can only send one reply per message, so we'll send the first one
              // and schedule the others as internal messages
              const [firstWaiter, ...otherWaiters] = satisfiedWaiters;

              // Schedule other waiters to be processed
              for (const waiter of otherWaiters) {
                setImmediate(() => {
                  // Create waiter without timeout handle for serialization
                  const serializableWaiter: PendingWaiter = {
                    waitForCount: waiter.waitForCount,
                    requestMessage: waiter.requestMessage,
                    waiterId: waiter.waiterId,
                  };
                  const satisfiedMsg: ProcessSatisfiedWaiterMessage = {
                    type: '_PROCESS_SATISFIED_WAITER',
                    waiter: serializableWaiter,
                    collectedEvents: newEvents,
                    totalReceived: newTotal,
                    isActive: context.isActive,
                    _timestamp: Date.now(),
                    _version: '1.0.0',
                    _correlationId: waiter.requestMessage._correlationId, // Preserve original correlation ID
                  };
                  actor.send(satisfiedMsg);
                });
              }

              // Reply to the first waiter
              // Cannot reply to a different message's ask pattern
              // Instead, schedule this waiter to be processed via internal message
              setImmediate(() => {
                const serializableWaiter: PendingWaiter = {
                  waitForCount: firstWaiter.waitForCount,
                  requestMessage: firstWaiter.requestMessage,
                  waiterId: firstWaiter.waiterId,
                };
                const satisfiedMsg: ProcessSatisfiedWaiterMessage = {
                  type: '_PROCESS_SATISFIED_WAITER',
                  waiter: serializableWaiter,
                  collectedEvents: newEvents,
                  totalReceived: newTotal,
                  isActive: context.isActive,
                  _timestamp: Date.now(),
                  _version: '1.0.0',
                  _correlationId: firstWaiter.requestMessage._correlationId, // Preserve original correlation ID
                };
                actor.send(satisfiedMsg);
              });

              // Just update context for this event
              return {
                context: {
                  ...context,
                  collectedEvents: newEvents,
                  totalReceived: newTotal,
                  pendingWaiters: remainingWaiters,
                },
              };
            }

            // No waiters satisfied, just update context
            return {
              context: {
                ...context,
                collectedEvents: newEvents,
                totalReceived: newTotal,
              },
            };
          }

          log.debug('🚫 EVENT COLLECTOR: Ignoring event', {
            eventType: messageType,
            reason: !context.isActive ? 'collection inactive' : 'invalid message format',
            isActive: context.isActive,
            isValidMessage: isActorMessage(message),
          });

          return { context };
        }
      }
    })
    .build();
}

/**
 * Type guard for event collector responses
 */
export function isEventCollectorResponse(response: unknown): response is EventCollectorResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'collectedEvents' in response &&
    'totalReceived' in response &&
    'isActive' in response &&
    Array.isArray((response as EventCollectorResponse).collectedEvents)
  );
}
