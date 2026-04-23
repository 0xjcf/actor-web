import type { ActorDependencies } from './actor-system.js';
import { Logger } from './logger.js';
import type { DomainEvent, MessagePlan } from './message-plan.js';
import {
  processMessagePlan as processExistingPlan,
  type RuntimeContext,
} from './plan-interpreter.js';

const log = Logger.namespace('MESSAGE_PLAN_PROCESSOR');

export interface MessagePlanProcessor {
  processMessagePlan(plan: MessagePlan, dependencies: ActorDependencies): Promise<void>;
}

export class DefaultMessagePlanProcessor implements MessagePlanProcessor {
  async processMessagePlan(plan: MessagePlan, dependencies: ActorDependencies): Promise<void> {
    if (!plan) {
      return;
    }

    log.debug('Processing MessagePlan with integrated plan interpreter', {
      instructionCount: Array.isArray(plan) ? plan.length : 1,
      actorId: dependencies.actorId,
    });

    const runtimeContext = this.adaptDependenciesToRuntimeContext(dependencies);
    const result = await processExistingPlan(plan, runtimeContext);

    if (result.success) {
      log.debug('MessagePlan processed successfully via plan interpreter', {
        instructionsExecuted: result.instructionsExecuted,
        domainEventsEmitted: result.domainEventsEmitted,
        sendInstructionsProcessed: result.sendInstructionsProcessed,
        askInstructionsProcessed: result.askInstructionsProcessed,
        executionTimeMs: result.executionTimeMs,
        actorId: dependencies.actorId,
      });
      return;
    }

    log.warn('MessagePlan processed with errors via plan interpreter', {
      errorCount: result.errors.length,
      errors: result.errors.map((err) => err.message),
      actorId: dependencies.actorId,
    });

    if (result.errors.length > 0) {
      throw result.errors[0];
    }
  }

  private adaptDependenciesToRuntimeContext(dependencies: ActorDependencies): RuntimeContext {
    return {
      actor: dependencies.actor,
      emit: (event: DomainEvent) => {
        dependencies.emit(event);
      },
      actorId: dependencies.actorId,
      correlationManager: dependencies.correlationManager as RuntimeContext['correlationManager'],
    };
  }
}
