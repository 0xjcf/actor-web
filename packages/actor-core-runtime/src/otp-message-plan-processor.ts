/**
 * @module actor-core/runtime/otp-message-plan-processor
 * @description Enhanced message plan processor with OTP state management patterns
 * @author AI Assistant - 2025-01-20
 */

import type { Actor, AnyStateMachine } from 'xstate';
import type { ActorDependencies, ActorMessage } from './actor-system.js';
import { Logger } from './logger.js';
import type { MessagePlan } from './message-plan.js';
import type { ActorHandlerResult, BehaviorFunction, Effect } from './otp-types.js';
import { DefaultMessagePlanProcessor } from './pure-behavior-handler.js';

const log = Logger.namespace('OTP_MESSAGE_PLAN_PROCESSOR');

/**
 * Enhanced message plan processor that handles both traditional MessagePlan
 * and OTP state management patterns (state updates, behavior switching, effects)
 */
export class OTPMessagePlanProcessor extends DefaultMessagePlanProcessor {
  // Track behavior switches for actors
  private behaviorSwitches = new Map<string, BehaviorFunction<unknown>>();

  // Track pending effects for actors
  private pendingEffects = new Map<string, Effect[]>();

  /**
   * Enhanced OTP result processor with ask pattern response support
   * Processes context updates, behavior switching, effects, and responses
   */
  async processOTPResult<TContext, TResponse>(
    result: ActorHandlerResult<TContext, TResponse>,
    actorId: string,
    machine: Actor<AnyStateMachine>,
    dependencies: ActorDependencies,
    correlationId?: string,
    originalMessageType?: string // Add original message type for response compatibility
  ): Promise<void> {
    console.log('🔍 OTP DEBUG: processOTPResult called', {
      actorId,
      hasContext: result.context !== undefined,
      hasResponse: result.response !== undefined,
      hasBehavior: result.behavior !== undefined,
      hasEffects: result.effects !== undefined,
      correlationId,
      originalMessageType,
    });

    log.debug('Processing OTP result', {
      actorId,
      hasContext: result.context !== undefined,
      hasResponse: result.response !== undefined,
      hasBehavior: result.behavior !== undefined,
      hasEffects: result.effects !== undefined,
      correlationId,
      originalMessageType,
    });

    try {
      // Apply context update
      if (result.context !== undefined) {
        await this.applyContextUpdate(result.context, actorId, machine);
      }

      // Apply behavior switching
      if (result.behavior !== undefined) {
        await this.applyBehaviorSwitch(result.behavior, actorId, dependencies);
      }

      // Send response for ask pattern (use original message type)
      if (result.response !== undefined && correlationId) {
        await this.sendResponse(
          result.response,
          correlationId,
          dependencies,
          originalMessageType || 'RESPONSE' // Use original message type or fallback to 'RESPONSE'
        );
      }

      // Execute effects
      if (result.effects && result.effects.length > 0) {
        await this.executeEffects(result.effects, actorId, dependencies);
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
    machine: Actor<AnyStateMachine>
  ): Promise<void> {
    log.debug('Applying context update', { actorId, hasContext: newContext !== undefined });

    try {
      // Send context update event to XState machine
      machine.send({
        type: 'UPDATE_CONTEXT',
        context: newContext,
      });

      log.debug('Context update applied successfully', { actorId });
    } catch (error) {
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
      const behaviorChangeEvent: ActorMessage = {
        type: 'BEHAVIOR_CHANGED',
        payload: { actorId, timestamp: Date.now() },
        timestamp: Date.now(),
        version: '1.0.0',
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
    console.log('🔍 OTP DEBUG: sendResponse called', {
      correlationId,
      messageType,
      hasResponse: response !== undefined,
      response,
    });

    log.debug('Sending response', { correlationId, hasResponse: response !== undefined });

    try {
      // Create response message (cast to JsonValue for ActorMessage compatibility)
      const responseMessage: ActorMessage = {
        type: messageType,
        payload: response as import('./actor-system.js').JsonValue,
        correlationId,
        timestamp: Date.now(),
        version: '1.0.0',
      };

      console.log('🔍 OTP DEBUG: Created response message:', responseMessage);

      // Use correlation manager to handle response (this is the correct mechanism for ask patterns)
      if (
        dependencies.correlationManager &&
        typeof dependencies.correlationManager === 'object' &&
        dependencies.correlationManager !== null &&
        'handleResponse' in dependencies.correlationManager &&
        typeof (dependencies.correlationManager as { handleResponse: unknown }).handleResponse ===
          'function'
      ) {
        console.log('🔍 OTP DEBUG: Using correlationManager.handleResponse');
        (
          dependencies.correlationManager as {
            handleResponse: (correlationId: string, response: ActorMessage) => void;
          }
        ).handleResponse(correlationId, responseMessage);
      } else {
        console.log('🔍 OTP DEBUG: Fallback to dependencies.emit');
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
   * Execute effects with supervision
   */
  private async executeEffects(
    effects: Effect[],
    actorId: string,
    dependencies: ActorDependencies
  ): Promise<void> {
    log.debug('Executing effects', { actorId, effectCount: effects.length });

    for (let i = 0; i < effects.length; i++) {
      const effect = effects[i];

      try {
        // Execute effect with supervision
        const result = effect();

        // Handle async effects
        if (result && typeof result.then === 'function') {
          await result;
        }

        log.debug('Effect executed successfully', { actorId, effectIndex: i });
      } catch (error) {
        log.warn('Effect execution failed (supervised)', {
          actorId,
          effectIndex: i,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        // Emit effect failure event but don't crash actor
        const effectFailureEvent: ActorMessage = {
          type: 'EFFECT_FAILED',
          payload: {
            actorId,
            effectIndex: i,
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
          version: '1.0.0',
        };

        dependencies.emit(effectFailureEvent);
      }
    }

    log.debug('Effects execution completed', { actorId, effectCount: effects.length });
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
    this.pendingEffects.delete(actorId);

    log.debug('Cleared behavior switch and effects for actor', { actorId });
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
