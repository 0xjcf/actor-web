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

import type { Actor, AnyStateMachine } from 'xstate';
import type { ActorDependencies, ActorMessage } from './actor-system.js';
import { Logger } from './logger.js';
import type { DomainEvent, MessagePlan } from './message-plan.js';
import { isMessagePlan } from './message-plan.js';
import type { RuntimeContext } from './plan-interpreter.js';

const log = Logger.namespace('PURE_BEHAVIOR_HANDLER');

/**
 * Pure Actor Message Handler signature following FRAMEWORK-STANDARD
 * No context parameter - only machine and dependencies
 */
export type PureMessageHandler<TMessage, TDomainEvent = DomainEvent> = (params: {
  readonly message: TMessage;
  readonly machine: Actor<AnyStateMachine>;
  readonly dependencies: ActorDependencies;
}) => MessagePlan<TDomainEvent> | Promise<MessagePlan<TDomainEvent>> | void | Promise<void>;

/**
 * Pure Actor Behavior Interface (FRAMEWORK-STANDARD compliant)
 */
export interface PureActorBehavior<TMessage = ActorMessage, TDomainEvent = DomainEvent> {
  readonly onMessage: PureMessageHandler<TMessage, TDomainEvent>;
  readonly onStart?: (params: {
    readonly machine: Actor<AnyStateMachine>;
    readonly dependencies: ActorDependencies;
  }) => MessagePlan<TDomainEvent> | Promise<MessagePlan<TDomainEvent>> | void | Promise<void>;
  readonly onStop?: (params: {
    readonly machine: Actor<AnyStateMachine>;
    readonly dependencies: ActorDependencies;
  }) => Promise<void> | void;
}

/**
 * Message Plan Processor Interface
 * Handles the execution of MessagePlan instructions
 */
export interface MessagePlanProcessor {
  processMessagePlan(plan: MessagePlan, dependencies: ActorDependencies): Promise<void>;
}

/**
 * Type guard to validate unknown values as MessagePlan
 */
function isValidMessagePlan(value: unknown): value is MessagePlan {
  if (value === null || value === undefined) {
    return true; // void is valid
  }

  return isMessagePlan(value);
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
    machine: Actor<AnyStateMachine>,
    dependencies: ActorDependencies
  ): Promise<void> {
    const messageType = this.getMessageType(message);

    log.debug('Handling message with pure behavior', {
      messageType,
      actorId: dependencies.actorId,
      machineId: machine.id,
    });

    try {
      // Execute pure behavior onMessage handler
      const messagePlan = await behavior.onMessage({
        message,
        machine,
        dependencies,
      });

      // Validate MessagePlan response
      if (!isValidMessagePlan(messagePlan)) {
        throw new Error(
          `Invalid MessagePlan returned from behavior: ${JSON.stringify(messagePlan)}`
        );
      }

      // Process MessagePlan if returned
      if (messagePlan !== undefined && messagePlan !== null) {
        await this.messagePlanProcessor.processMessagePlan(messagePlan, dependencies);
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
    machine: Actor<AnyStateMachine>,
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
        machine,
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
    machine: Actor<AnyStateMachine>,
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
        machine,
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

/**
 * Default Message Plan Processor Implementation
 *
 * Integrates with existing plan interpreter for comprehensive MessagePlan processing
 * following FRAMEWORK-STANDARD principles
 */
export class DefaultMessagePlanProcessor implements MessagePlanProcessor {
  async processMessagePlan(plan: MessagePlan, dependencies: ActorDependencies): Promise<void> {
    if (!plan) {
      return;
    }

    log.debug('Processing MessagePlan with integrated plan interpreter', {
      instructionCount: Array.isArray(plan) ? plan.length : 1,
      actorId: dependencies.actorId,
    });

    // Convert ActorDependencies to RuntimeContext for existing plan interpreter
    const runtimeContext = this.adaptDependenciesToRuntimeContext(dependencies);

    // Use existing comprehensive plan interpreter
    const { processMessagePlan: processExistingPlan } = await import('./plan-interpreter.js');
    const result = await processExistingPlan(plan, runtimeContext);

    // Log result for debugging
    if (result.success) {
      log.debug('MessagePlan processed successfully via plan interpreter', {
        instructionsExecuted: result.instructionsExecuted,
        domainEventsEmitted: result.domainEventsEmitted,
        sendInstructionsProcessed: result.sendInstructionsProcessed,
        askInstructionsProcessed: result.askInstructionsProcessed,
        executionTimeMs: result.executionTimeMs,
        actorId: dependencies.actorId,
      });
    } else {
      log.warn('MessagePlan processed with errors via plan interpreter', {
        errorCount: result.errors.length,
        errors: result.errors.map((err) => err.message),
        actorId: dependencies.actorId,
      });

      // Throw first error to maintain error propagation
      if (result.errors.length > 0) {
        throw result.errors[0];
      }
    }
  }

  /**
   * Adapter function to convert ActorDependencies to RuntimeContext
   * This allows us to reuse the existing comprehensive plan interpreter
   */
  private adaptDependenciesToRuntimeContext(dependencies: ActorDependencies): RuntimeContext {
    return {
      machine: dependencies.machine as Actor<AnyStateMachine>,
      emit: (event: DomainEvent) => {
        // Convert to the format expected by ActorDependencies.emit
        dependencies.emit(event);
      },
      actorId: dependencies.actorId,
      correlationManager: dependencies.correlationManager as RuntimeContext['correlationManager'],
    };
  }
}
