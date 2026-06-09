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
import type { ActorBehavior, ActorMessage, JsonValue } from './actor-system.js';
import type { ActorToolbox, ActorToolRegistry, UntypedActorToolRegistry } from './actor-tools.js';
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
export type UnifiedMessageHandler<
  TMsg,
  TCtx,
  _TEmitted,
  TTools extends ActorToolRegistry = UntypedActorToolRegistry,
> = (params: {
  readonly message: TMsg;
  readonly context: TCtx;
  readonly actor: TypedActorInstance<TCtx>;
  readonly tools: ActorToolbox<TTools>;
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
  TTools extends ActorToolRegistry = UntypedActorToolRegistry,
> = UnifiedMessageHandler<Extract<TMsg, { type: TType }>, TCtx, TEmitted, TTools>;

export type UnifiedTransitionHandlers<
  TMsg extends ActorMessage,
  TCtx,
  TEmitted,
  TTools extends ActorToolRegistry = UntypedActorToolRegistry,
> = {
  readonly [TType in TMsg['type']]?: UnifiedTransitionHandler<TMsg, TType, TCtx, TEmitted, TTools>;
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
export interface ActorSpec<
  TMsg extends ActorMessage,
  TCtx,
  TEmitted,
  TTools extends ActorToolRegistry = UntypedActorToolRegistry,
> {
  readonly initialContext?: TCtx;
  readonly handler?: UnifiedMessageHandler<TMsg, TCtx, TEmitted, TTools>;
  readonly transitionHandlers?: UnifiedTransitionHandlers<
    TMsg & ActorMessage,
    TCtx,
    TEmitted,
    TTools
  >;
  readonly fsm?: ActorFSMDefinition<TMsg, TCtx, string>;
  readonly startHandler?: () => void | Promise<void>;
  readonly stopHandler?: () => void | Promise<void>;
  readonly machine?: AnyStateMachine;
}

/**
 * Unified Actor Builder that supports all actor patterns
 */
export class UnifiedActorBuilder<
  TMsg extends ActorMessage,
  TEmitted,
  TCtx,
  TTools extends ActorToolRegistry = UntypedActorToolRegistry,
> {
  // Phantom type carriers so an un-built builder passed directly as a topology
  // `behavior` still exposes its context/message/emitted types to the
  // ActorWebBehavior* inference helpers. `declare` emits no runtime field.
  declare readonly __contextType: TCtx;
  declare readonly __messageType: TMsg;
  declare readonly __emittedType: TEmitted;

  constructor(private readonly spec: ActorSpec<TMsg, TCtx, TEmitted, TTools> = {}) {}

  /**
   * Create a new builder instance
   */
  static define<TMsg extends ActorMessage>(): UnifiedActorBuilder<TMsg, unknown, unknown> {
    return new UnifiedActorBuilder<TMsg, unknown, unknown>();
  }

  /**
   * Set initial context for the actor
   */
  withContext<NewCtx>(context: NewCtx): UnifiedActorBuilder<TMsg, TEmitted, NewCtx, TTools> {
    return new UnifiedActorBuilder<TMsg, TEmitted, NewCtx, TTools>({
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
  ): UnifiedActorBuilder<TMsg, TEmitted, ContextFrom<TMachine>, TTools> {
    if (this.spec.fsm) {
      throw new Error('withMachine(...) and withFSM(...) cannot be used together.');
    }

    return new UnifiedActorBuilder<TMsg, TEmitted, ContextFrom<TMachine>, TTools>({
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
  ): UnifiedActorBuilder<TMsg, TEmitted, TCtx, TTools> {
    if (this.spec.machine) {
      throw new Error('withMachine(...) and withFSM(...) cannot be used together.');
    }

    return new UnifiedActorBuilder<TMsg, TEmitted, TCtx, TTools>({
      ...this.spec,
      fsm: fsm as ActorFSMDefinition<TMsg, TCtx, string>,
    });
  }

  /**
   * Narrow the behavior toolbox to the runtime tool registry supplied by the
   * node runner. This remains the standalone escape hatch when a behavior is
   * defined outside Actor-Web topology helpers. Topology-authored actors can
   * instead use actor.withTools<TRegistry>() so the actor's declared allowlist
   * drives the narrowed toolbox automatically.
   */
  withTools<NewTools extends ActorToolRegistry>(): UnifiedActorBuilder<
    TMsg,
    TEmitted,
    TCtx,
    NewTools
  > {
    return new UnifiedActorBuilder<TMsg, TEmitted, TCtx, NewTools>(
      this.spec as unknown as ActorSpec<TMsg, TCtx, TEmitted, NewTools>
    );
  }

  /**
   * Set the message handler
   */
  onMessage(
    handler: UnifiedMessageHandler<TMsg, TCtx, TEmitted, TTools>
  ): UnifiedActorBuilder<TMsg, TEmitted, TCtx, TTools> {
    return new UnifiedActorBuilder<TMsg, TEmitted, TCtx, TTools>({
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
    handlers: UnifiedTransitionHandlers<TMsg, TCtx, TEmitted, TTools>
  ): UnifiedActorBuilder<TMsg, TEmitted, TCtx, TTools> {
    if (!this.spec.machine && !this.spec.fsm) {
      throw new Error('onTransition(...) requires withMachine(...) or withFSM(...).');
    }

    const handler = this.spec.fsm
      ? createFSMTransitionDispatcher(this.spec.fsm, handlers, this.spec.handler)
      : createTransitionDispatcher(this.spec.machine, handlers, this.spec.handler);

    return new UnifiedActorBuilder<TMsg, TEmitted, TCtx, TTools>({
      ...this.spec,
      transitionHandlers: handlers,
      handler,
    });
  }

  /**
   * Set the start handler
   */
  onStart(handler: () => void | Promise<void>): UnifiedActorBuilder<TMsg, TEmitted, TCtx, TTools> {
    return new UnifiedActorBuilder<TMsg, TEmitted, TCtx, TTools>({
      ...this.spec,
      startHandler: handler,
    });
  }

  /**
   * Set the stop handler
   */
  onStop(handler: () => void | Promise<void>): UnifiedActorBuilder<TMsg, TEmitted, TCtx, TTools> {
    return new UnifiedActorBuilder<TMsg, TEmitted, TCtx, TTools>({
      ...this.spec,
      stopHandler: handler,
    });
  }

  /**
   * Build the actor behavior
   * Returns a properly typed ActorBehavior that includes phantom types for inference
   */
  build(): ActorSpec<TMsg, TCtx, TEmitted, TTools> &
    ActorBehavior<TMsg, TEmitted, TTools> & { __contextType: TCtx; __messageType: TMsg } {
    if (this.spec.transitionHandlers && !this.spec.machine && !this.spec.fsm) {
      throw new Error('onTransition(...) requires withMachine(...) or withFSM(...).');
    }

    // A machine/FSM-backed actor needs no handlers: synthesize a default dispatcher
    // that runs each legal transition and resolves ask(...) with { value, context }.
    // Explicit onMessage/onTransition handlers, when present, take precedence; any
    // event without an explicit handler falls through to this same default.
    let handler = this.spec.handler;
    if (!handler) {
      if (this.spec.machine) {
        handler = createTransitionDispatcher<TMsg, TCtx, TEmitted, TTools>(
          this.spec.machine,
          {},
          undefined
        );
      } else if (this.spec.fsm) {
        handler = createFSMTransitionDispatcher<TMsg, TCtx, TEmitted, TTools>(
          this.spec.fsm,
          {},
          undefined
        );
      } else {
        throw new Error(
          'A handler is required. Call onMessage(...), or attach a machine with withMachine(...)/withFSM(...), before build().'
        );
      }
    }

    // Create the runtime ActorBehavior
    // Note: The handler type mismatch is due to TypedActorInstance vs ActorInstance
    // This is safe because TypedActorInstance is a compile-time helper that doesn't exist at runtime
    const behavior: ActorBehavior<TMsg, TEmitted, TTools> = {
      onMessage: handler as unknown as ActorBehavior<TMsg, TEmitted, TTools>['onMessage'],
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
      handler,
      __contextType: this.spec.initialContext as TCtx,
      __messageType: {} as TMsg,
    } as ActorSpec<TMsg, TCtx, TEmitted, TTools> &
      ActorBehavior<TMsg, TEmitted, TTools> & { __contextType: TCtx; __messageType: TMsg };

    // Register the machine when transition handlers drive it, or when no explicit
    // handler was supplied (the synthesized default dispatcher drives the machine).
    // A withMachine(...) + onMessage(...) actor keeps its prior behavior (the
    // onMessage handler owns dispatch; the machine is not auto-registered).
    if (this.spec.machine && (this.spec.transitionHandlers || !this.spec.handler)) {
      registerMachineWithBehavior(
        builtBehavior as unknown as ActorBehavior<TMsg, TEmitted>,
        this.spec.machine
      );
    }

    return builtBehavior;
  }
}

function createTransitionDispatcher<
  TMsg extends ActorMessage,
  TCtx,
  TEmitted,
  TTools extends ActorToolRegistry,
>(
  machine: AnyStateMachine | undefined,
  handlers: UnifiedTransitionHandlers<TMsg, TCtx, TEmitted, TTools>,
  fallback: UnifiedMessageHandler<TMsg, TCtx, TEmitted, TTools> | undefined
): UnifiedMessageHandler<TMsg, TCtx, TEmitted, TTools> {
  return async (params) => {
    const context = params.actor.getSnapshot().context;
    const handlerParams = { ...params, context };
    const handler = handlers[params.message.type as TMsg['type']] as
      | UnifiedMessageHandler<TMsg, TCtx, TEmitted, TTools>
      | undefined;

    // No per-event transition handler: defer to the onMessage fallback, which
    // handles queries / non-transition messages without transition gating.
    if (!handler && fallback) {
      return fallback(handlerParams);
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

    if (handler) {
      return handler(handlerParams);
    }

    // No handler and no fallback: default to transition + resolve ask(...) with
    // the post-transition snapshot.
    const resolved = params.actor.getSnapshot();
    return {
      reply: { value: resolved.value, context: resolved.context },
    } as ActorHandlerResult<TCtx, unknown>;
  };
}

function createFSMTransitionDispatcher<
  TMsg extends ActorMessage,
  TCtx,
  TEmitted,
  TTools extends ActorToolRegistry,
>(
  fsm: ActorFSMDefinition<TMsg, TCtx>,
  handlers: UnifiedTransitionHandlers<TMsg, TCtx, TEmitted, TTools>,
  fallback: UnifiedMessageHandler<TMsg, TCtx, TEmitted, TTools> | undefined
): UnifiedMessageHandler<TMsg, TCtx, TEmitted, TTools> {
  const actorStates = new WeakMap<TypedActorInstance<TCtx>, string>();

  return async (params) => {
    const context = params.actor.getSnapshot().context;
    const handlerParams = { ...params, context };
    const handler = handlers[params.message.type as TMsg['type']] as
      | UnifiedMessageHandler<TMsg, TCtx, TEmitted, TTools>
      | undefined;

    // No per-event transition handler: defer to the onMessage fallback, which
    // handles queries / non-transition messages without transition gating.
    if (!handler && fallback) {
      return fallback(handlerParams);
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
      context,
    } as ActorFSMTransitionParams<TMsg, TCtx, string>;

    if (normalizedTransition.guard && !normalizedTransition.guard(transitionParams)) {
      return createInvalidTransitionResult<TCtx>(params.message, currentState, allowedTransitions);
    }

    const target =
      typeof normalizedTransition.target === 'function'
        ? normalizedTransition.target(transitionParams)
        : normalizedTransition.target;
    actorStates.set(params.actor, target);

    // No explicit handler or onMessage fallback: default to transition +
    // resolve ask(...) with the new FSM state and unchanged context.
    if (!handler) {
      return {
        reply: { value: target, context },
      } as ActorHandlerResult<TCtx, unknown>;
    }

    return handler(handlerParams);
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
export function defineBehavior<
  TMsg extends ActorMessage = ActorMessage,
  TEmitted = unknown,
  TTools extends ActorToolRegistry = UntypedActorToolRegistry,
>(): UnifiedActorBuilder<TMsg, TEmitted, unknown, TTools> {
  return new UnifiedActorBuilder<TMsg, TEmitted, unknown, TTools>();
}

export function defineFSM<
  TMsg extends ActorMessage,
  TCtx = unknown,
  TState extends string = string,
>(fsm: ActorFSMDefinition<TMsg, TCtx, TState>): ActorFSMDefinition<TMsg, TCtx, TState> {
  return fsm;
}
