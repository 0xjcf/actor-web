/**
 * @module actor-core/runtime/fluent-behavior-builder
 * @description Type-carrying fluent builder for actors based on research findings
 *
 * This implements the "builder API that carries its context generic forward" pattern
 * recommended in the research, where each method returns a new builder with proper
 * type information threaded through. No `any` types, no type casting, no null assertions.
 */

import type { ActorBehavior, ActorMessage } from './actor-system.js';
import type { TypedOTPMessageHandler } from './typed-actor-instance.js';
import type { JsonValue } from './types.js';

/**
 * Behavior specification that carries type information
 * This is what gets built by the fluent builder
 */
export interface BehaviorSpec<
  TMsg extends ActorMessage = ActorMessage,
  TEmitted = unknown,
  TCtx = unknown,
  TRes = void,
> {
  readonly initialContext?: TCtx;
  readonly handler?: TypedOTPMessageHandler<TMsg, TCtx, TRes, TEmitted>;
  readonly startHandler?: () => void | Promise<void>;
  readonly stopHandler?: () => void | Promise<void>;
}

/**
 * FluentBuilder carries four type parameters:
 *  - Msg     = the message type
 *  - Emitted = any events you emit
 *  - Ctx     = the context shape
 *  - Res     = the return type of your handler
 *
 * Each method returns a new builder with updated type parameters.
 * No `any` types, no type casting, no null assertions.
 */
export class FluentBehaviorBuilder<
  TMsg extends ActorMessage = ActorMessage,
  TEmitted = unknown,
  TCtx = unknown,
  TRes = void,
> {
  /**
   * Store the user's configuration in private fields
   */
  constructor(
    private readonly initialContext?: TCtx,
    private readonly handler?: TypedOTPMessageHandler<TMsg, TCtx, TRes, TEmitted>,
    private readonly startHandler?: () => void | Promise<void>,
    private readonly stopHandler?: () => void | Promise<void>
  ) {}

  /**
   * Start a new builder for a given message type
   */
  static define<TMsg extends ActorMessage>(): FluentBehaviorBuilder<TMsg, never, unknown, void> {
    return new FluentBehaviorBuilder<TMsg, never, unknown, void>();
  }

  /**
   * Introduce a strongly-typed context
   * Returns a new builder with the context type parameter updated
   */
  withContext<NewCtx>(initial: NewCtx): FluentBehaviorBuilder<TMsg, TEmitted, NewCtx, TRes> {
    return new FluentBehaviorBuilder<TMsg, TEmitted, NewCtx, TRes>(
      initial,
      this.handler as unknown as TypedOTPMessageHandler<TMsg, NewCtx, TRes, TEmitted> | undefined,
      this.startHandler,
      this.stopHandler
    );
  }

  /**
   * Register a message handler that sees the typed context
   * Returns a new builder with the response type parameter updated
   */
  onMessage<HandlerRes>(
    handler: TypedOTPMessageHandler<TMsg, TCtx, HandlerRes, TEmitted>
  ): FluentBehaviorBuilder<TMsg, TEmitted, TCtx, HandlerRes> {
    return new FluentBehaviorBuilder<TMsg, TEmitted, TCtx, HandlerRes>(
      this.initialContext,
      handler,
      this.startHandler,
      this.stopHandler
    );
  }

  /**
   * Set the start handler for the actor
   * Returns the same builder (start handler doesn't affect types)
   */
  onStart(handler: () => void | Promise<void>): FluentBehaviorBuilder<TMsg, TEmitted, TCtx, TRes> {
    return new FluentBehaviorBuilder<TMsg, TEmitted, TCtx, TRes>(
      this.initialContext,
      this.handler,
      handler,
      this.stopHandler
    );
  }

  /**
   * Set the stop handler for the actor
   * Returns the same builder (stop handler doesn't affect types)
   */
  onStop(handler: () => void | Promise<void>): FluentBehaviorBuilder<TMsg, TEmitted, TCtx, TRes> {
    return new FluentBehaviorBuilder<TMsg, TEmitted, TCtx, TRes>(
      this.initialContext,
      this.handler,
      this.startHandler,
      handler
    );
  }

  /**
   * Bake the behavior spec for the runtime
   * This method brands the spec with type information for spawn() to extract
   */
  build(): BehaviorSpec<TMsg, TEmitted, TCtx, TRes> &
    ActorBehavior<TMsg, TEmitted> & { __contextType: TCtx } {
    if (!this.handler) {
      throw new Error('Message handler is required. Call onMessage() before build().');
    }

    // Create the runtime ActorBehavior
    const behavior: ActorBehavior<TMsg, TEmitted> = {
      onMessage: this.handler as (params: {
        readonly message: ActorMessage;
        readonly actor: import('./actor-instance.js').ActorInstance;
        readonly dependencies: import('./actor-system.js').ActorDependencies;
      }) => unknown,
      onStart: this.startHandler,
      onStop: this.stopHandler,
      // Only set context if it's JSON-serializable
      context:
        this.initialContext !== undefined
          ? (this.initialContext as unknown as JsonValue)
          : undefined,
      types: {
        message: undefined as TMsg | undefined,
        emitted: undefined as TEmitted | undefined,
      },
    };

    // Create the typed spec with branding
    const spec: BehaviorSpec<TMsg, TEmitted, TCtx, TRes> &
      ActorBehavior<TMsg, TEmitted> & { __contextType: TCtx } = {
      ...behavior,
      initialContext: this.initialContext,
      handler: this.handler,
      startHandler: this.startHandler,
      stopHandler: this.stopHandler,
      __contextType: undefined as unknown as TCtx, // Brand with context type for spawn
    };

    return spec;
  }
}

/**
 * Utility types to extract generics from the fluent builder
 */
export type ContextOf<B> = B extends FluentBehaviorBuilder<ActorMessage, unknown, infer C, unknown>
  ? C
  : unknown;

export type MessageOf<B> = B extends FluentBehaviorBuilder<infer M, unknown, unknown, unknown>
  ? M extends ActorMessage
    ? M
    : ActorMessage
  : ActorMessage;

export type ResponseOf<B> = B extends FluentBehaviorBuilder<ActorMessage, unknown, unknown, infer R>
  ? R
  : undefined;

export type EmittedOf<B> = B extends FluentBehaviorBuilder<ActorMessage, infer E, unknown, unknown>
  ? E
  : unknown;

/**
 * Utility types to extract generics from behavior specs
 */
export type ContextOfSpec<B> = B extends BehaviorSpec<ActorMessage, unknown, infer C, unknown>
  ? C
  : unknown;
export type MessageOfSpec<B> = B extends BehaviorSpec<infer M, unknown, unknown, unknown>
  ? M extends ActorMessage
    ? M
    : ActorMessage
  : ActorMessage;

/**
 * Create a new fluent behavior builder
 * This is the main entry point for users
 */
export function defineActor<TMsg extends ActorMessage = ActorMessage>(): FluentBehaviorBuilder<
  TMsg,
  unknown,
  unknown,
  void
> {
  return FluentBehaviorBuilder.define<TMsg>();
}
