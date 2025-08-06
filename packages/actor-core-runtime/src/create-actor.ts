/**
 * @module actor-core/runtime/create-actor
 * @description Unified actor creation API with type-safe event emission
 * @author Agent A - 2025-07-18
 *
 * This module implements the createActor function which provides a single API
 * for creating actors from various sources (ActorBehavior, XState machines, etc.)
 * while maintaining compile-time type safety for emitted events.
 */

import type { AnyStateMachine } from 'xstate';
import type { ActorInstance } from './actor-instance.js';
import type { ActorRef } from './actor-ref.js';
import { ActorSymbols } from './actor-symbols.js';
import type {
  ActorBehavior,
  ActorDependencies,
  ActorMessage,
  SupervisionStrategy,
} from './actor-system.js';
import { Logger } from './logger.js';
import { registerMachineWithBehavior } from './machine-registry.js';
import type { DomainEvent, MessagePlan } from './message-plan.js';
import { analyzeMessage, processSmartDefaults } from './otp-types.js';
import type { ActorSnapshot, JsonValue } from './types.js';

// ============================================================================
// THREE-PATTERN MESSAGE HANDLER TYPES (Phase 2.1 Task 2.2)
// ============================================================================

/**
 * Pure routing message handler - stateless message transformation
 * Returns array of messages directly for simple routing
 */
export type PureRoutingHandler<TMessage> = (params: {
  readonly message: TMessage;
}) => TMessage[] | undefined;

/**
 * OTP-style context handler - explicit context management like Erlang GenServer
 * Returns { context: newState, emit: [...] } for explicit state updates
 */
export type OTPContextHandler<TMessage, TContext> = (params: {
  readonly message: TMessage;
  readonly context: TContext;
}) =>
  | {
      context?: TContext;
      emit?: TMessage | TMessage[];
    }
  | undefined;

/**
 * XState machine handler - machine manages state automatically
 * Returns { emit: [...] } for event emission, state managed by machine
 */
export type XStateMachineHandler<TMessage> = (params: {
  readonly message: TMessage;
  readonly actor: ActorInstance;
}) =>
  | {
      emit?: TMessage | TMessage[];
    }
  | undefined;

// ============================================================================
// THREE-PATTERN BEHAVIOR INTERFACES (Phase 2.1 Task 2.2)
// ============================================================================

/**
 * Pure routing behavior - stateless message transformation
 */
export interface PureRoutingBehavior<TMessage> {
  readonly type: 'stateless';
  readonly onMessage: PureRoutingHandler<TMessage>;
  readonly template?: UniversalTemplate;
}

/**
 * OTP-style behavior - explicit context management
 */
export interface OTPContextBehavior<TMessage, TContext> {
  readonly type: 'otp';
  readonly onMessage: OTPContextHandler<TMessage, TContext>;
  readonly initialContext: TContext;
  readonly template?: UniversalTemplate;
}

/**
 * XState-style behavior - machine-managed state
 */
export interface XStateMachineBehavior<TMessage> {
  readonly type: 'xstate';
  readonly onMessage: XStateMachineHandler<TMessage>;
  readonly machine: AnyStateMachine;
  readonly template?: UniversalTemplate;
}

// ============================================================================
// DEFAULT STATELESS MACHINE (Phase 2.1 - Task 2.2)
// ============================================================================

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
  readonly actor: ActorInstance;
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
  readonly actor: ActorInstance;
  readonly dependencies: ActorDependencies;
  // ✅ No context: use actor.getSnapshot().context instead
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
    readonly actor: ActorInstance;
    readonly dependencies: ActorDependencies;
  }) => MessagePlan<TDomainEvent> | Promise<MessagePlan<TDomainEvent>> | void | Promise<void>;

  readonly onStop?: (params: {
    readonly actor: ActorInstance;
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
    readonly actor: ActorInstance;
    readonly dependencies: ActorDependencies;
  }) => MessagePlan<TDomainEvent> | Promise<MessagePlan<TDomainEvent>> | void | Promise<void>;

  readonly onStop?: (params: {
    readonly actor: ActorInstance;
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
  | ActorBehavior<TMessage, TEmitted>
  | XStateActorConfig
  | PureActorBehaviorConfig<TMessage, TEmitted>;

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
    !('configType' in config)
  );
}

// ============================================================================
// FLUENT BUILDER PATTERN TYPES WITH OTP SUPPORT
// ============================================================================

import type { OTPMessageHandler } from './otp-types.js';

/**
 * Base interface for all behavior builders
 * Supports pure routing, OTP-style context, and XState machine patterns
 */
export interface BehaviorBuilderBase<TMessage = ActorMessage, TEmitted = ActorMessage> {
  /**
   * Create a context-based actor with initial state
   * Locks out .withMachine() - compile-time mutual exclusivity
   */
  withContext<TContext>(
    initialContext: TContext
  ): ContextBehaviorBuilder<TMessage, TEmitted, TContext, TContext>;

  /**
   * Create a machine-based actor with XState machine
   * Locks out .withContext() - compile-time mutual exclusivity
   */
  withMachine(machine: AnyStateMachine): MachineBehaviorBuilder<TMessage, TEmitted>;
}

/**
 * Context-based behavior builder supporting OTP patterns with smart defaults
 * Can be used directly with spawn() - no .build() required!
 */
/**
 * Enhanced Context-based behavior builder implementing research-based type inference
 * Research Pattern #1: Type Accumulation - each method returns new typed builder
 * Research Pattern #4: Phantom Type Branding - compile-time type tracking
 */
export class ContextBehaviorBuilder<
  TMessage = ActorMessage,
  TEmitted = ActorMessage,
  TContext = unknown,
  TResponse = TContext,
> {
  // Research Pattern #4: Phantom type properties for compile-time inference
  readonly __contextType!: TContext;
  readonly __messageType!: TMessage;
  readonly __emittedType!: TEmitted;
  readonly __behaviorBuilder!: true; // Builder detection marker

  constructor(
    private readonly context: TContext,
    private readonly messageHandler?: OTPMessageHandler<TMessage, TContext, TResponse, TEmitted>,
    private readonly startHandler?: (params: {
      readonly actor: ActorInstance;
      readonly dependencies: ActorDependencies;
    }) => void | Promise<void>,
    private readonly stopHandler?: (params: {
      readonly actor: ActorInstance;
      readonly dependencies: ActorDependencies;
    }) => void | Promise<void>
  ) {}

  /**
   * Define the message handler with OTP patterns and smart defaults support
   * Research Pattern #1: Type Accumulation - returns new typed builder
   *
   * @example Smart Defaults Usage
   * ```typescript
   * .onMessage(({ message, actor, dependencies }) => {
   *   const context = actor.getSnapshot().context; // ✅ Now properly typed as TContext
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
   *         reply: { id: newUser.id, status: 'created' }
   *       };
   *   }
   * })
   * ```
   */
  onMessage<TNewResponse = TResponse>(
    handler: OTPMessageHandler<TMessage, TContext, TNewResponse, TEmitted>
  ): ContextBehaviorBuilder<TMessage, TEmitted, TContext, TNewResponse> {
    // Research Pattern #1: Return new builder preserving all type information
    return new ContextBehaviorBuilder(this.context, handler, this.startHandler, this.stopHandler);
  }

  /**
   * Define the actor startup handler
   */
  onStart(
    handler: (params: {
      readonly actor: ActorInstance;
      readonly dependencies: ActorDependencies;
    }) => void | Promise<void>
  ): ContextBehaviorBuilder<TMessage, TEmitted, TContext, TResponse> {
    if (!this.messageHandler) {
      throw new Error('onStart can only be called after onMessage');
    }
    return new ContextBehaviorBuilder(this.context, this.messageHandler, handler, this.stopHandler);
  }

  /**
   * Define the actor shutdown handler
   */
  onStop(
    handler: (params: {
      readonly actor: ActorInstance;
      readonly dependencies: ActorDependencies;
    }) => void | Promise<void>
  ): ContextBehaviorBuilder<TMessage, TEmitted, TContext, TResponse> {
    if (!this.messageHandler) {
      throw new Error('onStop can only be called after onMessage');
    }
    return new ContextBehaviorBuilder(
      this.context,
      this.messageHandler,
      this.startHandler,
      handler
    );
  }

  /**
   * Build the final actor behavior with type preservation (Research Pattern #4: Phantom Type Branding)
   * Called automatically when used with spawn() - no explicit .build() needed!
   */
  build(): ActorBehavior<TMessage, TEmitted> & { __contextType: TContext } {
    if (!this.messageHandler) {
      throw new Error('onMessage must be called before building the behavior');
    }

    // Create a runtime adapter that converts OTPMessageHandler to RuntimeMessageHandler
    const runtimeHandler = async (params: {
      readonly message: TMessage;
      readonly actor: ActorInstance;
      readonly dependencies: import('./actor-system.js').ActorDependencies;
    }) => {
      // Get the current context from the actor and cast it to the proper type
      // This is safe because we control the context type through the builder
      const snapshot = params.actor.getSnapshot();

      // Create a typed actor wrapper that provides the properly typed context
      const typedActor: ActorInstance & { getSnapshot(): ActorSnapshot<TContext> } = {
        ...params.actor,
        getSnapshot: (): ActorSnapshot<TContext> => ({
          ...snapshot,
          context: snapshot.context as TContext,
        }),
      };

      // Call the OTPMessageHandler with the properly typed actor parameter
      // The OTPMessageHandler signature expects actor: ActorInstance & { getSnapshot(): ActorSnapshot<TContext> }
      // which matches our typedActor type exactly
      if (!this.messageHandler) {
        return undefined;
      }

      const result = await this.messageHandler({
        message: params.message,
        actor: typedActor, // This should now preserve TContext type
        dependencies: params.dependencies,
      });

      // Convert OTPMessageHandler result to RuntimeMessageHandler result
      // OTPMessageHandler can return ActorHandlerResult, MessagePlan, void, or Promise variants
      // RuntimeMessageHandler expects the same types, so we can return as-is
      return result as
        | import('./otp-types.js').ActorHandlerResult<TContext, unknown>
        | import('./message-plan.js').MessagePlan<TEmitted>
        | undefined;
    };

    // Use the OTP-style behavior creation
    const behavior = createActorBehaviorFromConfig<TMessage, TEmitted, TContext, TEmitted>({
      context: this.context,
      onMessage: runtimeHandler as import('./otp-types.js').RuntimeMessageHandler<
        TMessage,
        TEmitted,
        TContext
      >,
      onStart: this.startHandler,
      onStop: this.stopHandler,
    });

    // Add phantom type for spawn() inference (Research Pattern #4)
    // This allows spawn() to extract TContext from the behavior
    (behavior as { __contextType?: TContext }).__contextType = undefined as TContext;
    return behavior as ActorBehavior<TMessage, TEmitted> & { __contextType: TContext };
  }

  toActorBehavior(): ActorBehavior<TMessage, TEmitted> {
    return this.build();
  }
}

/**
 * Machine-based behavior builder supporting XState integration
 * Can be used directly with spawn() - no .build() required!
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
    // Machine handlers already work with unknown context, so we can use them directly
    // But we still need to convert to RuntimeMessageHandler
    const runtimeHandler: import('./otp-types.js').RuntimeMessageHandler<
      TMessage,
      TEmitted,
      unknown
    > = handler;

    return createActorBehaviorFromConfig<TMessage, TEmitted, unknown, TEmitted>({
      machine: this.machine,
      onMessage: runtimeHandler,
    });
  }
}

/**
 * Template-based behavior builder supporting template integration (NEW - TASK 2.1.1)
 * Follows the same pattern as ContextBehaviorBuilder and MachineBehaviorBuilder
 */
export class TemplateBehaviorBuilder<TMessage = ActorMessage, TEmitted = ActorMessage> {
  constructor(private readonly template: UniversalTemplate) {}

  /**
   * Add context after template definition
   * Allows: defineActor().withTemplate().withContext().onMessage()
   */
  withContext<TContext>(
    initialContext: TContext
  ): TemplateContextBehaviorBuilder<TMessage, TEmitted, TContext> {
    return new TemplateContextBehaviorBuilder<TMessage, TEmitted, TContext>(
      this.template,
      initialContext
    );
  }

  /**
   * Add machine after template definition
   * Allows: defineActor().withTemplate().withMachine().onMessage()
   */
  withMachine(machine: AnyStateMachine): TemplateMachineBehaviorBuilder<TMessage, TEmitted> {
    return new TemplateMachineBehaviorBuilder<TMessage, TEmitted>(this.template, machine);
  }

  /**
   * Define message handler directly after template
   * Allows: defineActor().withTemplate().onMessage()
   */
  onMessage(
    handler: OTPMessageHandler<TMessage, unknown, unknown, TEmitted>
  ): ActorBehavior<TMessage, TEmitted> {
    // Convert to RuntimeMessageHandler
    const runtimeHandler: import('./otp-types.js').RuntimeMessageHandler<
      TMessage,
      TEmitted,
      unknown
    > = handler;

    return createActorBehaviorFromConfig<TMessage, TEmitted, unknown, TEmitted>({
      template: this.template,
      onMessage: runtimeHandler,
    });
  }
}

/**
 * Combined template + context behavior builder (NEW - TASK 2.1.1)
 */
export class TemplateContextBehaviorBuilder<
  TMessage = ActorMessage,
  TEmitted = ActorMessage,
  TContext = unknown,
> {
  constructor(
    private readonly template: UniversalTemplate,
    private readonly context: TContext
  ) {}

  onMessage(
    handler: OTPMessageHandler<TMessage, TContext, TContext, TEmitted>
  ): ActorBehavior<TMessage, TEmitted> {
    // Create a runtime adapter that converts typed handler to runtime handler
    const runtimeHandler = async (params: {
      readonly message: TMessage;
      readonly actor: ActorInstance;
      readonly dependencies: import('./actor-system.js').ActorDependencies;
    }) => {
      // Create a typed actor wrapper for the handler
      const typedActor: ActorInstance & { getSnapshot(): ActorSnapshot<TContext> } = {
        ...params.actor,
        getSnapshot: () => {
          const snapshot = params.actor.getSnapshot();
          // At runtime, we know the context is TContext
          // This is safe because we control the context through the builder
          return {
            ...snapshot,
            context: snapshot.context as TContext,
          };
        },
      };

      // Call the typed handler with the typed actor
      const result = await handler({
        message: params.message,
        actor: typedActor,
        dependencies: params.dependencies,
      });

      // Handle the result based on its type
      if (result === undefined || result === null) {
        return undefined;
      }

      // Check if it's an ActorHandlerResult
      if (
        typeof result === 'object' &&
        ('context' in result || 'reply' in result || 'behavior' in result || 'emit' in result)
      ) {
        // Convert typed ActorHandlerResult to runtime ActorHandlerResult
        const handlerResult = result as import('./otp-types.js').ActorHandlerResult<
          TContext,
          TContext
        >;
        return {
          context: handlerResult.context,
          reply: handlerResult.reply,
          behavior: handlerResult.behavior,
          emit: handlerResult.emit,
        } as import('./otp-types.js').ActorHandlerResult<unknown, unknown>;
      }

      // Otherwise it's a MessagePlan
      return result as import('./message-plan.js').MessagePlan<TEmitted>;
    };

    // Type the handler to satisfy RuntimeMessageHandler requirements
    const typedRuntimeHandler: import('./otp-types.js').RuntimeMessageHandler<
      TMessage,
      TEmitted,
      TContext
    > = runtimeHandler as import('./otp-types.js').RuntimeMessageHandler<
      TMessage,
      TEmitted,
      TContext
    >;

    return createActorBehaviorFromConfig<TMessage, TEmitted, TContext, TEmitted>({
      template: this.template,
      context: this.context,
      onMessage: typedRuntimeHandler,
    });
  }
}

/**
 * Combined template + machine behavior builder (NEW - TASK 2.1.1)
 */
export class TemplateMachineBehaviorBuilder<TMessage = ActorMessage, TEmitted = ActorMessage> {
  constructor(
    private readonly template: UniversalTemplate,
    private readonly machine: AnyStateMachine
  ) {}

  onMessage(
    handler: OTPMessageHandler<TMessage, unknown, unknown, TEmitted>
  ): ActorBehavior<TMessage, TEmitted> {
    // Convert to RuntimeMessageHandler
    const runtimeHandler: import('./otp-types.js').RuntimeMessageHandler<
      TMessage,
      TEmitted,
      unknown
    > = handler;

    return createActorBehaviorFromConfig<TMessage, TEmitted, unknown, TEmitted>({
      template: this.template,
      machine: this.machine,
      onMessage: runtimeHandler,
    });
  }
}

/**
 * Helper function to create ActorBehavior from builder config
 * This bridges the fluent builder API with the existing behavior system with OTP patterns
 *
 * Uses feature flags instead of combinatorial config types for simplicity:
 * - context?: present = has context
 * - machine?: present = has machine
 * - template?: present = has template
 *
 * Note: context and machine are mutually exclusive (enforced by builder types)
 */
function createActorBehaviorFromConfig<
  TMessage,
  TEmitted,
  TContext = unknown,
  TDomainEvent = TEmitted,
>(config: {
  context?: TContext;
  machine?: AnyStateMachine;
  template?: UniversalTemplate;
  onMessage: import('./otp-types.js').RuntimeMessageHandler<TMessage, TDomainEvent, TContext>;
  onStart?: (params: {
    readonly actor: ActorInstance;
    readonly dependencies: ActorDependencies;
  }) => void | Promise<void>;
  onStop?: (params: {
    readonly actor: ActorInstance;
    readonly dependencies: ActorDependencies;
  }) => void | Promise<void>;
}): ActorBehavior<TMessage, TEmitted> {
  const hasContext = config.context !== undefined;
  const hasMachine = config.machine !== undefined;
  const hasTemplate = config.template !== undefined;

  log.debug('Creating ActorBehavior from fluent builder config', {
    hasContext,
    hasMachine,
    hasTemplate,
  });

  // Validate mutual exclusivity (should never happen due to type system, but good safeguard)
  if (hasContext && hasMachine) {
    throw new Error('Invalid configuration: context and machine are mutually exclusive');
  }

  const behavior: ActorBehavior<TMessage, TEmitted> = {
    // Add context if provided
    context: config.context as JsonValue | undefined,
    // Convert OTP message handler to standard ActorBehavior onMessage
    onMessage: async (params) => {
      try {
        log.debug('Processing OTP message with enhanced processor', {
          messageType: (params.message as { type?: string })?.type || 'unknown',
          hasContext,
          hasMachine,
          hasTemplate,
          actorId: params.dependencies.actorId,
        });

        // Execute OTP message handler
        const result = await config.onMessage({
          message: params.message as TMessage,
          actor: params.actor,
          dependencies: params.dependencies,
        });

        log.debug('🔍 OTP DEBUG: Message handler result', {
          result,
          resultType: typeof result,
          isObject: result && typeof result === 'object',
          hasContextProperty: result && typeof result === 'object' && 'context' in result,
          actorId: params.dependencies.actorId,
        });

        // Handle OTP results (context updates, effects, responses)
        const isOTPResult =
          result &&
          typeof result === 'object' &&
          ('context' in result ||
            'reply' in result ||
            'response' in result ||
            'emit' in result ||
            'effects' in result ||
            'behavior' in result);

        if (isOTPResult) {
          log.debug('🔍 OTP DEBUG: OTP result detected', {
            hasContext: 'context' in result,
            hasResponse: 'response' in result,
            hasBehavior: 'behavior' in result,
            hasEffects: 'effects' in result,
            hasEmit: 'emit' in result,
            resultKeys: Object.keys(result),
            actorId: params.dependencies.actorId,
          });

          // Import OTP processor dynamically for efficient loading
          const { OTPMessagePlanProcessor } = await import('./otp-message-plan-processor.js');
          const otpProcessor = new OTPMessagePlanProcessor();

          // Type assertion after successful type guard check
          const otpResult = result as import('./otp-types.js').ActorHandlerResult<unknown, unknown>;

          // Process smart defaults (using existing logic)
          const messageAnalysis = analyzeMessage(params.message as ActorMessage);
          const smartDefaults = processSmartDefaults(otpResult, messageAnalysis);

          log.debug('OTP result with smart defaults', {
            hasContext: otpResult.context !== undefined,
            hasReply: otpResult.reply !== undefined,
            hasBehavior: otpResult.behavior !== undefined,
            hasEmit: otpResult.emit !== undefined,
            responseSource: smartDefaults.responseSource,
            shouldRespond: smartDefaults.shouldRespond,
            actorId: params.dependencies.actorId,
          });

          // Create enhanced result with smart defaults applied
          const enhancedResult: import('./otp-types.js').ActorHandlerResult<unknown, unknown> = {
            context: otpResult.context,
            reply: smartDefaults.shouldRespond ? smartDefaults.finalResponse : otpResult.reply,
            behavior: otpResult.behavior,
            // ✅ UNIFIED API DESIGN Phase 2.1: Preserve emit arrays
            emit: otpResult.emit,
          };

          // Process OTP patterns (context updates, behavior switching, effects, responses)
          await otpProcessor.processOTPResult(
            enhancedResult,
            params.dependencies.actorId,
            params.actor,
            params.dependencies,
            (params.message as ActorMessage)._correlationId,
            (params.message as ActorMessage).type // Pass original message type for response compatibility
          );

          log.debug('🔍 OTP DEBUG: OTP processor called successfully', {
            actorId: params.dependencies.actorId,
            messageType: (params.message as ActorMessage).type,
          });

          // Return undefined - all processing handled by OTP processor
          return undefined;
        }

        // Handle MessagePlan returns
        return result;
      } catch (error) {
        log.error('Error in OTP message handler', {
          error,
          actorId: params.dependencies.actorId,
          messageType: (params.message as { type?: string })?.type || 'unknown',
          correlationId: (params.message as ActorMessage)._correlationId,
        });

        // For ask patterns (messages with correlationId), send error as response
        const correlationId = (params.message as ActorMessage)._correlationId;
        if (correlationId) {
          // Import OTP processor dynamically to send error response
          const { OTPMessagePlanProcessor } = await import('./otp-message-plan-processor.js');
          const otpProcessor = new OTPMessagePlanProcessor();

          // Send error response
          await otpProcessor.processOTPResult(
            {
              context: undefined, // Don't update context on error
              reply: {
                error: error instanceof Error ? error.message : 'Unknown error',
                errorType: 'HANDLER_ERROR',
              },
              behavior: undefined,
            },
            params.dependencies.actorId,
            params.actor,
            params.dependencies,
            correlationId,
            'ERROR_RESPONSE' // Use ERROR_RESPONSE type for error responses
          );

          // Don't re-throw for ask patterns - we've handled it by sending error response
          return undefined;
        }

        // Re-throw for non-ask patterns (normal send)
        throw error;
      }
    },

    // Pass through lifecycle handlers
    onStart: config.onStart,
    onStop: config.onStop,
  };

  // Template integration (NEW - TASK 2.1.2)
  if (hasTemplate && config.template) {
    // Attach template as non-enumerable property using symbol-based approach
    Object.defineProperty(behavior, ActorSymbols.TEMPLATE, {
      value: config.template,
      enumerable: false,
      configurable: false,
      writable: false,
    });

    // Add template rendering method to behavior
    Object.defineProperty(behavior, 'renderTemplate', {
      value: (context?: unknown) => {
        // Use provided context, behavior context, or machine snapshot context
        const renderContext = context || (behavior as { context?: unknown }).context || {};

        if (!config.template) {
          throw new Error('Template not available for rendering');
        }

        return renderTemplate(config.template, renderContext);
      },
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }

  // Register the machine with the enhanced registry system (symbol-based)
  if (config.machine) {
    registerMachineWithBehavior(behavior, config.machine);
  }

  return behavior;
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
 * const behavior = defineActor({
 *   onMessage: async ({ message, machine, dependencies }) => {
 *     // Process message using machine state and dependencies
 *     const currentState = machine.getSnapshot();
 *
 *     if (message.type === 'INCREMENT') {
 *       // Send event to machine for state transition
 *       machine.send({ type: 'INCREMENT', value: message?.value });
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
 * const xstateBehavior = defineActor({
 *   machine: counterMachine,
 *   input: { count: 0 }
 * });
 * ```
 */
// CoordinatorMachineBuilder was removed - use unified-actor-builder.ts instead

/**
 * Enhanced type utilities for research-based type inference system
 * Implements patterns from docs/research/context-type-inference.md
 */

/**
 * Extract context type from behavior builders (Research Pattern #3)
 * Uses distributive conditional types to detect context type
 */
export type ActorContextType<T> = T extends ContextBehaviorBuilder<
  unknown,
  unknown,
  infer C,
  unknown
>
  ? C
  : T extends { __contextType: infer C }
    ? C
    : T extends ActorBehavior<unknown, unknown>
      ? unknown
      : never;

/**
 * Extract message type from behavior builders and behaviors
 */
export type ActorMessageType<T> = T extends ContextBehaviorBuilder<
  infer M,
  unknown,
  unknown,
  unknown
>
  ? M
  : T extends { __messageType: infer M }
    ? M
    : T extends ActorBehavior<infer M, unknown>
      ? M
      : ActorMessage;

/**
 * Extract emitted type from behavior builders and behaviors
 */
export type ActorEmittedType<T> = T extends ContextBehaviorBuilder<
  unknown,
  infer E,
  unknown,
  unknown
>
  ? E
  : T extends { __emittedType: infer E }
    ? E
    : T extends ActorBehavior<unknown, infer E>
      ? E
      : ActorMessage;

/**
 * Behavior detection utility for spawn method overloading
 */
export type IsBehaviorBuilder<T> = T extends ContextBehaviorBuilder<
  unknown,
  unknown,
  unknown,
  unknown
>
  ? true
  : T extends { __behaviorBuilder: true }
    ? true
    : false;

/**
 * Helper to detect if a type is a context behavior specifically
 */
export type IsContextBehavior<T> = T extends ContextBehaviorBuilder<
  unknown,
  unknown,
  infer C,
  unknown
>
  ? C extends never
    ? false
    : true
  : false;

// ============================================================================
// UNIFIED ACTOR INTERFACE (RESEARCH-VALIDATED)
// ============================================================================

/**
 * Enhanced behavior inference supporting simplified operation-based typing (TASK 2.1.3)
 * Provides compile-time type safety for message handling and response generation
 */
export type ActorRefFromBehavior<B extends ActorBehavior<unknown, unknown>> =
  B extends ActorBehavior<infer TMessage, unknown>
    ? ActorRef<unknown, TMessage extends ActorMessage ? TMessage : ActorMessage>
    : never;

/**
 * Simplified operation-based typing - eliminates redundancy (IMPROVED APPROACH)
 * Single source of truth for request/response pairs
 *
 * @example
 * ```typescript
 * interface UserOperations {
 *   'CREATE_USER': {
 *     request: { name: string; email: string };
 *     response: { user: User; success: boolean };
 *   };
 *   'UPDATE_USER': {
 *     request: { id: string; changes: Partial<User> };
 *     response: { user: User };
 *   };
 * }
 *
 * type UserMessage = RequestFromOperations<UserOperations>;
 * type UserResponse = ResponseFromOperations<UserOperations>;
 * ```
 */
export type OperationMap = Record<
  string,
  {
    request: unknown;
    response: unknown;
  }
>;

/**
 * Extract request message types from operation map (SIMPLIFIED APPROACH)
 */
export type RequestFromOperations<TOperations extends OperationMap> = {
  [K in keyof TOperations]: TOperations[K]['request'] extends void
    ? { type: K }
    : { type: K } & TOperations[K]['request']; // Flat structure
}[keyof TOperations];

/**
 * Extract response types from operation map (SIMPLIFIED APPROACH)
 */
export type ResponseFromOperations<TOperations extends OperationMap> = {
  [K in keyof TOperations]: TOperations[K]['response'];
}[keyof TOperations];

/**
 * Type-safe ask pattern using operation map (SIMPLIFIED APPROACH)
 */
export type TypeSafeOperationActor<TOperations extends OperationMap> = {
  send: <K extends keyof TOperations>(
    messageType: K,
    ...args: TOperations[K]['request'] extends void ? [] : [data: TOperations[K]['request']]
  ) => Promise<void>;

  ask: <K extends keyof TOperations>(
    messageType: K,
    ...args: TOperations[K]['request'] extends void ? [] : [data: TOperations[K]['request']]
  ) => Promise<TOperations[K]['response']>;
};

/**
 * Advanced type inference for three-pattern builder system (Phase 2.1 Task 2.2)
 * Maintains type safety throughout the entire builder chain
 */
export type InferMessageType<T> = T extends BehaviorBuilderBase<infer TMessage>
  ? TMessage
  : T extends OTPContextBuilder<infer TMessage, unknown>
    ? TMessage
    : T extends XStateMachineBuilder<infer TMessage>
      ? TMessage
      : T extends PureRoutingBuilder<infer TMessage>
        ? TMessage
        : never;

/**
 * Infer behavior types from three-pattern builders (Phase 2.1 Task 2.2)
 */
export type InferBehaviorType<T> = T extends PureRoutingBehavior<infer TMessage>
  ? PureRoutingBehavior<TMessage>
  : T extends OTPContextBehavior<infer TMessage, infer TContext>
    ? OTPContextBehavior<TMessage, TContext>
    : T extends XStateMachineBehavior<infer TMessage>
      ? XStateMachineBehavior<TMessage>
      : never;

/**
 * Comprehensive behavior type extraction supporting all builder patterns (TASK 2.1.3)
 * Provides unified type inference across the entire fluent API
 */
export type BehaviorTypeInference<T> = T extends ActorBehavior<infer TMessage, infer TEmitted>
  ? {
      message: TMessage;
      emitted: TEmitted;
      actor: ActorRef<unknown, TMessage extends ActorMessage ? TMessage : ActorMessage>;
    }
  : never;

// ============================================================================
// UTILITY FUNCTIONS (RESTORED)
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
 * Pure routing builder - stateless message transformation
 */
export class PureRoutingBuilder<TMessage> {
  constructor(private template?: UniversalTemplate) {}

  onMessage(handler: PureRoutingHandler<TMessage>): PureRoutingBehavior<TMessage> {
    return {
      type: 'stateless',
      onMessage: handler,
      template: this.template,
    };
  }

  withTemplate(template: UniversalTemplate): PureRoutingBuilder<TMessage> {
    return new PureRoutingBuilder<TMessage>(template);
  }
}

/**
 * OTP-style context builder with mutual exclusivity enforcement
 */
export class OTPContextBuilder<TMessage, TContext> {
  constructor(
    private initialContext: TContext,
    private template?: UniversalTemplate
  ) {}

  onMessage(
    handler: OTPContextHandler<TMessage, TContext>
  ): OTPContextBehavior<TMessage, TContext> {
    return {
      type: 'otp',
      onMessage: handler,
      initialContext: this.initialContext,
      template: this.template,
    };
  }

  withTemplate(template: UniversalTemplate): OTPContextBuilder<TMessage, TContext> {
    return new OTPContextBuilder<TMessage, TContext>(this.initialContext, template);
  }

  /**
   * Mutual exclusivity enforcement - withMachine() not allowed after withContext()
   */
  withMachine(_machine: AnyStateMachine): never {
    throw new Error(
      'Mutual exclusivity violation: withMachine() cannot be used after withContext(). ' +
        'Use either withContext() for OTP-style state management OR withMachine() for XState management, not both.'
    );
  }
}

/**
 * XState machine builder with mutual exclusivity enforcement
 */
export class XStateMachineBuilder<TMessage> {
  constructor(
    private machine: AnyStateMachine,
    private template?: UniversalTemplate
  ) {}

  onMessage(handler: XStateMachineHandler<TMessage>): XStateMachineBehavior<TMessage> {
    return {
      type: 'xstate',
      onMessage: handler,
      machine: this.machine,
      template: this.template,
    };
  }

  withTemplate(template: UniversalTemplate): XStateMachineBuilder<TMessage> {
    return new XStateMachineBuilder<TMessage>(this.machine, template);
  }

  /**
   * Mutual exclusivity enforcement - withContext() not allowed after withMachine()
   */
  withContext<TContext>(_initialContext: TContext): never {
    throw new Error(
      'Mutual exclusivity violation: withContext() cannot be used after withMachine(). ' +
        'Use either withMachine() for XState state management OR withContext() for OTP-style management, not both.'
    );
  }
}

// ============================================================================
// BEHAVIOR BRIDGE (Phase 2.1 Task 2.2) - SIMPLIFIED
// ============================================================================

/**
 * Union type for all supported behavior patterns
 */
export type UnifiedBehavior<TMessage> =
  | PureRoutingBehavior<TMessage>
  | OTPContextBehavior<TMessage, unknown>
  | XStateMachineBehavior<TMessage>
  | ActorBehavior<TMessage, unknown>;

/**
 * Type guard to check if a behavior is OTP-style
 */
export function isOTPBehavior<TMessage>(
  behavior: UnifiedBehavior<TMessage>
): behavior is OTPContextBehavior<TMessage, unknown> {
  return 'type' in behavior && behavior.type === 'otp';
}

/**
 * Type guard to check if a behavior is pure routing
 */
export function isPureRoutingBehavior<TMessage>(
  behavior: UnifiedBehavior<TMessage>
): behavior is PureRoutingBehavior<TMessage> {
  return 'type' in behavior && behavior.type === 'stateless';
}

/**
 * Type guard to check if a behavior is XState-style
 */
export function isXStateBehavior<TMessage>(
  behavior: UnifiedBehavior<TMessage>
): behavior is XStateMachineBehavior<TMessage> {
  return 'type' in behavior && behavior.type === 'xstate';
}

// ============================================================================
// 🎯 PUBLIC API - Actor Creation Functions
// ============================================================================

/**
 * Minimal UniversalTemplate interface to satisfy type references
 * TODO: Restore full template system after foundation stability
 */
export interface UniversalTemplate {
  readonly strings: ReadonlyArray<string>;
  readonly values: ReadonlyArray<unknown>;
}

/**
 * Minimal template function for compatibility
 */
export function template(strings: TemplateStringsArray, ...values: unknown[]): UniversalTemplate {
  return { strings: [...strings], values };
}

/**
 * Minimal renderTemplate function for compatibility
 */
export function renderTemplate<TContext = unknown>(
  template: UniversalTemplate,
  _context: TContext
): string {
  return template.strings.join('');
}

// ActorInstance is imported from actor-instance.js

/**
 * Create actor function - creates an ActorBehavior that can be spawned
 */
export function createActor<TMessage extends ActorMessage = ActorMessage>(
  config: ActorBehavior<TMessage>
): ActorBehavior<TMessage> {
  return config;
}
