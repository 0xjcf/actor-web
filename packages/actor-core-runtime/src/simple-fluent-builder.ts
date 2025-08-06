/**
 * Simplified fluent builder following the reference pattern exactly
 */

import type { ActorRef } from './actor-ref.js';
import type { ActorMessage } from './actor-system.js';
import type { TypedOTPMessageHandler } from './typed-actor-instance.js';

/**
 * Actor reference type for the fluent builder pattern
 * This is just a type alias to ActorRef with proper message type constraints
 */
export type FluentActorRef<Context, Message> = ActorRef<
  Context,
  Message extends ActorMessage ? Message : ActorMessage
>;

/**
 * Behavior specification with typed context
 */
export interface TypedBehaviorSpec<Msg, Emitted, Ctx, Res> {
  initialContext?: Ctx;
  handler?: TypedOTPMessageHandler<Msg, Ctx, Res, Emitted>;
}

/**
 * FluentBuilder carries four type parameters:
 *  - Msg     = the message type
 *  - Emitted = any events you emit
 *  - Ctx     = the context shape
 *  - Res     = the return type of your handler
 */
export class SimpleFluentBuilder<Msg = unknown, Emitted = unknown, Ctx = unknown, Res = void> {
  // Store the user's initial context & handler in private fields
  constructor(
    private readonly initialContext?: Ctx,
    private readonly handler?: TypedOTPMessageHandler<Msg, Ctx, Res, Emitted>
  ) {}

  /** Start a new builder for a given message type */
  static define<Msg>(): SimpleFluentBuilder<Msg, never, unknown, void> {
    return new SimpleFluentBuilder<Msg, never, unknown, void>();
  }

  /** Introduce a strongly-typed context */
  withContext<NewCtx>(initial: NewCtx): SimpleFluentBuilder<Msg, Emitted, NewCtx, Res> {
    return new SimpleFluentBuilder<Msg, Emitted, NewCtx, Res>(
      initial,
      // handler is not copied since it expects the old context type
      undefined
    );
  }

  /** Register a message handler that sees the typed context */
  onMessage<HandlerRes>(
    handler: TypedOTPMessageHandler<Msg, Ctx, HandlerRes, Emitted>
  ): SimpleFluentBuilder<Msg, Emitted, Ctx, HandlerRes> {
    return new SimpleFluentBuilder<Msg, Emitted, Ctx, HandlerRes>(this.initialContext, handler);
  }

  /** Bake the behavior spec for the runtime */
  build(): TypedBehaviorSpec<Msg, Emitted, Ctx, Res> {
    return {
      initialContext: this.initialContext as Ctx,
      handler: this.handler as TypedOTPMessageHandler<Msg, Ctx, Res, Emitted> | undefined,
    };
  }
}

// Helper types to extract generics
export type ContextOf<B> = B extends SimpleFluentBuilder<infer _M, infer _E, infer C, infer _R>
  ? C
  : never;

export type MessageOf<B> = B extends SimpleFluentBuilder<infer M, infer _E, infer _C, infer _R>
  ? M
  : never;

// Entry point function
export function defineSimpleFluentBehavior<
  Msg extends ActorMessage = ActorMessage,
>(): SimpleFluentBuilder<Msg, never, unknown, void> {
  return SimpleFluentBuilder.define<Msg>();
}
