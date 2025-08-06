/**
 * @module actor-core/runtime/otp-message-plan-processor
 * @description Enhanced message plan processor with OTP state management patterns
 * @author AI Assistant - 2025-01-20
 */

import type { ActorInstance } from './actor-instance.js';
import type { ActorDependencies, ActorEnvelope, ActorMessage } from './actor-system.js';
import { validateAskResponse } from './ask-pattern-safeguards.js';
import { Logger } from './logger.js';
import type { MessagePlan, SendInstruction } from './message-plan.js';
import type { ActorHandlerResult, BehaviorFunction } from './otp-types.js';
import { processMessagePlan, type RuntimeContext } from './plan-interpreter.js';
import { DefaultMessagePlanProcessor } from './pure-behavior-handler.js';

const log = Logger.namespace('OTP_MESSAGE_PLAN_PROCESSOR');

// Define specific message types for OTP operations
interface BehaviorChangedMessage extends ActorMessage {
  type: 'BEHAVIOR_CHANGED';
  actorId: string;
}

/**
 * Type guard to check if a message is a SendInstruction
 */
function isSendInstruction(message: unknown): message is SendInstruction {
  return (
    typeof message === 'object' &&
    message !== null &&
    'to' in message &&
    'tell' in message &&
    'mode' in message &&
    typeof (message as Record<string, unknown>).to === 'object' &&
    typeof (message as Record<string, unknown>).tell === 'object'
  );
}

/**
 * Enhanced message plan processor that handles both traditional MessagePlan
 * and OTP state management patterns (state updates, behavior switching)
 */
export class OTPMessagePlanProcessor extends DefaultMessagePlanProcessor {
  // Track behavior switches for actors
  private behaviorSwitches = new Map<string, BehaviorFunction<unknown>>();

  /**
   * Enhanced OTP result processor with ask pattern response support
   * Processes context updates, behavior switching, and responses
   */
  async processOTPResult<TContext, TResponse>(
    result: ActorHandlerResult<TContext, TResponse>,
    actorId: string,
    actorInstance: ActorInstance,
    dependencies: ActorDependencies,
    correlationId?: string,
    originalMessageType?: string // Add original message type for response compatibility
  ): Promise<void> {
    log.debug('Processing OTP result', {
      actorId,
      hasContext: result.context !== undefined,
      hasReply: result.reply !== undefined,
      hasBehavior: result.behavior !== undefined,
      hasEmit: result.emit !== undefined,
      emitLength: result.emit ? result.emit.length : 0,
      correlationId,
      originalMessageType,
    });

    // Validate ask pattern response
    validateAskResponse(result, actorId, originalMessageType || 'UNKNOWN', correlationId);

    log.debug('🔍 OTP PROCESSOR DEBUG: processOTPResult called', {
      actorId,
      hasEmit: result.emit !== undefined,
      emitLength: result.emit ? result.emit.length : 0,
      emitArray: result.emit,
    });

    try {
      // Apply context update
      if (result.context !== undefined) {
        log.debug('🔍 OTP STEP DEBUG: Starting context update', { actorId });
        try {
          await this.applyContextUpdate(result.context, actorId, actorInstance);
          log.debug('🔍 OTP STEP DEBUG: Context update completed', { actorId });
        } catch (error) {
          log.debug('🔍 OTP STEP DEBUG: Context update failed', { actorId, error });
          throw error;
        }
      }

      // Apply behavior switching
      if (result.behavior !== undefined) {
        log.debug('🔍 OTP STEP DEBUG: Starting behavior switch', { actorId });
        try {
          await this.applyBehaviorSwitch(
            result.behavior as BehaviorFunction<unknown>,
            actorId,
            dependencies
          );
          log.debug('🔍 OTP STEP DEBUG: Behavior switch completed', { actorId });
        } catch (error) {
          log.debug('🔍 OTP STEP DEBUG: Behavior switch failed', { actorId, error });
          throw error;
        }
      }

      // Send response for ask pattern using reply field (Phase 2.1)
      const replyValue = result.reply;
      if (replyValue !== undefined && correlationId) {
        log.debug('🔍 OTP STEP DEBUG: Starting reply send', {
          actorId,
          correlationId,
          usingReplyField: result.reply !== undefined,
        });
        try {
          await this.sendResponse(
            replyValue,
            correlationId,
            dependencies,
            originalMessageType || 'RESPONSE' // Use original message type or fallback to 'RESPONSE'
          );
          log.debug('🔍 OTP STEP DEBUG: Reply send completed', { actorId, correlationId });
        } catch (error) {
          log.debug('🔍 OTP STEP DEBUG: Reply send failed', { actorId, correlationId, error });
          throw error;
        }
      }

      // ✅ UNIFIED API DESIGN Phase 2.1: Process emit arrays for event emission
      if (result.emit && result.emit.length > 0) {
        log.debug('🔍 OTP STEP DEBUG: Starting emit processing', {
          actorId,
          emitCount: result.emit.length,
        });
        try {
          await this.processEmitArray(result.emit, actorId, dependencies);
          log.debug('🔍 OTP STEP DEBUG: Emit processing completed', { actorId });
        } catch (error) {
          log.debug('🔍 OTP STEP DEBUG: Emit processing failed', { actorId, error });
          throw error;
        }
      } else {
        log.debug('🔍 OTP STEP DEBUG: No emit arrays to process', {
          actorId,
          hasEmit: result.emit !== undefined,
          emitLength: result.emit ? result.emit.length : 0,
        });
      }

      log.debug('OTP result processing completed successfully', { actorId });
    } catch (error) {
      log.error('Failed to process OTP result', {
        actorId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Apply context update to actor context (OTP gen_server pattern)
   */
  private async applyContextUpdate<TContext>(
    newContext: TContext,
    actorId: string,
    actorInstance: ActorInstance
  ): Promise<void> {
    log.debug('🔍 CONTEXT UPDATE: Starting context update', {
      actorId,
      hasContext: newContext !== undefined,
      newContext,
      currentActorState: actorInstance.getSnapshot()?.value,
      currentActorContext: actorInstance.getSnapshot()?.context,
    });

    log.debug('Applying context update', { actorId, hasContext: newContext !== undefined });

    try {
      // Check if this is a ContextActor that supports direct context updates
      if (actorInstance.getType?.() === 'context') {
        // Import dynamically to avoid circular dependencies
        const { isContextActor } = await import('./context-actor.js');

        if (isContextActor(actorInstance)) {
          log.debug('🔍 CONTEXT UPDATE: Direct update for ContextActor', {
            actorId,
            newContext,
          });

          // Update context directly on ContextActor
          // TypeScript doesn't know about updateContext on ActorInstance
          // but we've already verified it's a ContextActor
          (
            actorInstance as import('./context-actor.js').ContextActor<typeof newContext>
          ).updateContext(newContext);

          log.debug('🔍 CONTEXT UPDATE: Context updated directly', {
            actorId,
            updatedContext: actorInstance.getSnapshot()?.context,
          });
        }
      } else {
        // For XState machines, send UPDATE_CONTEXT event
        log.debug('🔍 CONTEXT UPDATE: Sending UPDATE_CONTEXT event to XState machine', {
          actorId,
          eventType: 'UPDATE_CONTEXT',
          newContext,
        });

        actorInstance.send({
          type: 'UPDATE_CONTEXT',
          context: newContext,
          _timestamp: Date.now(),
          _version: '1.0.0',
        } as ActorMessage);

        // Check if context actually updated
        const updatedSnapshot = actorInstance.getSnapshot();
        log.debug('🔍 CONTEXT UPDATE: After sending UPDATE_CONTEXT', {
          actorId,
          previousContext: actorInstance.getSnapshot()?.context,
          updatedContext: updatedSnapshot?.context,
          contextChanged:
            JSON.stringify(updatedSnapshot?.context) !==
            JSON.stringify(actorInstance.getSnapshot()?.context),
        });
      }

      log.debug('Context update applied successfully', { actorId });
    } catch (error) {
      log.debug('🔍 CONTEXT UPDATE: ERROR during context update', {
        actorId,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined,
      });

      log.error('Failed to apply context update', {
        actorId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Apply behavior switching (becomes pattern)
   */
  private async applyBehaviorSwitch(
    newBehavior: BehaviorFunction<unknown>,
    actorId: string,
    dependencies: ActorDependencies
  ): Promise<void> {
    log.debug('Applying behavior switch', { actorId });

    try {
      // Store the new behavior for this actor
      this.behaviorSwitches.set(actorId, newBehavior);

      // Emit behavior change event
      const behaviorChangeEvent: BehaviorChangedMessage = {
        type: 'BEHAVIOR_CHANGED',
        actorId,
        _timestamp: Date.now(),
        _version: '2.0.0',
      };

      dependencies.emit(behaviorChangeEvent);

      log.debug('Behavior switch applied successfully', { actorId });
    } catch (error) {
      log.error('Failed to apply behavior switch', {
        actorId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Send response for ask pattern
   */
  private async sendResponse(
    response: unknown,
    correlationId: string,
    dependencies: ActorDependencies,
    messageType: string
  ): Promise<void> {
    log.debug('Sending response', { correlationId, hasResponse: response !== undefined });

    try {
      // Create response message using flat structure
      // For arrays, wrap them in a payload property to preserve their structure
      const responseMessage: ActorMessage = {
        type: messageType,
        ...(Array.isArray(response)
          ? { payload: response }
          : typeof response === 'object' && response !== null
            ? response
            : { value: response }),
        _correlationId: correlationId,
        _timestamp: Date.now(),
        _version: '2.0.0',
      };

      // Use correlation manager to handle response (this is the correct mechanism for ask patterns)
      if (
        dependencies.correlationManager &&
        typeof dependencies.correlationManager === 'object' &&
        dependencies.correlationManager !== null &&
        'handleResponse' in dependencies.correlationManager &&
        typeof (dependencies.correlationManager as { handleResponse: unknown }).handleResponse ===
          'function'
      ) {
        (
          dependencies.correlationManager as {
            handleResponse: (correlationId: string, response: ActorMessage) => void;
          }
        ).handleResponse(correlationId, responseMessage);
      } else {
        // Fallback to emit if correlation manager not available
        dependencies.emit(responseMessage);
      }

      log.debug('Response sent successfully', { correlationId });
    } catch (error) {
      log.error('Failed to send response', {
        correlationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Process emit arrays for event emission
   */
  private async processEmitArray(
    emitArray: unknown[],
    actorId: string,
    dependencies: ActorDependencies
  ): Promise<void> {
    log.debug('Processing emit array', { actorId, emitCount: emitArray.length });
    log.debug('🔍 EMIT ARRAY DEBUG: Starting emit processing', {
      actorId,
      emitCount: emitArray.length,
      emitArray,
      dependenciesKeys: Object.keys(dependencies),
      hasEmitFunction: typeof dependencies.emit === 'function',
    });

    for (const message of emitArray) {
      try {
        log.debug('🔍 EMIT ARRAY DEBUG: Processing message', {
          actorId,
          messageType: (message as { type: string }).type,
          message,
        });

        // Ensure message is an object before spreading
        if (typeof message !== 'object' || message === null) {
          log.warn('Invalid emit message - not an object', { actorId, message });
          continue;
        }

        // 🎯 FIX: Check if this is a SendInstruction (has 'to', 'tell', 'mode' fields)
        if (isSendInstruction(message)) {
          log.debug('🔍 EMIT ARRAY DEBUG: Detected SendInstruction, processing as direct message', {
            actorId,
            targetActor: message.to,
            messageType: message.tell?.type,
            mode: message.mode,
          });

          // Process as SendInstruction - send message directly to target actor
          const sendInstruction = message; // Now properly typed as SendInstruction
          try {
            // Use the plan interpreter to process the SendInstruction correctly
            log.debug('🔍 EMIT ARRAY DEBUG: Using plan interpreter to process SendInstruction', {
              actorId,
              targetActorPath: sendInstruction.to.address.id,
              messageType: sendInstruction.tell?.type,
            });

            // Create a mini message plan with just this SendInstruction
            const messagePlan = [sendInstruction];

            // Use the plan interpreter to process it (this should handle NullActorRef resolution)
            const runtimeContext: RuntimeContext = {
              actor: dependencies.actor,
              emit: dependencies.emit,
              actorId,
              correlationManager:
                dependencies.correlationManager as RuntimeContext['correlationManager'],
            };

            await processMessagePlan(messagePlan, runtimeContext);
            log.debug('🔍 EMIT ARRAY DEBUG: SendInstruction processed successfully', {
              actorId,
              targetActor: sendInstruction.to,
              messageType: sendInstruction.tell?.type,
            });
          } catch (error) {
            log.error('🔍 EMIT ARRAY DEBUG: SendInstruction processing failed', {
              actorId,
              targetActor: sendInstruction.to,
              messageType: sendInstruction.tell?.type,
              error: error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : undefined,
            });
            console.error('❌ SendInstruction Error Details:', error);
          }
          continue; // Skip the regular event processing
        }

        // Ensure message has envelope fields
        const emitMessage = {
          ...(message as Record<string, unknown>),
          _correlationId:
            (message as ActorEnvelope)._correlationId ||
            `emit-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
          _timestamp: (message as ActorEnvelope)._timestamp || Date.now(),
          _version: (message as ActorEnvelope)._version || '2.0.0',
        } as ActorMessage;

        log.debug('🔍 EMIT ARRAY DEBUG: Message with correlationId', {
          actorId,
          messageType: emitMessage.type,
          hasCorrelationId: !!emitMessage._correlationId,
          correlationId: emitMessage._correlationId,
        });

        // Ensure correlationId exists before proceeding
        if (!emitMessage._correlationId) {
          log.error('Failed to ensure correlationId for emit message', {
            actorId,
            messageType: emitMessage.type,
          });
          continue;
        }

        // ✅ UNIFIED API DESIGN Phase 2.1: Use proper event emission system for subscriptions
        // Emit events should go through dependencies.emit(), not correlation manager
        log.debug('🔍 EMIT ARRAY DEBUG: Calling dependencies.emit', {
          actorId,
          messageType: emitMessage.type,
          emitFunctionType: typeof dependencies.emit,
        });

        dependencies.emit(emitMessage);

        log.debug('🔍 EMIT ARRAY DEBUG: dependencies.emit called successfully', {
          actorId,
          messageType: emitMessage.type,
        });

        log.debug('Emit array message processed successfully', {
          actorId,
          messageType: emitMessage.type,
        });
      } catch (error) {
        log.debug('🔍 EMIT ARRAY DEBUG: Error during message processing', {
          actorId,
          messageType: (message as { type: string }).type,
          error,
        });
        log.error('Failed to process emit array message', {
          actorId,
          messageType: (message as { type: string }).type,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    log.debug('🔍 EMIT ARRAY DEBUG: Emit array processing completed', {
      actorId,
      emitCount: emitArray.length,
    });

    log.debug('Emit array processing completed', { actorId, emitCount: emitArray.length });
  }

  /**
   * Get current behavior for an actor (for behavior switching)
   */
  getCurrentBehavior(actorId: string): BehaviorFunction<unknown> | undefined {
    return this.behaviorSwitches.get(actorId);
  }

  /**
   * Clear behavior switch for an actor (on actor stop)
   */
  clearBehaviorSwitch(actorId: string): void {
    this.behaviorSwitches.delete(actorId);

    log.debug('Cleared behavior switch for actor', { actorId });
  }

  /**
   * Override parent processMessagePlan to also handle OTP patterns
   */
  async processMessagePlan<TEmitted>(
    messagePlan: MessagePlan<TEmitted> | undefined,
    dependencies: ActorDependencies
  ): Promise<void> {
    // First, process traditional MessagePlan
    await super.processMessagePlan(messagePlan, dependencies);

    // Additional OTP-specific processing would go here if needed
    // (currently all OTP processing is handled via processOTPResult)
  }
}
