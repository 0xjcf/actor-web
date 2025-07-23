/**
 * @module actor-core/runtime/plan-interpreter
 * @description Plan Interpreter Implementation for OTP-style Actor Framework
 *
 * This module implements the runtime interpreter that executes message plans,
 * transforming declarative communication intentions into actual system actions.
 *
 * Key Features:
 * - Domain event fan-out to both XState machine and actor system
 * - Send instruction routing for point-to-point communication
 * - Ask instruction processing with correlation management
 * - Comprehensive error handling and validation
 * - Async processing support for network operations
 *
 * @author OTP Implementation Team
 * @version 1.0.0
 */

import type { Actor, AnyStateMachine } from 'xstate';
import { Logger } from './logger.js';
import type {
  ActorMessage,
  AskInstruction,
  DomainEvent,
  MessagePlan,
  SendInstruction,
} from './message-plan.js';

// Import type guards from message-plan
import {
  isAskInstruction as validateAskInstruction,
  isDomainEvent as validateDomainEvent,
  isMessagePlan as validateMessagePlan,
  isSendInstruction as validateSendInstruction,
} from './message-plan.js';

const log = Logger.namespace('PLAN_INTERPRETER');

// ============================================================================
// RUNTIME CONTEXT TYPES
// ============================================================================

/**
 * Runtime context passed to the plan interpreter
 * Contains the necessary dependencies for executing message plans
 */
export interface RuntimeContext {
  /** XState machine actor for state transitions */
  readonly machine: Actor<AnyStateMachine>;
  /** Event emission function for actor system broadcasting */
  readonly emit: (event: DomainEvent) => void | Promise<void>;
  /** Actor identifier for logging and debugging */
  readonly actorId?: string;
  /** Optional correlation manager for ask pattern */
  readonly correlationManager?: CorrelationManager;
}

/**
 * Correlation manager interface for ask pattern support
 * This will be fully implemented in Task 1.3
 */
export interface CorrelationManager {
  generateId(): string;
  registerRequest<T>(correlationId: string, timeout: number): Promise<T>;
  handleResponse(correlationId: string, response: ActorMessage): void;
  handleTimeout(correlationId: string): void;
}

/**
 * Plan execution result for tracking and debugging
 */
export interface PlanExecutionResult {
  /** Was the plan executed successfully */
  success: boolean;
  /** Number of individual instructions executed */
  instructionsExecuted: number;
  /** Number of domain events emitted */
  domainEventsEmitted: number;
  /** Number of send instructions processed */
  sendInstructionsProcessed: number;
  /** Number of ask instructions processed */
  askInstructionsProcessed: number;
  /** Any errors that occurred during execution */
  errors: Error[];
  /** Execution time in milliseconds */
  executionTimeMs: number;
}

// ============================================================================
// CORE PLAN INTERPRETER
// ============================================================================

/**
 * Process a message plan and execute all contained instructions
 *
 * This is the core runtime function that transforms declarative message plans
 * into actual system behavior. It handles all message plan types and provides
 * comprehensive error handling.
 *
 * @param plan - The message plan to execute (can be void)
 * @param context - Runtime context with machine, emit, and other dependencies
 * @returns Promise<PlanExecutionResult> - Execution result with metrics and errors
 */
export async function processMessagePlan<TDomainEvent extends DomainEvent>(
  plan: MessagePlan<TDomainEvent> | undefined,
  context: RuntimeContext
): Promise<PlanExecutionResult> {
  const startTime = Date.now();
  const result: PlanExecutionResult = {
    success: false,
    instructionsExecuted: 0,
    domainEventsEmitted: 0,
    sendInstructionsProcessed: 0,
    askInstructionsProcessed: 0,
    errors: [],
    executionTimeMs: 0,
  };

  try {
    // Handle void plans (no action required)
    if (plan === null || plan === undefined) {
      log.debug('Processing void message plan - no action required');
      result.success = true;
      result.executionTimeMs = Date.now() - startTime;
      return result;
    }

    // Validate the message plan
    if (!validateMessagePlan(plan)) {
      const error = new Error(`Invalid message plan structure: ${JSON.stringify(plan)}`);
      log.error('Invalid message plan provided', { plan, error });
      result.errors.push(error);
      result.executionTimeMs = Date.now() - startTime;
      return result;
    }

    // Convert single plans to array for uniform processing
    const plans = Array.isArray(plan) ? plan : [plan];

    log.debug('Processing message plan', {
      planCount: plans.length,
      actorId: context.actorId,
      plans: plans.map((p) =>
        validateDomainEvent(p) ? { type: p.type } : { instruction: typeof p }
      ),
    });

    // Process each instruction in sequence
    for (let i = 0; i < plans.length; i++) {
      const instruction = plans[i];

      try {
        if (validateDomainEvent(instruction)) {
          await processDomainEvent(instruction, context);
          result.domainEventsEmitted++;
        } else if (validateSendInstruction(instruction)) {
          await processSendInstruction(instruction, context);
          result.sendInstructionsProcessed++;
        } else if (validateAskInstruction(instruction)) {
          const instructionResult = await processAskInstruction(instruction, context);
          result.askInstructionsProcessed++;
          // Accumulate results from ask instruction callbacks (but not instructionsExecuted - that's counted separately)
          result.domainEventsEmitted += instructionResult.domainEventsEmitted;
          result.sendInstructionsProcessed += instructionResult.sendInstructionsProcessed;
          result.askInstructionsProcessed += instructionResult.askInstructionsProcessed;
          result.errors.push(...instructionResult.errors);
          result.success = result.errors.length === 0;
        } else {
          const error = new Error(
            `Unknown instruction type at index ${i}: ${JSON.stringify(instruction)}`
          );
          log.error('Unknown instruction type', { instruction, index: i });
          result.errors.push(error);
          continue; // Skip this instruction but continue processing others
        }

        result.instructionsExecuted++;
      } catch (instructionError) {
        const error =
          instructionError instanceof Error
            ? instructionError
            : new Error(`Unknown error processing instruction at index ${i}`);

        log.error('Error processing instruction', {
          instruction,
          index: i,
          error: error.message,
        });
        result.errors.push(error);
      }
    }

    // Determine overall success
    result.success = result.errors.length === 0;

    if (result.success) {
      log.debug('Message plan processed successfully', {
        instructionsExecuted: result.instructionsExecuted,
        domainEventsEmitted: result.domainEventsEmitted,
        sendInstructionsProcessed: result.sendInstructionsProcessed,
        askInstructionsProcessed: result.askInstructionsProcessed,
      });
    } else {
      log.warn('Message plan processed with errors', {
        errorCount: result.errors.length,
        instructionsExecuted: result.instructionsExecuted,
      });
    }
  } catch (globalError) {
    const error =
      globalError instanceof Error ? globalError : new Error('Unknown error in plan processing');

    log.error('Global error in message plan processing', { error: error.message });
    result.errors.push(error);
    result.success = false;
  }

  result.executionTimeMs = Date.now() - startTime;
  return result;
}

// ============================================================================
// INSTRUCTION PROCESSORS
// ============================================================================

/**
 * Process a domain event instruction
 * Fan-out: Send to both XState machine and actor event system
 */
async function processDomainEvent(event: DomainEvent, context: RuntimeContext): Promise<void> {
  log.debug('Processing domain event', {
    eventType: event.type,
    actorId: context.actorId,
  });

  try {
    // Send to XState machine for state transitions
    context.machine.send(event);

    // Emit to actor system for subscriber notifications
    const emitResult = context.emit(event);

    // Handle async emit functions
    if (emitResult && typeof emitResult.then === 'function') {
      await emitResult;
    }

    log.debug('Domain event fan-out completed', {
      eventType: event.type,
      actorId: context.actorId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error in domain event fan-out', {
      eventType: event.type,
      error: errorMessage,
      actorId: context.actorId,
    });
    throw new Error(`Domain event fan-out failed for ${event.type}: ${errorMessage}`);
  }
}

/**
 * Process a send instruction (point-to-point tell pattern)
 */
async function processSendInstruction(
  instruction: SendInstruction,
  context: RuntimeContext
): Promise<void> {
  log.debug('Processing send instruction', {
    targetActor: instruction.to.id,
    messageType: instruction.tell.type,
    mode: instruction.mode || 'fireAndForget',
    actorId: context.actorId,
  });

  try {
    // Validate target actor
    if (!instruction.to || typeof instruction.to.send !== 'function') {
      throw new Error('Invalid target actor reference in send instruction');
    }

    // Send message to target actor
    await instruction.to.send(instruction.tell);

    log.debug('Send instruction completed', {
      targetActor: instruction.to.id,
      messageType: instruction.tell.type,
      actorId: context.actorId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error in send instruction', {
      targetActor: instruction.to?.id || 'unknown',
      messageType: instruction.tell?.type || 'unknown',
      error: errorMessage,
      actorId: context.actorId,
    });
    throw new Error(`Send instruction failed: ${errorMessage}`);
  }
}

/**
 * Process an ask instruction (request-response pattern)
 * Returns accumulated results from callback processing
 */
async function processAskInstruction(
  instruction: AskInstruction,
  context: RuntimeContext
): Promise<PlanExecutionResult> {
  log.debug('Processing ask instruction', {
    targetActor: instruction.to.id,
    messageType: instruction.ask.type,
    timeout: instruction.timeout,
    actorId: context.actorId,
  });

  // Initialize result for callback accumulation
  const callbackResult: PlanExecutionResult = {
    success: true,
    instructionsExecuted: 0,
    domainEventsEmitted: 0,
    sendInstructionsProcessed: 0,
    askInstructionsProcessed: 0,
    errors: [],
    executionTimeMs: 0,
  };

  try {
    // Validate target actor
    if (!instruction.to || typeof instruction.to.ask !== 'function') {
      throw new Error('Invalid target actor reference in ask instruction');
    }

    // For now, implement basic ask without full correlation management
    // This will be enhanced in Task 1.3 with proper correlation manager
    const response = await instruction.to.ask(instruction.ask, instruction.timeout);

    // Process success callback if provided
    if (instruction.onOk) {
      let callbackEvent: DomainEvent;

      if (typeof instruction.onOk === 'function') {
        callbackEvent = instruction.onOk(response);
      } else {
        callbackEvent = instruction.onOk;
      }

      // Validate callback result
      if (!validateDomainEvent(callbackEvent)) {
        throw new Error('Ask instruction onOk callback must return a valid domain event');
      }

      // Recursively process the callback event and accumulate results
      const recursiveResult = await processMessagePlan(callbackEvent, context);

      // Accumulate results from recursive processing
      callbackResult.instructionsExecuted += recursiveResult.instructionsExecuted;
      callbackResult.domainEventsEmitted += recursiveResult.domainEventsEmitted;
      callbackResult.sendInstructionsProcessed += recursiveResult.sendInstructionsProcessed;
      callbackResult.askInstructionsProcessed += recursiveResult.askInstructionsProcessed;
      callbackResult.errors.push(...recursiveResult.errors);
      callbackResult.success = recursiveResult.success && callbackResult.errors.length === 0;

      log.debug('Ask instruction completed successfully with callback', {
        targetActor: instruction.to.id,
        messageType: instruction.ask.type,
        callbackEventType: callbackEvent.type,
        actorId: context.actorId,
        callbackResults: recursiveResult,
      });
    } else {
      log.debug('Ask instruction completed successfully without callback', {
        targetActor: instruction.to.id,
        messageType: instruction.ask.type,
        actorId: context.actorId,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    log.error('Error in ask instruction', {
      targetActor: instruction.to?.id || 'unknown',
      messageType: instruction.ask?.type || 'unknown',
      error: errorMessage,
      actorId: context.actorId,
    });

    // Handle error callback if provided
    if (instruction.onError) {
      try {
        let errorEvent: DomainEvent;

        if (typeof instruction.onError === 'function') {
          errorEvent = instruction.onError(
            error instanceof Error ? error : new Error(errorMessage)
          );
        } else {
          errorEvent = instruction.onError;
        }

        // Validate error callback result
        if (!validateDomainEvent(errorEvent)) {
          throw new Error('Ask instruction onError callback must return a valid domain event');
        }

        // Process error callback and accumulate results
        const errorResult = await processMessagePlan(errorEvent, context);
        callbackResult.instructionsExecuted += errorResult.instructionsExecuted;
        callbackResult.domainEventsEmitted += errorResult.domainEventsEmitted;
        callbackResult.sendInstructionsProcessed += errorResult.sendInstructionsProcessed;
        callbackResult.askInstructionsProcessed += errorResult.askInstructionsProcessed;
        callbackResult.errors.push(...errorResult.errors);

        log.debug('Ask instruction error handled with callback', {
          targetActor: instruction.to?.id || 'unknown',
          messageType: instruction.ask?.type || 'unknown',
          errorEventType: errorEvent.type,
          actorId: context.actorId,
        });
      } catch (callbackError) {
        const callbackErrorMsg =
          callbackError instanceof Error ? callbackError.message : 'Unknown callback error';
        log.error('Error in ask instruction error callback', {
          originalError: errorMessage,
          callbackError: callbackErrorMsg,
          actorId: context.actorId,
        });
        callbackResult.errors.push(
          callbackError instanceof Error ? callbackError : new Error(callbackErrorMsg)
        );
      }
    }

    // Add the original error
    callbackResult.errors.push(error instanceof Error ? error : new Error(errorMessage));
    callbackResult.success = false;
    throw error; // Re-throw to maintain error behavior
  }

  return callbackResult;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a mock runtime context for testing
 * This is useful for unit tests and development
 */
export function createMockRuntimeContext(overrides?: Partial<RuntimeContext>): RuntimeContext {
  const mockMachine = {
    send: (event: DomainEvent) => {
      log.debug('Mock machine received event', { eventType: event.type });
    },
  } as Actor<AnyStateMachine>;

  const mockEmit = (event: DomainEvent) => {
    log.debug('Mock emit called', { eventType: event.type });
  };

  return {
    machine: mockMachine,
    emit: mockEmit,
    actorId: 'test-actor',
    ...overrides,
  };
}

/**
 * Validate runtime context has all required dependencies
 */
export function validateRuntimeContext(context: RuntimeContext): string[] {
  const errors: string[] = [];

  if (!context.machine) {
    errors.push('Runtime context missing machine');
  } else if (typeof context.machine.send !== 'function') {
    errors.push('Runtime context machine missing send method');
  }

  if (!context.emit) {
    errors.push('Runtime context missing emit function');
  } else if (typeof context.emit !== 'function') {
    errors.push('Runtime context emit is not a function');
  }

  return errors;
}

/**
 * Create plan execution metrics from result
 * Useful for monitoring and debugging
 */
export function createExecutionMetrics(result: PlanExecutionResult): Record<string, number> {
  return {
    success: result.success ? 1 : 0,
    instructionsExecuted: result.instructionsExecuted,
    domainEventsEmitted: result.domainEventsEmitted,
    sendInstructionsProcessed: result.sendInstructionsProcessed,
    askInstructionsProcessed: result.askInstructionsProcessed,
    errorCount: result.errors.length,
    executionTimeMs: result.executionTimeMs,
  };
}
