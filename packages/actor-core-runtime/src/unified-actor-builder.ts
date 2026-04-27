/**
 * @module actor-core/runtime/unified-actor-builder
 * @description Unified actor creation API that bridges context and machine patterns
 *
 * This builder provides a single API for all actor patterns:
 * - Stateless actors (return void or MessagePlan)
 * - Context-based actors (return ActorHandlerResult)
 * - Machine-based actors (XState integration)
 * - Hybrid actors (combine all patterns)
 */

import type { AnyStateMachine, ContextFrom } from 'xstate';
import type { ActorBehavior, ActorDependencies, ActorMessage, JsonValue } from './actor-system.js';
import type { ActorToolbox } from './actor-tools.js';
import { registerMachineWithBehavior } from './machine-registry.js';
import type { DomainEvent, MessagePlan } from './message-plan.js';
import type { ActorHandlerResult } from './otp-types.js';
import type { TypedActorInstance } from './typed-actor-instance.js';

/**
 * Unified message handler that supports all return patterns
 * Can return:
 * - ActorHandlerResult (state update + optional emit/reply)
 * - MessagePlan (declarative communication)
 * - DomainEvent (direct event emission)
 * - void/undefined (no action)
 */
export type UnifiedMessageHandler<TMsg, TCtx, _TEmitted> = (params: {
  readonly message: TMsg;
  readonly actor: TypedActorInstance<TCtx>;
  readonly dependencies: ActorDependencies;
  readonly tools: ActorToolbox;
}) =>
  | ActorHandlerResult<TCtx, unknown>
  | DomainEvent
  | MessagePlan<DomainEvent>
  | undefined
  | void
  | Promise<
      | ActorHandlerResult<TCtx, unknown>
      | DomainEvent
      | MessagePlan<DomainEvent>
      | undefined
      // biome-ignore lint/suspicious/noConfusingVoidType: void allows handlers to not return anything for better DX
      | void
    >;

export type UnifiedTransitionHandler<
  TMsg extends ActorMessage,
  TType extends TMsg['type'],
  TCtx,
  TEmitted,
> = UnifiedMessageHandler<Extract<TMsg, { type: TType }>, TCtx, TEmitted>;

export type UnifiedTransitionHandlers<TMsg extends ActorMessage, TCtx, TEmitted> = {
  readonly [TType in TMsg['type']]?: UnifiedTransitionHandler<TMsg, TType, TCtx, TEmitted>;
};

/**
 * Internal spec for building actors
 */
export interface ActorSpec<TMsg, TCtx, TEmitted> {
  readonly initialContext?: TCtx;
  readonly handler?: UnifiedMessageHandler<TMsg, TCtx, TEmitted>;
  readonly transitionHandlers?: UnifiedTransitionHandlers<TMsg & ActorMessage, TCtx, TEmitted>;
  readonly startHandler?: () => void | Promise<void>;
  readonly stopHandler?: () => void | Promise<void>;
  readonly machine?: AnyStateMachine;
}

/**
 * Unified Actor Builder that supports all actor patterns
 */
export class UnifiedActorBuilder<TMsg extends ActorMessage, TEmitted, TCtx> {
  constructor(private readonly spec: ActorSpec<TMsg, TCtx, TEmitted> = {}) {}

  /**
   * Create a new builder instance
   */
  static define<TMsg extends ActorMessage>(): UnifiedActorBuilder<TMsg, unknown, unknown> {
    return new UnifiedActorBuilder<TMsg, unknown, unknown>();
  }

  /**
   * Set initial context for the actor
   */
  withContext<NewCtx>(context: NewCtx): UnifiedActorBuilder<TMsg, TEmitted, NewCtx> {
    return new UnifiedActorBuilder<TMsg, TEmitted, NewCtx>({
      initialContext: context,
      // Don't copy the handler as it has the wrong context type
      startHandler: this.spec.startHandler,
      stopHandler: this.spec.stopHandler,
      machine: this.spec.machine,
    });
  }

  /**
   * Attach an XState machine for state management
   * Extracts the context type from the machine for proper type inference
   */
  withMachine<TMachine extends AnyStateMachine>(
    machine: TMachine
  ): UnifiedActorBuilder<TMsg, TEmitted, ContextFrom<TMachine>> {
    return new UnifiedActorBuilder<TMsg, TEmitted, ContextFrom<TMachine>>({
      initialContext: machine.config.context as ContextFrom<TMachine>,
      // Don't copy handlers as they have the wrong context type
      startHandler: this.spec.startHandler,
      stopHandler: this.spec.stopHandler,
      machine,
    });
  }

  /**
   * Set the message handler
   */
  onMessage(
    handler: UnifiedMessageHandler<TMsg, TCtx, TEmitted>
  ): UnifiedActorBuilder<TMsg, TEmitted, TCtx> {
    return new UnifiedActorBuilder<TMsg, TEmitted, TCtx>({
      ...this.spec,
      handler,
    });
  }

  /**
   * Set machine-aware transition handlers keyed by message type.
   *
   * When a transition handler exists for an incoming message, the builder checks
   * the attached XState machine before running side effects. Messages without a
   * transition handler fall back to onMessage when one is provided.
   */
  onTransition(
    handlers: UnifiedTransitionHandlers<TMsg, TCtx, TEmitted>
  ): UnifiedActorBuilder<TMsg, TEmitted, TCtx> {
    return new UnifiedActorBuilder<TMsg, TEmitted, TCtx>({
      ...this.spec,
      transitionHandlers: handlers,
      handler: createTransitionDispatcher(this.spec.machine, handlers, this.spec.handler),
    });
  }

  /**
   * Set the start handler
   */
  onStart(handler: () => void | Promise<void>): UnifiedActorBuilder<TMsg, TEmitted, TCtx> {
    return new UnifiedActorBuilder<TMsg, TEmitted, TCtx>({
      ...this.spec,
      startHandler: handler,
    });
  }

  /**
   * Set the stop handler
   */
  onStop(handler: () => void | Promise<void>): UnifiedActorBuilder<TMsg, TEmitted, TCtx> {
    return new UnifiedActorBuilder<TMsg, TEmitted, TCtx>({
      ...this.spec,
      stopHandler: handler,
    });
  }

  /**
   * Build the actor behavior
   * Returns a properly typed ActorBehavior that includes phantom types for inference
   */
  build(): ActorSpec<TMsg, TCtx, TEmitted> &
    ActorBehavior<TMsg, TEmitted> & { __contextType: TCtx; __messageType: TMsg } {
    if (!this.spec.handler) {
      throw new Error('Message handler is required. Call onMessage() before build().');
    }

    // Create the runtime ActorBehavior
    // Note: The handler type mismatch is due to TypedActorInstance vs ActorInstance
    // This is safe because TypedActorInstance is a compile-time helper that doesn't exist at runtime
    const behavior: ActorBehavior<TMsg, TEmitted> = {
      onMessage: this.spec.handler as unknown as ActorBehavior<TMsg, TEmitted>['onMessage'],
      onStart: this.spec.startHandler,
      onStop: this.spec.stopHandler,
      context:
        this.spec.initialContext !== undefined
          ? (this.spec.initialContext as unknown as JsonValue)
          : undefined,
      types: {
        message: undefined as TMsg | undefined,
        emitted: undefined as TEmitted | undefined,
      },
    };

    // Return intersection type with phantom types for inference
    const builtBehavior = {
      ...this.spec,
      ...behavior,
      __contextType: this.spec.initialContext as TCtx,
      __messageType: {} as TMsg,
    } as ActorSpec<TMsg, TCtx, TEmitted> &
      ActorBehavior<TMsg, TEmitted> & { __contextType: TCtx; __messageType: TMsg };

    if (this.spec.machine && this.spec.transitionHandlers) {
      registerMachineWithBehavior(builtBehavior, this.spec.machine);
    }

    return builtBehavior;
  }
}

function createTransitionDispatcher<TMsg extends ActorMessage, TCtx, TEmitted>(
  machine: AnyStateMachine | undefined,
  handlers: UnifiedTransitionHandlers<TMsg, TCtx, TEmitted>,
  fallback: UnifiedMessageHandler<TMsg, TCtx, TEmitted> | undefined
): UnifiedMessageHandler<TMsg, TCtx, TEmitted> {
  return async (params) => {
    const handler = handlers[params.message.type as TMsg['type']] as
      | UnifiedMessageHandler<TMsg, TCtx, TEmitted>
      | undefined;

    if (!handler) {
      if (fallback) {
        return fallback(params);
      }

      throw new Error(`Actor transition "${params.message.type}" does not declare a handler.`);
    }

    if (!machine) {
      throw new Error(
        `Actor transition "${params.message.type}" requires withMachine(...) before onTransition(...).`
      );
    }

    const snapshot = params.actor.getSnapshot();
    if (!snapshot.can(params.message)) {
      throw new Error(
        `Actor cannot apply transition "${params.message.type}" from state "${String(snapshot.value)}".`
      );
    }

    params.actor.send(params.message);
    return handler(params);
  };
}

/**
 * Main export - unified actor definition function
 */
export function defineActor<TMsg extends ActorMessage = ActorMessage>(): UnifiedActorBuilder<
  TMsg,
  unknown,
  unknown
> {
  return UnifiedActorBuilder.define<TMsg>();
}
