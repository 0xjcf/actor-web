/**
 * @module actor-core/runtime/create-actor
 * @description Unified actor creation API with type-safe event emission
 * @author Agent A - 2025-07-18
 *
 * This module implements the createActor function which provides a single API
 * for creating actors from various sources (ActorBehavior, XState machines, etc.)
 * while maintaining compile-time type safety for emitted events.
 */

import type { Actor, AnyStateMachine } from 'xstate';
import type {
  ActorBehavior,
  ActorDependencies,
  ActorMessage,
  ActorPID,
  ActorSystem,
  BasicMessage,
  MessageMap,
  SupervisionStrategy,
  TypeSafeActor,
} from './actor-system.js';
import { createActorSystem } from './actor-system-impl.js';
import { createActorRef } from './create-actor-ref.js';
import { Logger } from './logger.js';
import type { DomainEvent, MessagePlan } from './message-plan.js';
import { analyzeMessage, isActorHandlerResult, processSmartDefaults } from './otp-types.js';
import type { MessageUnion } from './types.js';

const log = Logger.namespace('CREATE_ACTOR');

/**
 * XState machine configuration for createActor
 */
export interface XStateActorConfig {
  /**
   * XState state machine definition
   */
  readonly machine: AnyStateMachine;

  /**
   * Optional input/context for the machine
   */
  readonly input?: Record<string, unknown>;

  /**
   * Optional actor ID
   */
  readonly id?: string;

  /**
   * Whether to auto-start the actor (default: true)
   */
  readonly autoStart?: boolean;

  /**
   * Supervision strategy for fault tolerance
   */
  readonly supervision?: SupervisionStrategy | 'restart-on-failure' | 'resume' | 'stop';
}

/**
 * Message handler for pure actors with context-based state
 * ✅ TYPE SAFETY: Context is required for context-based actors
 */
export type PureMessageHandlerWithContext<
  TMessage,
  _TEmitted,
  TDomainEvent = DomainEvent,
  TContext = Record<string, unknown>,
> = (params: {
  readonly message: TMessage;
  readonly machine: Actor<AnyStateMachine>;
  readonly dependencies: ActorDependencies;
  readonly context: TContext; // ✅ Required: context-based state
}) => MessagePlan<TDomainEvent> | Promise<MessagePlan<TDomainEvent>> | void | Promise<void>;

/**
 * Message handler for pure actors with machine-based state
 * ✅ TYPE SAFETY: No context parameter - use machine.getSnapshot().context
 */
export type PureMessageHandlerWithMachine<
  TMessage,
  _TEmitted,
  TDomainEvent = DomainEvent,
> = (params: {
  readonly message: TMessage;
  readonly machine: Actor<AnyStateMachine>;
  readonly dependencies: ActorDependencies;
  // ✅ No context: use machine.getSnapshot().context instead
}) => MessagePlan<TDomainEvent> | Promise<MessagePlan<TDomainEvent>> | void | Promise<void>;

/**
 * Base configuration for pure actor behaviors with context-based state
 * ✅ TYPE SAFETY: Discriminated union with configType
 */
export interface PureActorBehaviorConfigWithContext<
  TMessage = ActorMessage,
  TEmitted = ActorMessage,
  TDomainEvent = DomainEvent,
  TContext = Record<string, unknown>,
> {
  readonly configType: 'context'; // ✅ Discriminator
  readonly types?: {
    readonly message?: TMessage;
    readonly emitted?: TEmitted;
    readonly domainEvent?: TDomainEvent;
    readonly context?: TContext;
  };

  readonly initialContext?: TContext;
  readonly onMessage: PureMessageHandlerWithContext<TMessage, TEmitted, TDomainEvent, TContext>;

  readonly onStart?: (params: {
    readonly machine: Actor<AnyStateMachine>;
    readonly dependencies: ActorDependencies;
  }) => MessagePlan<TDomainEvent> | Promise<MessagePlan<TDomainEvent>> | void | Promise<void>;

  readonly onStop?: (params: {
    readonly machine: Actor<AnyStateMachine>;
    readonly dependencies: ActorDependencies;
  }) => Promise<void> | void;

  readonly supervisionStrategy?: SupervisionStrategy;
}

/**
 * Configuration for pure actor behaviors with machine-based state
 * ✅ TYPE SAFETY: Discriminated union with configType
 */
export interface PureActorBehaviorConfigWithMachine<
  TMessage = ActorMessage,
  TEmitted = ActorMessage,
  TDomainEvent = DomainEvent,
> {
  readonly configType: 'machine'; // ✅ Discriminator
  readonly types?: {
    readonly message?: TMessage;
    readonly emitted?: TEmitted;
    readonly domainEvent?: TDomainEvent;
  };

  readonly machine: AnyStateMachine;
  readonly onMessage: PureMessageHandlerWithMachine<TMessage, TEmitted, TDomainEvent>;

  readonly onStart?: (params: {
    readonly machine: Actor<AnyStateMachine>;
    readonly dependencies: ActorDependencies;
  }) => MessagePlan<TDomainEvent> | Promise<MessagePlan<TDomainEvent>> | void | Promise<void>;

  readonly onStop?: (params: {
    readonly machine: Actor<AnyStateMachine>;
    readonly dependencies: ActorDependencies;
  }) => Promise<void> | void;

  readonly supervisionStrategy?: SupervisionStrategy;
}

/**
 * Union type for pure actor behavior configurations
 * ✅ TYPE SAFETY: Prevents context + machine conflicts at compile time
 */
export type PureActorBehaviorConfig<
  TMessage = ActorMessage,
  TEmitted = ActorMessage,
  TDomainEvent = DomainEvent,
  TContext = Record<string, unknown>,
> =
  | PureActorBehaviorConfigWithContext<TMessage, TEmitted, TDomainEvent, TContext>
  | PureActorBehaviorConfigWithMachine<TMessage, TEmitted, TDomainEvent>;

/**
 * Union type for all supported actor configurations (Pure Actors Only)
 * Components should use createComponent() directly
 */
export type CreateActorConfig<TMessage = ActorMessage, TEmitted = ActorMessage> =
  | XStateActorConfig
  | ActorBehavior<TMessage, TEmitted>
  | PureActorBehaviorConfig<TMessage, TEmitted>;

/**
 * Type guard to check if config is an XStateActorConfig
 */
function isXStateConfig<TMessage, TEmitted>(
  config: CreateActorConfig<TMessage, TEmitted>
): config is XStateActorConfig {
  // ✅ FIXED: Only pure XState configs (machine without onMessage handler)
  return (
    'machine' in config && typeof config.machine === 'object' && !('onMessage' in config) // ← KEY: Exclude configs with onMessage handlers
  );
}

/**
 * Type guard to check if config is a PureActorBehaviorConfig
 * These are the old-style configs that need conversion
 */
function isPureActorBehaviorConfig<TMessage, TEmitted>(
  config: CreateActorConfig<TMessage, TEmitted>
): config is PureActorBehaviorConfig<TMessage, TEmitted> {
  return (
    'onMessage' in config &&
    typeof config.onMessage === 'function' &&
    // ✅ FIXED: Allow configs with machines - pure actors can have XState machines
    // !('machine' in config) &&  // ← REMOVED: This was incorrectly excluding machine configs
    // Check if it's a plain object config (not already an ActorBehavior)
    !Object.hasOwn(config, 'types')
  );
}

/**
 * Type guard to check if config is already a unified ActorBehavior
 * These are pass-through configs that don't need conversion
 */
function _isActorBehavior<TMessage, TEmitted>(
  config: CreateActorConfig<TMessage, TEmitted>
): config is ActorBehavior<TMessage, TEmitted> {
  return (
    'onMessage' in config &&
    typeof config.onMessage === 'function' &&
    !('machine' in config) &&
    // ActorBehavior may have types property (distinguishes from PureActorBehaviorConfig)
    (Object.hasOwn(config, 'types') ||
      // Or check function signature - ActorBehavior onMessage has different params than PureActorBehaviorConfig
      config.onMessage
        .toString()
        .includes('machine'))
  );
}

/**
 * Create a start handler wrapper with proper error handling
 */
function createStartHandler<_TEmitted, TDomainEvent>(
  startHandler: (params: {
    readonly machine: Actor<AnyStateMachine>;
    readonly dependencies: ActorDependencies;
  }) => MessagePlan<TDomainEvent> | Promise<MessagePlan<TDomainEvent>> | void | Promise<void>
) {
  return async (params: {
    readonly machine: Actor<AnyStateMachine>;
    readonly dependencies: ActorDependencies;
  }) => {
    log.debug('Processing start in pure behavior');

    try {
      const result = await startHandler({
        machine: params.machine,
        dependencies: params.dependencies,
      });

      return result;
    } catch (error) {
      log.error('Error in start handler', { error });
      throw error;
    }
  };
}

/**
 * Create a stop handler wrapper with proper error handling
 */
function createStopHandler(
  stopHandler: (params: {
    readonly machine: Actor<AnyStateMachine>;
    readonly dependencies: ActorDependencies;
  }) => Promise<void> | void
) {
  return async (params: {
    readonly machine: Actor<AnyStateMachine>;
    readonly dependencies: ActorDependencies;
  }) => {
    log.debug('Processing stop in pure behavior');

    try {
      await stopHandler({
        machine: params.machine,
        dependencies: params.dependencies,
      });
    } catch (error) {
      log.error('Error in stop handler', { error });
      throw error;
    }
  };
}

/**
 * Create an actor from XState machine
 * Note: This returns an ActorBehavior that wraps the XState machine
 */
function createActorFromXState<TMessage = ActorMessage, TEmitted = ActorMessage>(
  _config: XStateActorConfig
): ActorBehavior<TMessage, TEmitted> {
  // This is a simplified adapter - in a real implementation,
  // we would need to properly bridge XState actors with our actor system
  return {
    onMessage: async (_params) => {
      // In a real implementation, we would:
      // 1. Use the machine parameter to access XState state
      // 2. Send the message as an XState event via machine.send()
      // 3. Extract any emitted events from the machine
      // 4. Return as MessagePlan

      // For now, this is a placeholder that shows the pattern
      console.warn('XState actor integration not yet implemented');
      return undefined; // Return void (no action)
    },

    // XState handles its own lifecycle
    onStart: undefined,
    onStop: undefined,
  };
}

// ============================================================================
// FLUENT BUILDER PATTERN TYPES WITH OTP SUPPORT
// ============================================================================

import type { OTPMessageHandler } from './otp-types.js';

/**
 * Base builder interface providing withContext() and withMachine() methods
 * This is the entry point for the fluent builder pattern
 */
export interface BehaviorBuilderBase<TMessage = ActorMessage, TEmitted = ActorMessage> {
  /**
   * Create a context-based actor with initial state
   * Locks out .withMachine() - compile-time mutual exclusivity
   */
  withContext<TContext>(
    initialContext: TContext
  ): ContextBehaviorBuilder<TMessage, TEmitted, TContext>;

  /**
   * Create a machine-based actor with XState machine
   * Locks out .withContext() - compile-time mutual exclusivity
   */
  withMachine(machine: AnyStateMachine): MachineBehaviorBuilder<TMessage, TEmitted>;
}

/**
 * Context-based behavior builder supporting OTP patterns with smart defaults
 * Only provides .onMessage() method after .withContext()
 */
export class ContextBehaviorBuilder<
  TMessage = ActorMessage,
  TEmitted = ActorMessage,
  TContext = unknown,
> {
  constructor(private readonly context: TContext) {}

  /**
   * Define the message handler with OTP patterns and smart defaults support
   *
   * @example Smart Defaults Usage
   * ```typescript
   * .onMessage(({ message, machine, dependencies }) => {
   *   const context = machine.getSnapshot().context;
   *
   *   switch (message.type) {
   *     case 'INCREMENT':
   *       // ✅ Smart default: Auto-respond with context for ask patterns
   *       return { context: { ...context, count: context.count + 1 } };
   *
   *     case 'CREATE_USER':
   *       // ✅ Explicit control: Different context vs response
   *       return {
   *         context: { ...context, users: [...context.users, newUser] },
   *         response: { id: newUser.id, status: 'created' }
   *       };
   *   }
   * })
   * ```
   */
  onMessage(
    handler: OTPMessageHandler<TMessage, TContext, TContext>
  ): ActorBehavior<TMessage, TEmitted> {
    return createActorBehaviorFromConfig({
      configType: 'context',
      context: this.context,
      onMessage: handler,
    });
  }
}

/**
 * Machine-based behavior builder supporting OTP patterns with smart defaults
 * Only provides .onMessage() method after .withMachine()
 */
export class MachineBehaviorBuilder<TMessage = ActorMessage, TEmitted = ActorMessage> {
  constructor(private readonly machine: AnyStateMachine) {}

  /**
   * Define the message handler with OTP patterns and smart defaults support
   * Uses the provided XState machine for state access and transitions
   */
  onMessage(
    handler: OTPMessageHandler<TMessage, unknown, unknown>
  ): ActorBehavior<TMessage, TEmitted> {
    return createActorBehaviorFromConfig({
      configType: 'machine',
      machine: this.machine,
      onMessage: handler,
    });
  }
}

/**
 * Helper function to create ActorBehavior from builder config
 * This bridges the fluent builder API with the existing behavior system with OTP patterns
 */
function createActorBehaviorFromConfig<TMessage, TEmitted>(config: {
  configType: 'context' | 'machine';
  context?: unknown;
  machine?: AnyStateMachine;
  onMessage: OTPMessageHandler<TMessage, unknown, unknown>;
}): ActorBehavior<TMessage, TEmitted> {
  log.debug('Creating ActorBehavior from fluent builder config', {
    configType: config.configType,
    hasContext: config.context !== undefined,
    hasMachine: config.machine !== undefined,
  });

  return {
    // Add context if provided
    context: config.context as import('./actor-system.js').JsonValue | undefined,
    // Convert OTP message handler to standard ActorBehavior onMessage
    onMessage: async (params) => {
      try {
        log.debug('Processing OTP message with enhanced processor', {
          messageType: (params.message as { type?: string })?.type || 'unknown',
          configType: config.configType,
          actorId: params.dependencies.actorId,
        });

        // Call the OTP message handler
        const result = await config.onMessage({
          message: params.message,
          machine: params.machine,
          dependencies: params.dependencies,
        });

        console.log('🔍 OTP DEBUG: Handler result:', result);
        console.log('🔍 OTP DEBUG: isActorHandlerResult check:', isActorHandlerResult(result));

        // Handle OTP result patterns with enhanced processor
        if (isActorHandlerResult(result)) {
          console.log('🔍 OTP DEBUG: Processing ActorHandlerResult...');
          // Import OTP processor dynamically to avoid circular dependencies
          const { OTPMessagePlanProcessor } = await import('./otp-message-plan-processor.js');
          const otpProcessor = new OTPMessagePlanProcessor();

          // Type assertion after successful type guard check
          const otpResult = result as import('./otp-types.js').ActorHandlerResult<unknown, unknown>;

          // Process smart defaults
          const messageAnalysis = analyzeMessage(params.message as ActorMessage);
          const smartDefaults = processSmartDefaults(otpResult, messageAnalysis);

          log.debug('OTP result with smart defaults', {
            hasContext: otpResult.context !== undefined,
            hasResponse: otpResult.response !== undefined,
            hasBehavior: otpResult.behavior !== undefined,
            hasEffects: otpResult.effects !== undefined,
            responseSource: smartDefaults.responseSource,
            shouldRespond: smartDefaults.shouldRespond,
            actorId: params.dependencies.actorId,
          });

          // Create enhanced result with smart defaults applied
          const enhancedResult: import('./otp-types.js').ActorHandlerResult<unknown, unknown> = {
            context: otpResult.context,
            response: smartDefaults.shouldRespond
              ? smartDefaults.finalResponse
              : otpResult.response,
            behavior: otpResult.behavior,
            effects: otpResult.effects,
          };

          // Process OTP patterns (context updates, behavior switching, effects, responses)
          await otpProcessor.processOTPResult(
            enhancedResult,
            params.dependencies.actorId,
            params.machine,
            params.dependencies,
            (params.message as ActorMessage).correlationId,
            (params.message as ActorMessage).type // Pass original message type for response compatibility
          );

          // Return undefined - all processing handled by OTP processor
          return undefined;
        }

        // Handle legacy MessagePlan returns (backward compatibility)
        return result;
      } catch (error) {
        log.error('Error in OTP message handler', {
          error,
          actorId: params.dependencies.actorId,
          messageType: (params.message as { type?: string })?.type || 'unknown',
        });
        throw error;
      }
    },

    // Pass through lifecycle handlers (fluent builders don't support these yet)
    onStart: undefined,
    onStop: undefined,
  };
}

/**
 * Create an actor behavior using the new fluent builder pattern with OTP support
 *
 * @example Context-based Actor with Smart Defaults
 * ```typescript
 * const behavior = defineBehavior<CounterMessage>()
 *   .withContext({ count: 0 })
 *   .onMessage(({ message, machine, dependencies }) => {
 *     const context = machine.getSnapshot().context;
 *
 *     switch (message.type) {
 *       case 'INCREMENT':
 *         // ✅ Smart default: Auto-respond with state for ask patterns
 *         return { state: { ...context, count: context.count + 1 } };
 *
 *       case 'GET_COUNT':
 *         // ✅ Response-only: No state change
 *         return { response: context.count };
 *     }
 *   });
 * ```
 *
 * @example Machine-based Actor
 * ```typescript
 * const behavior = defineBehavior<UserMessage>()
 *   .withMachine(userStateMachine)
 *   .onMessage(({ message, machine, dependencies }) => {
 *     // Use XState machine for complex state management
 *     machine.send({ type: message.type, ...message.payload });
 *   });
 * ```
 */
export function defineFluentBehavior<
  TMessage = ActorMessage,
  TEmitted = ActorMessage,
>(): BehaviorBuilderBase<TMessage, TEmitted> {
  return {
    withContext<TContext>(initialContext: TContext) {
      return new ContextBehaviorBuilder<TMessage, TEmitted, TContext>(initialContext);
    },

    withMachine(machine: AnyStateMachine) {
      return new MachineBehaviorBuilder<TMessage, TEmitted>(machine);
    },
  };
}

// ============================================================================
// UNIFIED BEHAVIOR API - Pure Actors Only
// ============================================================================

/**
 * Create an actor behavior following pure actor model principles (Pure Actors Only)
 *
 * This function converts various input configurations into the unified ActorBehavior interface
 * that follows pure actor principles: no context state, message-only communication via
 * machine and dependencies, and MessagePlan returns.
 *
 * For components with fan-out support, use createComponent() instead
 *
 * @param config - Actor configuration (XState, ActorBehavior, or PureActorBehaviorConfig)
 * @returns Unified ActorBehavior interface
 *
 * @example
 * ```typescript
 * // Pure actor behavior config
 * const behavior = defineBehavior({
 *   onMessage: async ({ message, machine, dependencies }) => {
 *     // Process message using machine state and dependencies
 *     const currentState = machine.getSnapshot();
 *
 *     if (message.type === 'INCREMENT') {
 *       // Send event to machine for state transition
 *       machine.send({ type: 'INCREMENT', value: message.payload?.value });
 *
 *       // Return domain event for fan-out
 *       return { type: 'COUNTER_INCREMENTED', newValue: currentState.context.count + 1 };
 *     }
 *
 *     return undefined; // No action
 *   }
 * });
 *
 * // XState machine config
 * const xstateBehavior = defineBehavior({
 *   machine: counterMachine,
 *   input: { count: 0 }
 * });
 * ```
 */
export function defineBehavior<TMessage = ActorMessage, TEmitted = ActorMessage>(
  config: CreateActorConfig<TMessage, TEmitted>
): ActorBehavior<TMessage, TEmitted> {
  // Handle XState actor configuration
  if (isXStateConfig(config)) {
    return createActorFromXState(config);
  }

  // Handle existing ActorBehavior configurations (pass through)
  if (_isActorBehavior(config)) {
    return config;
  }

  // Handle PureActorBehaviorConfig - convert to unified ActorBehavior
  if (isPureActorBehaviorConfig(config)) {
    const pureConfig = config as PureActorBehaviorConfig<TMessage, TEmitted>;

    log.debug('Creating pure actor behavior from config', {
      hasOnStart: pureConfig.onStart !== undefined,
      hasOnStop: pureConfig.onStop !== undefined,
      hasTypes: pureConfig.types !== undefined,
    });

    return {
      // Include type definitions for compile-time validation
      types: pureConfig.types,

      // Pure message handler - no context parameter
      onMessage: async (params) => {
        const messageType = (params.message as { type?: string })?.type || 'unknown';

        log.debug('Processing message in pure behavior', {
          messageType,
          hasMachine: params.machine !== undefined,
          hasDependencies: params.dependencies !== undefined,
        });

        try {
          // ✅ TYPE SAFETY: Use discriminator for proper type narrowing
          if (pureConfig.configType === 'context') {
            // Context-based actor configuration
            const context = pureConfig.initialContext || ({} as Record<string, unknown>);

            return await pureConfig.onMessage({
              message: params.message,
              machine: params.machine,
              dependencies: params.dependencies,
              context,
            });
          }

          if (pureConfig.configType === 'machine') {
            // Machine-based actor configuration
            return await pureConfig.onMessage({
              message: params.message,
              machine: params.machine,
              dependencies: params.dependencies,
            });
          }

          // This should not happen with proper type guards, but add error for safety
          throw new Error(
            `Invalid actor configuration: Expected 'context' or 'machine' configType, got: ${
              (pureConfig as { configType?: string }).configType || 'undefined'
            }`
          );
        } catch (error) {
          log.error('Error in message handler', { error, messageType });
          throw error;
        }
      },

      // Pure start handler
      onStart: pureConfig.onStart ? createStartHandler(pureConfig.onStart) : undefined,

      // Pure stop handler
      onStop: pureConfig.onStop ? createStopHandler(pureConfig.onStop) : undefined,

      // Pass through supervision strategy
      supervisionStrategy: pureConfig.supervisionStrategy,
    };
  }

  throw new Error('Invalid actor configuration provided to defineBehavior');
}

/**
 * Type helper for extracting message types from an actor definition
 */
export type ActorMessageType<T> = T extends ActorBehavior<infer M, unknown> ? M : never;

/**
 * Type helper for extracting context type from an actor definition
 */
export type ActorContextType<T> = T extends ActorBehavior<unknown, infer C> ? C : never;

/**
 * Type helper for extracting emitted event types from an actor definition
 */
export type ActorEmittedType<T> = T extends ActorBehavior<unknown, infer E> ? E : never;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if a value is a valid message plan (for validation)
 * Re-exports the check from message-plan module
 */
function isMessagePlan(result: unknown): result is MessagePlan {
  if (result === null || result === undefined) {
    return true; // void is a valid message plan
  }

  if (Array.isArray(result)) {
    return true; // Arrays are message plans (validated during processing)
  }

  // For other types, we'd need more sophisticated checking
  // For now, assume non-null objects could be domain events or instructions
  return typeof result === 'object';
}

/**
 * Check if a value is a valid message plan (for validation)
 * Re-exports the check from message-plan module
 */
export function validateMessagePlan(value: unknown): value is MessagePlan {
  return isMessagePlan(value);
}

/**
 * Create a behavior from a simple message handler function (convenience)
 *
 * @example
 * ```typescript
 * const behavior = createSimpleBehavior(async ({ message, machine }) => {
 *   if (message.type === 'PING') {
 *     return { type: 'PONG' };
 *   }
 * });
 * ```
 */
export function createSimpleBehavior<TMessage = ActorMessage, TEmitted = ActorMessage>(
  handler: PureMessageHandlerWithContext<TMessage, TEmitted>
): ActorBehavior<TMessage, TEmitted> {
  return defineBehavior({
    configType: 'context',
    onMessage: handler,
  });
}

/**
 * @deprecated Legacy support - will be removed in future versions
 * Use defineBehavior with PureActorBehaviorConfig instead
 */
export function createLegacyBehavior(): never {
  throw new Error(
    'Legacy behavior creation is no longer supported. Use defineBehavior with PureActorBehaviorConfig instead. ' +
      'See migration guide for converting context-based behaviors to pure actor model.'
  );
}

// Default actor system for spawnActor
let defaultSystem: ActorSystem | null = null;

/**
 * Get or create the default actor system
 */
function getDefaultSystem(): ActorSystem {
  if (!defaultSystem) {
    defaultSystem = createActorSystem({
      nodeAddress: 'default',
      debug: false,
    });
    defaultSystem.start();
  }
  return defaultSystem;
}

/**
 * Helper to convert BasicMessage to ActorMessage
 */
function toActorMessage(input: BasicMessage): ActorMessage {
  return {
    type: input.type,
    payload: input.payload ?? null,
    correlationId: input.correlationId,
    timestamp: input.timestamp ?? Date.now(),
    version: input.version ?? '1.0.0',
  };
}

/**
 * Actor instance interface for XState compatibility
 */
export interface ActorInstance {
  send(event: BasicMessage): void;
  ask<T = unknown>(message: BasicMessage, timeout?: number): Promise<T>;
  start(): void;
  stop(): Promise<void>;
  subscribe(eventType: string, handler: (event: ActorMessage) => void): () => void;
}

/**
 * Spawn an actor instance directly (convenience function)
 *
 * This function provides a migration-friendly API that returns
 * an actor instance immediately, similar to XState's createActor.
 * It automatically creates and manages a default actor system.
 *
 * For advanced use cases requiring supervision, clustering, or
 * custom actor systems, use `defineBehavior` with `ActorSystem.spawn`.
 *
 * @param config - Actor configuration
 * @returns Actor instance with send/ask/start/stop methods
 *
 * @example
 * ```typescript
 * // XState machine - returns immediately usable actor
 * const gitActor = spawnActor({
 *   machine: gitMachine,
 *   input: { baseDir: './' },
 *   autoStart: true  // Auto-start by default
 * });
 *
 * gitActor.send({ type: 'FETCH' });
 * const result = await gitActor.ask({ type: 'GET_STATUS' });
 *
 * // Behavior-based actor
 * const counter = spawnActor({
 *   context: { count: 0 },
 *   onMessage: ({ message, context }) => {
 *     if (message.type === 'INCREMENT') {
 *       return {
 *         context: { count: context.count + 1 },
 *         emit: { type: 'COUNTED', count: context.count + 1 }
 *       };
 *     }
 *     return { context };
 *   }
 * });
 * ```
 */
export function spawnActor<TMessage = ActorMessage, TEmitted = ActorMessage>(
  config: CreateActorConfig<TMessage, TEmitted> & {
    autoStart?: boolean;
  }
): ActorInstance {
  const system = getDefaultSystem();

  // Special handling for XState machines
  if ('machine' in config && config.machine) {
    const xstateConfig = config as XStateActorConfig;

    // Use createActorRef for unified event bridge support
    const actorRef = createActorRef(xstateConfig.machine, {
      input: xstateConfig.input,
      id: xstateConfig.id,
    });

    // Auto-start if requested (default true)
    const autoStart = config.autoStart !== false;
    if (autoStart) {
      actorRef.start();
    }

    // Return ActorInstance-compatible interface wrapping the unified ActorRef
    return {
      send: (event: BasicMessage) => {
        // Convert BasicMessage to the event format expected by ActorRef
        actorRef.send(event);
      },
      ask: async <T = unknown>(message: BasicMessage, timeout?: number): Promise<T> => {
        return actorRef.ask(message, { timeout });
      },
      start: () => actorRef.start(),
      stop: async () => actorRef.stop(),
      subscribe: (eventType: string, handler: (event: ActorMessage) => void) => {
        // Wrap handler with type guard for type safety
        const safeHandler = (event: unknown) => {
          // Type guard to ensure event is ActorMessage
          if (isActorMessage(event)) {
            handler(event);
          } else {
            console.warn('Received non-ActorMessage event:', event);
          }
        };
        return actorRef.subscribe(eventType, safeHandler);
      },
    };
  }

  // For behavior-based actors, use the actor system with deferred spawn
  const definition = defineBehavior(config);
  let pidPromise: Promise<ActorPID> | null = null;
  let resolvedPid: ActorPID | null = null;

  // Lazy spawn function
  const ensureSpawned = async (): Promise<ActorPID> => {
    if (!pidPromise) {
      pidPromise = system.spawn(definition, {
        id: 'id' in config && typeof config.id === 'string' ? config.id : undefined,
      });
      resolvedPid = await pidPromise;
    }
    return resolvedPid || (await pidPromise);
  };

  // Return immediately with deferred execution
  return {
    send: (event: BasicMessage) => {
      // Need to return void but ensure the promise chain completes
      void ensureSpawned()
        .then((pid) => pid.send(toActorMessage(event)))
        .catch((err) => {
          console.error('Failed to send message:', err);
        });
    },
    ask: <T = unknown>(message: BasicMessage, timeout?: number) => {
      return ensureSpawned().then((pid) => pid.ask<T>(toActorMessage(message), timeout));
    },
    start: () => {
      // Trigger spawn if not already done
      ensureSpawned().catch((err) => {
        console.error('Failed to start actor:', err);
      });
    },
    stop: async () => {
      const pid = await ensureSpawned();
      await pid.stop();
    },
    subscribe: (eventType: string, handler: (event: ActorMessage) => void) => {
      // For subscriptions, we need to handle async
      let unsubscribe: (() => void) | null = null;

      ensureSpawned()
        .then((pid) => {
          unsubscribe = pid.subscribe(eventType, handler);
        })
        .catch((err: unknown) => {
          console.error('Failed to subscribe:', err);
        });

      // Return a function that will unsubscribe when available
      return () => {
        if (unsubscribe) unsubscribe();
      };
    },
  };
}

/**
 * Create an actor instance directly from a configuration
 * This is the main API for creating actors, similar to XState's createActor
 *
 * @example
 * ```typescript
 * const counterActor = createActor<ActorMessage, { count: number }, CounterEvent>({
 *   context: { count: 0 },
 *   onMessage: async ({ message, context }) => {
 *     // Handle message and return new context with optional events
 *   }
 * });
 * ```
 */
export function createActor<TMessage = ActorMessage, TEmitted = ActorMessage>(
  config: CreateActorConfig<TMessage, TEmitted>
): ActorInstance {
  return spawnActor({ ...config, autoStart: true });
}

/**
 * Create a type-safe wrapper around an existing actor
 * This provides compile-time type safety for message types and responses
 * with immediate error detection at call sites for invalid message types.
 *
 * @example
 * ```typescript
 * interface GitMessages extends MessageMap {
 *   'GET_STATUS': { isGitRepo: boolean; currentBranch?: string };
 *   'COMMIT_CHANGES': { commitHash: string; message: string };
 * }
 *
 * const gitActor = createActor(gitBehavior);
 * const typeSafeGitActor = asTypeSafeActor<GitMessages>(gitActor);
 *
 * // ✅ Valid usage - TypeScript provides proper inference
 * const status = await typeSafeGitActor.ask({ type: 'GET_STATUS' });
 * // TypeScript knows status has { isGitRepo: boolean; currentBranch?: string }
 *
 * // ❌ Invalid usage - immediate TypeScript error at call site
 * const invalid = await typeSafeGitActor.ask({ type: 'INVALID_TYPE' });
 * // Error: Argument of type '{ type: "INVALID_TYPE"; }' is not assignable to parameter of type 'never'
 * ```
 */
export function asTypeSafeActor<T extends MessageMap>(actor: ActorInstance): TypeSafeActor<T> {
  /**
   * Type guard to validate MessageUnion at runtime
   * Provides additional safety beyond compile-time checks
   */
  function isValidMessage(message: unknown): message is MessageUnion<T> {
    return (
      message !== null &&
      typeof message === 'object' &&
      'type' in message &&
      typeof (message as { type: unknown }).type === 'string'
    );
  }

  return {
    /**
     * Send a message using discriminated union constraint
     * ✅ FIXED: No type casting needed - TypeScript ensures validity at compile time
     */
    send: (message: MessageUnion<T>) => {
      // Runtime validation for extra safety
      if (!isValidMessage(message)) {
        throw new Error(`Invalid message format: Expected MessageUnion<T>, got ${typeof message}`);
      }

      // Send to underlying actor - all properties are guaranteed to exist by MessageUnion<T>
      actor.send({
        type: message.type as string, // MessageUnion ensures this is always a string
        payload: message.payload,
        correlationId: message.correlationId,
        timestamp: message.timestamp,
        version: message.version,
      });
    },

    /**
     * Ask with proper type inference using intersection types
     * ✅ FIXED: The & { type: K } ensures we can infer the specific return type T[K]
     */
    ask: <K extends keyof T>(message: MessageUnion<T> & { type: K }): Promise<T[K]> => {
      // Runtime validation for extra safety
      if (!isValidMessage(message)) {
        throw new Error(`Invalid message format: Expected MessageUnion<T>, got ${typeof message}`);
      }

      // Ask underlying actor WITHOUT explicit generic - let TypeScript infer
      // The return type Promise<T[K]> is guaranteed by our interface constraint
      return actor.ask({
        type: message.type as string, // MessageUnion ensures this is always a string
        payload: message.payload,
        correlationId: message.correlationId,
        timestamp: message.timestamp,
        version: message.version,
      }) as Promise<T[K]>;
    },

    // Pass through other methods unchanged
    start: () => actor.start(),
    stop: () => actor.stop(),
    subscribe: (eventType: string, handler: (event: ActorMessage) => void) =>
      actor.subscribe(eventType, handler),
  };
}

// Type guard function for ActorMessage validation
function isActorMessage(value: unknown): value is ActorMessage {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    typeof (value as { type: unknown }).type === 'string' &&
    'payload' in value &&
    'timestamp' in value &&
    typeof (value as { timestamp: unknown }).timestamp === 'number' &&
    'version' in value &&
    typeof (value as { version: unknown }).version === 'string'
  );
}
