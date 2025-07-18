/**
 * @module actor-core/runtime/patterns/pipeline
 * @description Pipeline pattern for AI agent chains with functional composition
 * @author Agent A (Tech Lead) - 2025-07-17
 */

import type { ActorRef } from '../actor-ref.js';
import { Logger } from '../logger.js';
import type { BaseEventObject } from '../types.js';

// ========================================================================================
// PIPELINE CORE TYPES
// ========================================================================================

/**
 * Pipeline stage function type
 */
export type PipelineStage<TInput, TOutput> = (input: TInput) => Promise<TOutput>;

/**
 * Pipeline execution context
 */
export interface PipelineContext {
  /**
   * Unique execution ID
   */
  executionId: string;

  /**
   * Stage index in the pipeline
   */
  stageIndex: number;

  /**
   * Total number of stages
   */
  totalStages: number;

  /**
   * Execution start time
   */
  startTime: number;

  /**
   * Metadata for tracing and debugging
   */
  metadata: Record<string, unknown>;
}

/**
 * Pipeline stage configuration
 */
export interface PipelineStageConfig<TInput = unknown, TOutput = unknown> {
  /**
   * Stage name for logging and debugging
   */
  name: string;

  /**
   * Stage function
   */
  stage: PipelineStage<TInput, TOutput>;

  /**
   * Optional timeout for stage execution
   */
  timeout?: number;

  /**
   * Optional retry configuration
   */
  retry?: {
    attempts: number;
    delay: number;
    backoff?: 'linear' | 'exponential';
  };

  /**
   * Optional error handling
   */
  onError?: (error: Error, context: PipelineContext) => Promise<TOutput | null>;

  /**
   * Optional stage metadata
   */
  metadata?: Record<string, unknown>;
}

/**
 * Pipeline execution result
 */
export interface PipelineResult<T> {
  /**
   * Final result of the pipeline
   */
  result: T;

  /**
   * Execution success status
   */
  success: boolean;

  /**
   * Error if execution failed
   */
  error?: Error;

  /**
   * Execution statistics
   */
  stats: {
    executionTime: number;
    stagesExecuted: number;
    totalStages: number;
    stageTimings: Array<{
      stageName: string;
      duration: number;
      success: boolean;
      error?: string;
    }>;
  };

  /**
   * Execution context
   */
  context: PipelineContext;
}

/**
 * Pipeline configuration
 */
export interface PipelineConfig {
  /**
   * Pipeline name
   */
  name: string;

  /**
   * Overall pipeline timeout
   */
  timeout?: number;

  /**
   * Enable parallel execution where possible
   */
  enableParallel?: boolean;

  /**
   * Error handling strategy
   */
  errorStrategy?: 'stop' | 'continue' | 'retry';

  /**
   * Maximum retry attempts for the entire pipeline
   */
  maxRetries?: number;

  /**
   * Global error handler
   */
  onError?: (error: Error, context: PipelineContext) => Promise<void>;

  /**
   * Pipeline metadata
   */
  metadata?: Record<string, unknown>;
}

// ========================================================================================
// PIPELINE IMPLEMENTATION
// ========================================================================================

/**
 * Pipeline for composing AI agent chains
 */
export class Pipeline<TInput = unknown, TOutput = unknown> {
  private stages: PipelineStageConfig[] = [];
  private config: Required<PipelineConfig>;
  private logger = Logger.namespace('PIPELINE');

  constructor(config: PipelineConfig) {
    this.config = {
      name: config.name,
      timeout: config.timeout ?? 30000,
      enableParallel: config.enableParallel ?? false,
      errorStrategy: config.errorStrategy ?? 'stop',
      maxRetries: config.maxRetries ?? 0,
      onError: config.onError ?? (() => Promise.resolve()),
      metadata: config.metadata ?? {},
    };

    this.logger.debug('Pipeline created', {
      name: this.config.name,
      config: this.config,
    });
  }

  /**
   * Add a stage to the pipeline
   */
  stage<TStageInput, TStageOutput>(
    config: PipelineStageConfig<TStageInput, TStageOutput>
  ): Pipeline<TInput, TStageOutput> {
    this.logger.debug('Adding stage to pipeline', {
      pipelineName: this.config.name,
      stageName: config.name,
      stageIndex: this.stages.length,
    });

    this.stages.push(config as PipelineStageConfig);
    return this as unknown as Pipeline<TInput, TStageOutput>;
  }

  /**
   * Execute the pipeline
   */
  async execute(input: TInput): Promise<PipelineResult<TOutput>> {
    const executionId = `${this.config.name}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    const startTime = Date.now();

    const context: PipelineContext = {
      executionId,
      stageIndex: 0,
      totalStages: this.stages.length,
      startTime,
      metadata: { ...this.config.metadata },
    };

    this.logger.info('🚀 Starting pipeline execution', {
      pipelineName: this.config.name,
      executionId,
      totalStages: this.stages.length,
      input: this.sanitizeForLogging(input),
    });

    const stageTimings: Array<{
      stageName: string;
      duration: number;
      success: boolean;
      error?: string;
    }> = [];

    let currentValue: unknown = input;
    let lastError: Error | undefined;

    try {
      for (let i = 0; i < this.stages.length; i++) {
        const stage = this.stages[i];
        context.stageIndex = i;

        this.logger.debug(`📋 Executing stage ${i + 1}/${this.stages.length}: ${stage.name}`, {
          pipelineName: this.config.name,
          executionId,
          stageName: stage.name,
          stageIndex: i,
          input: this.sanitizeForLogging(currentValue),
        });

        const stageStartTime = Date.now();
        let stageSuccess = false;
        let stageError: string | undefined;

        try {
          currentValue = await this.executeStage(stage, currentValue, context);
          stageSuccess = true;

          this.logger.debug(`✅ Stage completed: ${stage.name}`, {
            pipelineName: this.config.name,
            executionId,
            stageName: stage.name,
            stageIndex: i,
            duration: Date.now() - stageStartTime,
            output: this.sanitizeForLogging(currentValue),
          });
        } catch (error) {
          stageError = error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn(`❌ Stage failed: ${stage.name}`, {
            pipelineName: this.config.name,
            executionId,
            stageName: stage.name,
            stageIndex: i,
            error: stageError,
            duration: Date.now() - stageStartTime,
          });

          if (this.config.errorStrategy === 'stop') {
            lastError = error instanceof Error ? error : new Error(String(error));
            break;
          } else if (this.config.errorStrategy === 'continue') {
            // Continue with the previous value
            this.logger.debug('Continuing pipeline despite stage failure', {
              pipelineName: this.config.name,
              executionId,
              stageName: stage.name,
            });
          }
        }

        stageTimings.push({
          stageName: stage.name,
          duration: Date.now() - stageStartTime,
          success: stageSuccess,
          error: stageError,
        });
      }

      const executionTime = Date.now() - startTime;
      const success = !lastError;

      if (success) {
        this.logger.info('✅ Pipeline execution completed successfully', {
          pipelineName: this.config.name,
          executionId,
          executionTime,
          stagesExecuted: stageTimings.length,
          totalStages: this.stages.length,
        });
      } else {
        this.logger.error('❌ Pipeline execution failed', {
          pipelineName: this.config.name,
          executionId,
          executionTime,
          stagesExecuted: stageTimings.length,
          totalStages: this.stages.length,
          error: lastError?.message,
        });
      }

      return {
        result: currentValue as TOutput,
        success,
        error: lastError,
        stats: {
          executionTime,
          stagesExecuted: stageTimings.length,
          totalStages: this.stages.length,
          stageTimings,
        },
        context,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const pipelineError = error instanceof Error ? error : new Error(String(error));

      this.logger.error('❌ Pipeline execution failed with unhandled error', {
        pipelineName: this.config.name,
        executionId,
        executionTime,
        error: pipelineError.message,
        stack: pipelineError.stack,
      });

      await this.config.onError(pipelineError, context);

      return {
        result: currentValue as TOutput,
        success: false,
        error: pipelineError,
        stats: {
          executionTime,
          stagesExecuted: stageTimings.length,
          totalStages: this.stages.length,
          stageTimings,
        },
        context,
      };
    }
  }

  /**
   * Execute a single stage with retry logic
   */
  private async executeStage(
    stageConfig: PipelineStageConfig,
    input: unknown,
    context: PipelineContext
  ): Promise<unknown> {
    const { stage, timeout, retry, onError } = stageConfig;
    let lastError: Error | undefined;

    const maxAttempts = retry ? retry.attempts + 1 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Apply timeout if specified
        if (timeout) {
          return await Promise.race([
            stage(input),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`Stage timeout after ${timeout}ms`)), timeout)
            ),
          ]);
        } else {
          return await stage(input);
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxAttempts && retry) {
          const delay =
            retry.backoff === 'exponential' ? retry.delay * Math.pow(2, attempt - 1) : retry.delay;

          this.logger.debug(
            `Retrying stage ${stageConfig.name} (attempt ${attempt + 1}/${maxAttempts})`,
            {
              pipelineName: this.config.name,
              executionId: context.executionId,
              stageName: stageConfig.name,
              attempt,
              delay,
              error: lastError.message,
            }
          );

          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // If we have an error handler, try it
    if (onError && lastError) {
      try {
        const result = await onError(lastError, context);
        if (result !== null) {
          return result;
        }
      } catch (handlerError) {
        this.logger.warn('Error handler failed', {
          pipelineName: this.config.name,
          executionId: context.executionId,
          stageName: stageConfig.name,
          handlerError: handlerError instanceof Error ? handlerError.message : 'Unknown error',
        });
      }
    }

    throw lastError;
  }

  /**
   * Sanitize input/output for logging
   */
  private sanitizeForLogging(value: unknown): unknown {
    if (typeof value === 'string' && value.length > 200) {
      return value.substring(0, 200) + '...';
    }
    if (typeof value === 'object' && value !== null) {
      return { type: typeof value, constructor: value.constructor.name };
    }
    return value;
  }

  /**
   * Get pipeline statistics
   */
  getStats(): {
    name: string;
    stages: number;
    config: PipelineConfig;
  } {
    return {
      name: this.config.name,
      stages: this.stages.length,
      config: this.config,
    };
  }
}

// ========================================================================================
// ACTOR INTEGRATION
// ========================================================================================

/**
 * Actor-based pipeline stage
 */
export interface ActorStage<TInput = unknown, TOutput = unknown> {
  /**
   * Actor reference
   */
  actor: ActorRef<BaseEventObject>;

  /**
   * Event type to send to the actor
   */
  eventType: string;

  /**
   * Transform input to actor event
   */
  mapInput: (input: TInput) => BaseEventObject;

  /**
   * Transform actor response to output
   */
  mapOutput: (response: unknown) => TOutput;

  /**
   * Optional timeout for actor response
   */
  timeout?: number;
}

/**
 * Create a pipeline stage from an actor
 */
export function createActorStage<TInput, TOutput>(
  config: ActorStage<TInput, TOutput>
): PipelineStage<TInput, TOutput> {
  return async (input: TInput): Promise<TOutput> => {
    const event = config.mapInput(input);
    const response = await config.actor.ask(
      event,
      config.timeout ? { timeout: config.timeout } : undefined
    );
    return config.mapOutput(response);
  };
}

// ========================================================================================
// FUNCTIONAL COMPOSITION HELPERS
// ========================================================================================

/**
 * Compose multiple pipeline stages into a single pipeline
 */
export function compose<T1, T2>(stage1: PipelineStage<T1, T2>): Pipeline<T1, T2>;
export function compose<T1, T2, T3>(
  stage1: PipelineStage<T1, T2>,
  stage2: PipelineStage<T2, T3>
): Pipeline<T1, T3>;
export function compose<T1, T2, T3, T4>(
  stage1: PipelineStage<T1, T2>,
  stage2: PipelineStage<T2, T3>,
  stage3: PipelineStage<T3, T4>
): Pipeline<T1, T4>;
export function compose<T1, T2, T3, T4, T5>(
  stage1: PipelineStage<T1, T2>,
  stage2: PipelineStage<T2, T3>,
  stage3: PipelineStage<T3, T4>,
  stage4: PipelineStage<T4, T5>
): Pipeline<T1, T5>;
export function compose(...stages: PipelineStage<unknown, unknown>[]): Pipeline<unknown, unknown> {
  const pipeline = new Pipeline({ name: 'composed-pipeline' });

  stages.forEach((stage, index) => {
    pipeline.stage({
      name: `stage-${index + 1}`,
      stage,
    });
  });

  return pipeline;
}

/**
 * Create a pipeline builder for fluent API
 */
export function createPipeline(config: PipelineConfig): Pipeline {
  return new Pipeline(config);
}

/**
 * Parallel execution helper
 */
export function parallel<T, R>(inputs: T[], stage: PipelineStage<T, R>): Promise<R[]> {
  return Promise.all(inputs.map((input) => stage(input)));
}

/**
 * Branch execution helper
 */
export function branch<T, R>(
  condition: (input: T) => boolean,
  trueBranch: PipelineStage<T, R>,
  falseBranch: PipelineStage<T, R>
): PipelineStage<T, R> {
  return async (input: T): Promise<R> => {
    if (condition(input)) {
      return trueBranch(input);
    } else {
      return falseBranch(input);
    }
  };
}

/**
 * Retry helper
 */
export function retry<T, R>(
  stage: PipelineStage<T, R>,
  attempts: number,
  delay = 1000
): PipelineStage<T, R> {
  return async (input: T): Promise<R> => {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await stage(input);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  };
}
