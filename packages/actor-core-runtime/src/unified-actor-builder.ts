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

export interface ActorFSMTransitionParams<TMsg extends ActorMessage, TCtx, TState extends string> {
  readonly message: TMsg;
  readonly state: TState;
  readonly context: TCtx;
}

export type ActorFSMTransitionTarget<TMsg extends ActorMessage, TCtx, TState extends string> =
  | TState
  | ((params: ActorFSMTransitionParams<TMsg, TCtx, TState>) => TState);

export interface ActorFSMTransition<TMsg extends ActorMessage, TCtx, TState extends string> {
  readonly target: ActorFSMTransitionTarget<TMsg, TCtx, TState>;
  readonly guard?: (params: ActorFSMTransitionParams<TMsg, TCtx, TState>) => boolean;
  readonly metadata?: Record<string, JsonValue>;
}

export type ActorFSMTransitionInput<TMsg extends ActorMessage, TCtx, TState extends string> =
  | ActorFSMTransitionTarget<TMsg, TCtx, TState>
  | ActorFSMTransition<TMsg, TCtx, TState>;

export type ActorFSMStateConfig<TMsg extends ActorMessage, TCtx, TState extends string> = {
  readonly on?: {
    readonly [TType in TMsg['type']]?: ActorFSMTransitionInput<
      Extract<TMsg, { type: TType }>,
      TCtx,
      TState
    >;
  };
};

export interface ActorFSMDefinition<
  TMsg extends ActorMessage,
  TCtx = unknown,
  TState extends string = string,
> {
  readonly initial: TState;
  readonly states: {
    readonly [TKey in TState]: ActorFSMStateConfig<TMsg, TCtx, TState>;
  };
}

export interface ActorTransitionErrorValue {
  readonly ok: false;
  readonly error: {
    readonly code: 'INVALID_TRANSITION';
    readonly messageType: string;
    readonly state: string;
    readonly allowedTransitions: readonly string[];
  };
}

/**
 * Internal spec for building actors
 */
export interface ActorSpec<TMsg extends ActorMessage, TCtx, TEmitted> {
  readonly initialContext?: TCtx;
  readonly handler?: UnifiedMessageHandler<TMsg, TCtx, TEmitted>;
  readonly transitionHandlers?: UnifiedTransitionHandlers<TMsg & ActorMessage, TCtx, TEmitted>;
  readonly fsm?: ActorFSMDefinition<TMsg, TCtx, string>;
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
    if (this.spec.fsm) {
      throw new Error('withMachine(...) and withFSM(...) cannot be used together.');
    }

    return new UnifiedActorBuilder<TMsg, TEmitted, ContextFrom<TMachine>>({
      initialContext: machine.config.context as ContextFrom<TMachine>,
      // Don't copy handlers as they have the wrong context type
      startHandler: this.spec.startHandler,
      stopHandler: this.spec.stopHandler,
      machine,
    });
  }

  /**
   * Attach a lightweight Actor-Web FSM constraint map.
   *
   * The FSM is intentionally pure and synchronous. I/O, tools, emits, replies,
   * and context updates belong in onTransition handlers.
   */
  withFSM<TState extends string>(
    fsm: ActorFSMDefinition<TMsg, TCtx, TState>
  ): UnifiedActorBuilder<TMsg, TEmitted, TCtx> {
    if (this.spec.machine) {
      throw new Error('withMachine(...) and withFSM(...) cannot be used together.');
    }

    return new UnifiedActorBuilder<TMsg, TEmitted, TCtx>({
      ...this.spec,
      fsm: fsm as ActorFSMDefinition<TMsg, TCtx, string>,
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
    if (!this.spec.machine && !this.spec.fsm) {
      throw new Error('onTransition(...) requires withMachine(...) or withFSM(...).');
    }

    const handler = this.spec.fsm
      ? createFSMTransitionDispatcher(this.spec.fsm, handlers, this.spec.handler)
      : createTransitionDispatcher(this.spec.machine, handlers, this.spec.handler);

    return new UnifiedActorBuilder<TMsg, TEmitted, TCtx>({
      ...this.spec,
      transitionHandlers: handlers,
      handler,
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

    if (this.spec.transitionHandlers && !this.spec.machine && !this.spec.fsm) {
      throw new Error('onTransition(...) requires withMachine(...) or withFSM(...).');
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
      return createInvalidTransitionResult<TCtx>(
        params.message,
        String(snapshot.value),
        getAllowedTransitionsFromSnapshot(snapshot)
      );
    }

    params.actor.send(params.message);
    return handler(params);
  };
}

function createFSMTransitionDispatcher<TMsg extends ActorMessage, TCtx, TEmitted>(
  fsm: ActorFSMDefinition<TMsg, TCtx>,
  handlers: UnifiedTransitionHandlers<TMsg, TCtx, TEmitted>,
  fallback: UnifiedMessageHandler<TMsg, TCtx, TEmitted> | undefined
): UnifiedMessageHandler<TMsg, TCtx, TEmitted> {
  const actorStates = new WeakMap<TypedActorInstance<TCtx>, string>();

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

    const currentState = actorStates.get(params.actor) ?? fsm.initial;
    const stateConfig = fsm.states[currentState];
    const transition = stateConfig?.on?.[params.message.type as TMsg['type']];
    const allowedTransitions = Object.keys(stateConfig?.on ?? {});

    if (!transition) {
      return createInvalidTransitionResult<TCtx>(params.message, currentState, allowedTransitions);
    }

    const normalizedTransition: ActorFSMTransition<TMsg, TCtx, string> =
      typeof transition === 'string' || typeof transition === 'function'
        ? ({ target: transition } as ActorFSMTransition<TMsg, TCtx, string>)
        : (transition as ActorFSMTransition<TMsg, TCtx, string>);
    const transitionParams = {
      message: params.message,
      state: currentState,
      context: params.actor.getSnapshot().context,
    } as ActorFSMTransitionParams<TMsg, TCtx, string>;

    if (normalizedTransition.guard && !normalizedTransition.guard(transitionParams)) {
      return createInvalidTransitionResult<TCtx>(params.message, currentState, allowedTransitions);
    }

    const target =
      typeof normalizedTransition.target === 'function'
        ? normalizedTransition.target(transitionParams)
        : normalizedTransition.target;
    actorStates.set(params.actor, target);

    return handler(params);
  };
}

function createInvalidTransitionResult<TCtx>(
  message: ActorMessage,
  state: string,
  allowedTransitions: readonly string[]
): ActorHandlerResult<TCtx, ActorTransitionErrorValue> {
  const error: ActorTransitionErrorValue = {
    ok: false,
    error: {
      code: 'INVALID_TRANSITION',
      messageType: message.type,
      state,
      allowedTransitions,
    },
  };

  return {
    reply: error,
    emit: [
      {
        type: 'ACTOR_TRANSITION_REJECTED',
        messageType: message.type,
        state,
        allowedTransitions,
      },
    ],
  } as ActorHandlerResult<TCtx, ActorTransitionErrorValue>;
}

function getAllowedTransitionsFromSnapshot(snapshot: { toJSON(): object }): readonly string[] {
  const serialized = snapshot.toJSON() as { nextEvents?: unknown };
  return Array.isArray(serialized.nextEvents)
    ? serialized.nextEvents.filter((event): event is string => typeof event === 'string')
    : [];
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

export function defineFSM<
  TMsg extends ActorMessage,
  TCtx = unknown,
  TState extends string = string,
>(fsm: ActorFSMDefinition<TMsg, TCtx, TState>): ActorFSMDefinition<TMsg, TCtx, TState> {
  return fsm;
}
