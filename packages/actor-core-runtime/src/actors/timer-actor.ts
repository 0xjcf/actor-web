/**
 * @module actor-core/runtime/actors/timer-actor
 * @description Timer Actor for managing delays and scheduled messages in a pure actor model way
 *
 * This actor handles all time-based operations as messages, allowing for:
 * - Deterministic testing by controlling time advancement
 * - Pure actor model compliance (delays are messages, not external timers)
 * - Integration with system.flush() for test synchronization
 */

import type { ActorRef } from '../actor-ref.js';
import type { ActorMessage } from '../actor-system.js';
import { Logger } from '../logger.js';
import { createSendInstruction, type SendInstruction } from '../message-plan.js';
import type { Message } from '../types.js';
import { defineActor } from '../unified-actor-builder.js';

const log = Logger.namespace('TIMER_ACTOR');

// ============================================================================
// Message Types
// ============================================================================

export interface ScheduleMessage extends ActorMessage {
  type: 'SCHEDULE';
  targetActor: ActorRef<unknown, ActorMessage>;
  message: Message;
  delay: number;
  id?: string; // Optional ID for cancellation
}

export interface CancelScheduledMessage extends ActorMessage {
  type: 'CANCEL_SCHEDULED';
  id: string;
}

export interface AdvanceTimeMessage extends ActorMessage {
  type: 'ADVANCE_TIME';
  by: number;
}

export interface GetScheduledMessage extends ActorMessage {
  type: 'GET_SCHEDULED';
}

export interface ScheduleDelayMessage extends ActorMessage {
  type: 'SCHEDULE_DELAY';
  duration: number;
  callbackMessage: Message;
  targetActor: ActorRef<unknown, ActorMessage>;
}

export type TimerActorMessage =
  | ScheduleMessage
  | CancelScheduledMessage
  | AdvanceTimeMessage
  | GetScheduledMessage
  | ScheduleDelayMessage;

// ============================================================================
// State Types
// ============================================================================

interface ScheduledItem {
  id: string;
  targetActor: ActorRef<unknown, ActorMessage>;
  message: Message;
  scheduledTime: number;
}

export interface TimerActorState {
  currentTime: number;
  scheduledMessages: Map<string, ScheduledItem>;
  nextId: number;
  testMode: boolean; // In test mode, time only advances via ADVANCE_TIME messages
}

// ============================================================================
// Timer Actor Behavior
// ============================================================================

export const createTimerActor = (testMode = false) => {
  return defineActor<TimerActorMessage>()
    .withContext({
      currentTime: testMode ? 0 : Date.now(),
      scheduledMessages: new Map() as Map<string, ScheduledItem>,
      nextId: 1,
      testMode,
    })
    .onMessage(({ message, actor }) => {
      log.debug('🎯 Timer actor received message:', message.type);
      const context = actor.getSnapshot().context;

      switch (message.type) {
        case 'SCHEDULE': {
          log.debug('📅 Processing SCHEDULE message');
          try {
            const scheduleMsg = message as ScheduleMessage;
            log.debug('🔧 Extracted schedule message:', {
              delay: scheduleMsg.delay,
              targetPath: scheduleMsg.targetActor.address.path,
            });

            const id = scheduleMsg.id || `scheduled-${context.nextId}`;
            log.debug('🔧 Generated ID:', id);

            const scheduledTime = context.currentTime + scheduleMsg.delay;
            log.debug('🔧 Calculated scheduled time:', {
              currentTime: context.currentTime,
              delay: scheduleMsg.delay,
              scheduledTime,
            });

            const newScheduledMessages = new Map(context.scheduledMessages);
            newScheduledMessages.set(id, {
              id,
              targetActor: scheduleMsg.targetActor,
              message: scheduleMsg.message,
              scheduledTime,
            });

            log.debug('📅 Scheduled message', {
              id,
              delay: scheduleMsg.delay,
              scheduledTime,
              currentTime: context.currentTime,
              targetPath: scheduleMsg.targetActor.address.path,
              testMode: context.testMode,
            });

            const updatedContext: TimerActorState = {
              ...context,
              scheduledMessages: newScheduledMessages,
              nextId: context.nextId + 1,
            };

            // If not in test mode, update current time and deliver due messages
            if (!context.testMode) {
              const currentTime = Date.now();
              const messagesToSend: SendInstruction[] = [];
              const newScheduledMessages = new Map(updatedContext.scheduledMessages);

              // Check for messages due for delivery
              for (const [id, item] of Array.from(updatedContext.scheduledMessages.entries())) {
                if (item.scheduledTime <= currentTime) {
                  messagesToSend.push(
                    createSendInstruction(
                      item.targetActor, // Use ActorRef directly
                      item.message,
                      'fireAndForget'
                    )
                  );
                  newScheduledMessages.delete(id);
                }
              }

              const finalContext = {
                ...updatedContext,
                currentTime,
                scheduledMessages: newScheduledMessages,
              };

              if (messagesToSend.length > 0) {
                log.debug('🚀 Timer actor emitting messages', {
                  count: messagesToSend.length,
                  messages: messagesToSend.map((m) => ({ to: m.to, type: m.tell?.type })),
                });
                return {
                  context: finalContext,
                  emit: messagesToSend,
                };
              }

              return { context: finalContext };
            }

            return { context: updatedContext };
          } catch (error) {
            console.error('❌ Error in SCHEDULE handler:', error);
            return { context };
          }
        }

        case 'CANCEL_SCHEDULED': {
          const cancelMsg = message as CancelScheduledMessage;
          const newScheduledMessages = new Map(context.scheduledMessages);

          if (newScheduledMessages.delete(cancelMsg.id)) {
            log.debug('Cancelled scheduled message', { id: cancelMsg.id });
          }

          return {
            context: {
              ...context,
              scheduledMessages: newScheduledMessages,
            },
          };
        }

        case 'ADVANCE_TIME': {
          log.debug('⏰ Processing ADVANCE_TIME message');
          try {
            const advanceMsg = message as AdvanceTimeMessage;
            const newTime = context.currentTime + advanceMsg.by;

            log.debug('⏰ Advancing time', {
              from: context.currentTime,
              to: newTime,
              by: advanceMsg.by,
              scheduledCount: context.scheduledMessages.size,
            });
            // Update time first
            const updatedContext = {
              ...context,
              currentTime: newTime,
            };

            // Find and send all due messages
            const messagesToSend: SendInstruction[] = [];
            const newScheduledMessages = new Map(updatedContext.scheduledMessages);

            for (const [id, item] of Array.from(updatedContext.scheduledMessages.entries())) {
              if (item.scheduledTime <= newTime) {
                // Queue the message for sending
                messagesToSend.push(
                  createSendInstruction(
                    item.targetActor, // Use ActorRef directly
                    item.message,
                    'fireAndForget'
                  )
                );

                // Remove from schedule
                newScheduledMessages.delete(id);

                log.debug('Scheduling message for delivery', {
                  id,
                  scheduledTime: item.scheduledTime,
                  currentTime: newTime,
                });
              }
            }

            // Update context with cleaned schedule
            const finalContext = {
              ...updatedContext,
              scheduledMessages: newScheduledMessages,
            };

            // Return both context update AND send instructions using emit field
            // This ensures state is updated AND messages are delivered
            if (messagesToSend.length > 0) {
              return {
                context: finalContext,
                emit: messagesToSend,
              };
            }
            return { context: finalContext };
          } catch (error) {
            console.error('❌ Error in ADVANCE_TIME handler:', error);
            return { context };
          }
        }

        case 'GET_SCHEDULED': {
          // Return info about scheduled messages (for testing/debugging)
          const scheduled = Array.from(context.scheduledMessages.values()).map((item) => ({
            id: item.id,
            scheduledTime: item.scheduledTime,
            timeUntilDelivery: item.scheduledTime - context.currentTime,
          }));

          return {
            context,
            reply: {
              currentTime: context.currentTime,
              scheduled,
              count: scheduled.length,
            },
          };
        }

        case 'SCHEDULE_DELAY': {
          const delayMsg = message as ScheduleDelayMessage;

          // Process as a SCHEDULE message by reprocessing
          // We can't self-send easily, so let's inline the schedule logic
          const id = `scheduled-${context.nextId}`;
          const scheduledTime = context.currentTime + delayMsg.duration;

          const newScheduledMessages = new Map(context.scheduledMessages);
          newScheduledMessages.set(id, {
            id,
            targetActor: delayMsg.targetActor,
            message: delayMsg.callbackMessage,
            scheduledTime,
          });

          return {
            context: {
              ...context,
              scheduledMessages: newScheduledMessages,
              nextId: context.nextId + 1,
            },
          };
        }

        default:
          return { context };
      }
    })
    .build();
};

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a timer actor behavior configured for testing
 */
export function createTestTimerBehavior() {
  return createTimerActor(true);
}

// ============================================================================
// Convenience Types
// ============================================================================

export interface TimerActorRef extends ActorRef {
  /**
   * Schedule a message to be delivered after a delay
   */
  schedule(
    targetActor: ActorRef<unknown, ActorMessage>,
    message: ActorMessage,
    delay: number
  ): Promise<void>;

  /**
   * Schedule a delay with a callback message
   */
  delay(
    duration: number,
    callbackMessage: ActorMessage,
    targetActor: ActorRef<unknown, ActorMessage>
  ): Promise<void>;

  /**
   * Advance time (test mode only)
   */
  advanceTime(ms: number): Promise<void>;

  /**
   * Get information about scheduled messages
   */
  getScheduled(): Promise<{
    currentTime: number;
    scheduled: Array<{ id: string; scheduledTime: number; timeUntilDelivery: number }>;
    count: number;
  }>;
}
