/**
 * Typed actor instance interface that properly carries context type
 */

import type { ActorInstance } from './actor-instance.js';
import type { ActorSnapshot } from './types.js';

/**
 * A typed version of ActorInstance that properly types getSnapshot
 */
export interface TypedActorInstance<TContext> extends Omit<ActorInstance, 'getSnapshot'> {
  getSnapshot(): ActorSnapshot<TContext>;
}

/**
 * Updated OTP message handler that uses TypedActorInstance
 */
export type TypedOTPMessageHandler<
  TMessage,
  TContext = unknown,
  TResponse = TContext,
  TDomainEvent = unknown,
> = (params: {
  readonly message: TMessage;
  readonly actor: TypedActorInstance<TContext>;
  readonly dependencies: import('./actor-system.js').ActorDependencies;
}) =>
  | import('./otp-types.js').ActorHandlerResult<TContext, TResponse>
  | Promise<import('./otp-types.js').ActorHandlerResult<TContext, TResponse>>
  | import('./message-plan.js').MessagePlan<TDomainEvent>
  | Promise<import('./message-plan.js').MessagePlan<TDomainEvent>>
  | void
  | Promise<void>;
