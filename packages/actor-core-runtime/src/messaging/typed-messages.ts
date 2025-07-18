/**
 * @module actor-core/runtime/messaging/typed-messages
 * @description Type-safe message utilities for actor communication
 *
 * This module provides utilities for creating strongly-typed messages
 * in the actor system, ensuring type safety for message payloads
 * and enabling TypeScript's discriminated union type narrowing.
 *
 * @example
 * ```typescript
 * // Define your message types
 * type MyMessage =
 *   | TypedMessage<'USER_LOGIN', { username: string; timestamp: Date }>
 *   | TypedMessage<'USER_LOGOUT'>
 *   | TypedMessage<'UPDATE_PROFILE', { name: string; email: string }>;
 *
 * // Use in actor behavior
 * const behavior: ActorBehavior<MyMessage, State> = {
 *   context: initialState,
 *   onMessage: async ({ message, context }) => {
 *     switch (message.type) {
 *       case 'USER_LOGIN':
 *         // TypeScript knows message.payload has username and timestamp
 *         console.log(`User ${message.payload.username} logged in`);
 *         break;
 *       case 'USER_LOGOUT':
 *         // TypeScript knows message.payload is undefined
 *         break;
 *       case 'UPDATE_PROFILE':
 *         // TypeScript knows message.payload has name and email
 *         break;
 *     }
 *     return context;
 *   }
 * };
 * ```
 */

import type { ActorAddress, JsonValue } from '../actor-system.js';

/**
 * Base interface for typed messages with optional payload
 *
 * @template TType - The literal string type for the message
 * @template TPayload - The payload type (defaults to undefined for no payload)
 */
export interface TypedMessage<TType extends string = string, TPayload = undefined> {
  readonly type: TType;
  readonly payload: TPayload;
  readonly correlationId?: string;
  readonly timestamp: number;
  readonly version: string;
  readonly sender?: ActorAddress;
}

/**
 * Helper type for messages without payload
 */
export type SimpleMessage<TType extends string> = TypedMessage<TType, null>;

/**
 * Helper type for creating a discriminated union of messages
 *
 * @example
 * ```typescript
 * type MyMessages = MessageUnion<{
 *   'INCREMENT': { amount: number };
 *   'DECREMENT': { amount: number };
 *   'RESET': undefined;
 * }>;
 * ```
 */
export type MessageUnion<T extends Record<string, any>> = {
  [K in keyof T]: T[K] extends undefined
    ? SimpleMessage<K & string>
    : TypedMessage<K & string, T[K]>;
}[keyof T];

/**
 * Create a typed message with payload
 */
export function createMessage<TType extends string, TPayload>(
  type: TType,
  payload: TPayload,
  options?: {
    correlationId?: string;
    sender?: ActorAddress;
    version?: string;
  }
): TypedMessage<TType, TPayload> {
  return {
    type,
    payload,
    correlationId: options?.correlationId,
    timestamp: Date.now(),
    version: options?.version || '1.0.0',
    sender: options?.sender,
  };
}

/**
 * Create a simple message without payload
 */
export function createSimpleMessage<TType extends string>(
  type: TType,
  options?: {
    correlationId?: string;
    sender?: ActorAddress;
    version?: string;
  }
): SimpleMessage<TType> {
  return createMessage(type, null, options);
}

/**
 * Type guard to check if a message is of a specific type
 */
export function isMessageType<TType extends string, TPayload>(
  message: TypedMessage<string, any>,
  type: TType
): message is TypedMessage<TType, TPayload> {
  return message.type === type;
}

/**
 * Extract message types from a union
 */
export type MessageTypes<T> = T extends TypedMessage<infer TType, any> ? TType : never;

/**
 * Extract payload type for a specific message type
 */
export type PayloadOf<T, TType extends string> = T extends TypedMessage<TType, infer TPayload>
  ? TPayload
  : never;

/**
 * Common system message types
 */
export namespace SystemMessages {
  export type Response<T = JsonValue> = TypedMessage<'RESPONSE', T>;
  export type Error = TypedMessage<'ERROR', { code: string; message: string; details?: JsonValue }>;
  export type Ping = SimpleMessage<'PING'>;
  export type Pong = SimpleMessage<'PONG'>;

  export function response<T = JsonValue>(payload: T, correlationId?: string): Response<T> {
    return createMessage('RESPONSE', payload, { correlationId });
  }

  export function error(
    code: string,
    message: string,
    details?: JsonValue,
    correlationId?: string
  ): Error {
    return createMessage('ERROR', { code, message, details }, { correlationId });
  }

  export function ping(): Ping {
    return createSimpleMessage('PING');
  }

  export function pong(correlationId?: string): Pong {
    return createSimpleMessage('PONG', { correlationId });
  }
}

/**
 * Builder pattern for complex message definitions
 */
export class MessageBuilder<TType extends string, TPayload = undefined> {
  private correlationId?: string;
  private sender?: ActorAddress;
  private version = '1.0.0';

  constructor(
    private readonly type: TType,
    private readonly payload: TPayload
  ) {}

  withCorrelationId(id: string): this {
    this.correlationId = id;
    return this;
  }

  withSender(sender: ActorAddress): this {
    this.sender = sender;
    return this;
  }

  withVersion(version: string): this {
    this.version = version;
    return this;
  }

  build(): TypedMessage<TType, TPayload> {
    return {
      type: this.type,
      payload: this.payload,
      correlationId: this.correlationId,
      timestamp: Date.now(),
      version: this.version,
      sender: this.sender,
    };
  }
}

/**
 * Create a message builder
 */
export function message<TType extends string>(type: TType): MessageBuilder<TType, undefined>;
export function message<TType extends string, TPayload>(
  type: TType,
  payload: TPayload
): MessageBuilder<TType, TPayload>;
export function message<TType extends string, TPayload>(
  type: TType,
  payload?: TPayload
): MessageBuilder<TType, TPayload> {
  return new MessageBuilder(type, payload as TPayload);
}
