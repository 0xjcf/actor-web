/**
 * @module actor-core/runtime/pure-behavior-handler
 * @description Pure Actor Behavior Handler for MessagePlan Processing
 *
 * This handler processes pure actor behaviors that return MessagePlan responses,
 * following strict FRAMEWORK-STANDARD principles:
 * - No timeouts or delays
 * - Pure message-based communication
 * - Type-safe operations with zero `any` usage
 * - Business message correlation for ask patterns
 *
 * @author Agent A - Actor-Core Framework
 * @version 1.0.0
 */

import type { ActorInstance } from './actor-instance.js';
import type { ActorDependencies, ActorMessage } from './actor-system.js';
import { Logger } from './logger.js';
import type { DomainEvent, MessagePlan } from './message-plan.js';
import type { MessagePlanProcessor } from './message-plan-processor.js';
import { OTPMessagePlanProcessor } from './otp-message-plan-processor.js';
import type { ActorHandlerResult } from './otp-types.js';
import { isActorHandlerResult } from './otp-types.js';
import { isMessagePlan } from './utils/validation.js';

const log = Logger.namespace('PURE_BEHAVIOR_HANDLER');

/**
 * Pure Actor Message Handler signature following FRAMEWORK-STANDARD
 * No context parameter - only actor instance and dependencies
 */
export type PureMessageHandler<TMessage, TDomainEvent = DomainEvent> = (params: {
  readonly message: TMessage;
  readonly actor: ActorInstance;
  readonly dependencies: ActorDependencies;
}) => MessagePlan<TDomainEvent> | Promise<MessagePlan<TDomainEvent>> | void | Promise<void>;

/**
 * Pure Actor Behavior Interface (FRAMEWORK-STANDARD compliant)
 */
export interface PureActorBehavior<TMessage = ActorMessage, TDomainEvent = DomainEvent> {
  readonly onMessage: PureMessageHandler<TMessage, TDomainEvent>;
  readonly onStart?: (params: {
    readonly actor: ActorInstance;
    readonly dependencies: ActorDependencies;
  }) => MessagePlan<TDomainEvent> | Promise<MessagePlan<TDomainEvent>> | void | Promise<void>;
  readonly onStop?: (params: {
    readonly actor: ActorInstance;
    readonly dependencies: ActorDependencies;
  }) => Promise<void> | void;
}

/**
 * Type guard to validate unknown values as MessagePlan or ActorHandlerResult
 * Updated to support both MessagePlan (domain events/instructions) and OTP results
 */
function isValidMessagePlan(
  value: unknown
): value is MessagePlan | ActorHandlerResult<unknown, unknown> {
  if (value === null || value === undefined) {
    return true; // void is valid
  }

  // Check if it's a MessagePlan (domain events, send/ask instructions)
  if (isMessagePlan(value)) {
    return true;
  }

  // Check if it's an OTP ActorHandlerResult (context, emit, reply, etc.)
  if (isActorHandlerResult(value)) {
    return true;
  }

  return false;
}

/**
 * Pure Actor Behavior Handler
 *
 * Processes pure actor behaviors following FRAMEWORK-STANDARD:
 * - Handles MessagePlan responses from pure behaviors
 * - Ensures type safety with proper type guards
 * - Processes business message correlation for ask patterns
 * - No direct method calls - all message-based
 */
export class PureActorBehaviorHandler {
  private readonly messagePlanProcessor: MessagePlanProcessor;
  private readonly otpMessagePlanProcessor = new OTPMessagePlanProcessor();

  constructor(messagePlanProcessor: MessagePlanProcessor) {
    this.messagePlanProcessor = messagePlanProcessor;

    log.debug('PureActorBehaviorHandler initialized', {
      processorType: messagePlanProcessor.constructor.name,
    });
  }

  /**
   * Handle a message with a pure actor behavior
   *
   * @param behavior - Pure actor behavior to execute
   * @param message - Incoming message
   * @param machine - XState machine actor for state access
   * @param dependencies - Pure actor dependencies
   */
  async handleMessage<TMessage, TDomainEvent>(
    behavior: PureActorBehavior<TMessage, TDomainEvent>,
    message: TMessage,
    actor: ActorInstance,
    dependencies: ActorDependencies
  ): Promise<void> {
    const messageType = this.getMessageType(message);

    log.debug('Handling message with pure behavior', {
      messageType,
      actorId: dependencies.actorId,
      machineId: actor.id,
    });

    try {
      // Execute pure behavior onMessage handler
      log.debug('🔍 BEHAVIOR HANDLER: Executing behavior.onMessage', {
        messageType,
        actorId: dependencies.actorId,
        machineId: actor.id,
      });

      const messagePlan = await behavior.onMessage({
        message,
        actor,
        dependencies,
      });

      log.debug('🔍 BEHAVIOR HANDLER: Behavior returned result', {
        messageType,
        actorId: dependencies.actorId,
        resultType: typeof messagePlan,
        result: messagePlan,
        isNull: messagePlan === null,
        isUndefined: messagePlan === undefined,
      });

      // Validate MessagePlan response
      if (!isValidMessagePlan(messagePlan)) {
        log.debug('🔍 BEHAVIOR HANDLER: Invalid MessagePlan detected', {
          messageType,
          actorId: dependencies.actorId,
          messagePlan,
        });
        throw new Error(
          `Invalid MessagePlan returned from behavior: ${JSON.stringify(messagePlan)}`
        );
      }

      // Process result if returned (MessagePlan or ActorHandlerResult)
      if (messagePlan !== undefined && messagePlan !== null) {
        log.debug('🔍 BEHAVIOR HANDLER: Processing result', {
          messageType,
          actorId: dependencies.actorId,
          resultType: typeof messagePlan,
          isActorHandlerResult: isActorHandlerResult(messagePlan),
          isMessagePlan: isMessagePlan(messagePlan),
        });

        // Check if it's an OTP ActorHandlerResult
        if (isActorHandlerResult(messagePlan)) {
          log.debug('🔍 BEHAVIOR HANDLER: Processing OTP ActorHandlerResult', {
            messageType,
            actorId: dependencies.actorId,
            otpResult: messagePlan,
          });

          // Extract correlationId safely from message if it's an ActorMessage
          let correlationId: string | undefined;
          if (message && typeof message === 'object' && '_correlationId' in message) {
            const messageWithCorrelation = message as Record<string, unknown>;
            if (typeof messageWithCorrelation._correlationId === 'string') {
              correlationId = messageWithCorrelation._correlationId;
            }
          }

          await this.otpMessagePlanProcessor.processOTPResult(
            messagePlan,
            dependencies.actorId,
            actor,
            dependencies,
            correlationId,
            messageType
          );
        } else {
          // Process as regular MessagePlan
          log.debug('🔍 BEHAVIOR HANDLER: Processing regular MessagePlan', {
            messageType,
            actorId: dependencies.actorId,
            messagePlan,
          });
          await this.messagePlanProcessor.processMessagePlan(messagePlan, dependencies);
        }
      } else {
        log.debug('🔍 BEHAVIOR HANDLER: No result to process', {
          messageType,
          actorId: dependencies.actorId,
        });
      }

      log.debug('Message processed successfully', {
        messageType,
        actorId: dependencies.actorId,
        hadMessagePlan: messagePlan !== undefined,
      });
    } catch (error) {
      // Follow FRAMEWORK-STANDARD: Let supervisor handle errors, don't catch
      log.error('Error in pure behavior message handler', {
        error: error instanceof Error ? error.message : 'Unknown error',
        messageType,
        actorId: dependencies.actorId,
      });

      throw error; // Re-throw for supervisor handling
    }
  }

  /**
   * Handle actor start lifecycle with pure behavior
   */
  async handleStart<TDomainEvent>(
    behavior: PureActorBehavior<unknown, TDomainEvent>,
    actor: ActorInstance,
    dependencies: ActorDependencies
  ): Promise<void> {
    if (!behavior.onStart) {
      return;
    }

    log.debug('Handling start with pure behavior', {
      actorId: dependencies.actorId,
    });

    try {
      const messagePlan = await behavior.onStart({
        actor,
        dependencies,
      });

      if (!isValidMessagePlan(messagePlan)) {
        throw new Error(
          `Invalid MessagePlan returned from onStart: ${JSON.stringify(messagePlan)}`
        );
      }

      if (messagePlan !== undefined && messagePlan !== null) {
        await this.messagePlanProcessor.processMessagePlan(messagePlan, dependencies);
      }
    } catch (error) {
      log.error('Error in pure behavior start handler', {
        error: error instanceof Error ? error.message : 'Unknown error',
        actorId: dependencies.actorId,
      });

      throw error;
    }
  }

  /**
   * Handle actor stop lifecycle with pure behavior
   */
  async handleStop<TDomainEvent>(
    behavior: PureActorBehavior<unknown, TDomainEvent>,
    actor: ActorInstance,
    dependencies: ActorDependencies
  ): Promise<void> {
    if (!behavior.onStop) {
      return;
    }

    log.debug('Handling stop with pure behavior', {
      actorId: dependencies.actorId,
    });

    try {
      await behavior.onStop({
        actor,
        dependencies,
      });
    } catch (error) {
      log.error('Error in pure behavior stop handler', {
        error: error instanceof Error ? error.message : 'Unknown error',
        actorId: dependencies.actorId,
      });

      throw error;
    }
  }

  /**
   * Extract message type for logging (type-safe)
   */
  private getMessageType(message: unknown): string {
    if (message && typeof message === 'object' && 'type' in message) {
      const messageObj = message as { type: unknown };
      return typeof messageObj.type === 'string' ? messageObj.type : 'unknown';
    }
    return 'unknown';
  }
}
