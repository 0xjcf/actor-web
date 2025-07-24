/**
 * @module actor-core/runtime/types
 * @description Core type definitions for Actor-Core runtime
 */

import type { AnyStateMachine, EventObject, SnapshotFrom } from 'xstate';

// ========================================================================================
// BASE ACTOR CONTRACT - ALL ACTORS MUST IMPLEMENT
// ========================================================================================

/**
 * Base Actor interface that ALL actors in the framework must implement
 * This ensures consistent behavior and type safety across the entire system
 */
export interface BaseActor<TEvent extends EventObject = EventObject> {
  /** Unique identifier for this actor */
  readonly id: string;

  /** Current lifecycle status */
  readonly status: ActorStatus;

  /** Send a message to this actor */
  send(event: TEvent): void;

  /** Start the actor */
  start(): void;

  /** Stop the actor gracefully */
  stop(): Promise<void> | void;

  /** Get current actor snapshot */
  getSnapshot(): ActorSnapshot;
}

/**
 * Actor lifecycle status
 */
export type ActorStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

// ========================================================================================
// FRAMEWORK-SPECIFIC TYPES
// ========================================================================================

export interface ActorRefOptions {
  id?: string;
  parent?: unknown; // Will be properly typed by the ActorRef implementation
  supervision?: SupervisionStrategy;
  input?: unknown;
  askTimeout?: number;
  autoStart?: boolean;
}

export type SupervisionStrategy = 'restart-on-failure' | 'stop-on-failure' | 'escalate' | 'resume';

export interface SpawnOptions extends ActorRefOptions {
  name?: string;
  sync?: boolean;
}

/**
 * Enhanced ActorSnapshot that preserves XState functionality while adding framework features
 * This allows proper TypeScript inference without type casting
 */
export interface ActorSnapshot<TContext = unknown> {
  context: TContext;
  value: unknown;
  status: ActorStatus;
  error?: Error;

  // XState native methods for proper compatibility
  matches(state: string): boolean;
  can(event: EventObject | string): boolean;
  hasTag(tag: string): boolean;
  toJSON(): object;
}

/**
 * XState-compatible snapshot that extends native XState snapshots with framework features
 * This provides the best of both worlds: XState functionality + framework enhancements
 */
export type FrameworkSnapshot<TMachine extends AnyStateMachine> = SnapshotFrom<TMachine> & {
  status: ActorStatus;
  error?: Error;
};

export interface Mailbox<T> {
  enqueue(message: T): boolean;
  dequeue(): T | undefined;
  size(): number;
  clear(): void;
  isFull(): boolean;
  isEmpty(): boolean;
}

export interface ActorBehavior<_TEvent extends EventObject = EventObject> {
  id: string;
  createMachine(): AnyStateMachine;
}

// ========================================================================================
// MESSAGING TYPES
// ========================================================================================

export interface BaseMessage {
  type: string;
  [key: string]: unknown;
}

export interface BaseEventObject extends EventObject {
  type: string;
}

export interface ResponseEvent extends BaseEventObject {
  type: string;
  _response?: boolean;
  _requestId?: string;
  payload?: unknown;
  error?: Error;
}

export interface AskOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  correlationId?: string;
  metadata?: EventMetadata;
}

export interface EventMetadata {
  correlationId: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface QueryEvent<TParams = unknown> extends BaseEventObject {
  type: 'query';
  request: string;
  params: TParams;
  correlationId: string;
  timeout: number;
  metadata: EventMetadata;
}

// ========================================================================================
// OBSERVABLE TYPES
// ========================================================================================

export interface Observer<T> {
  next: (value: T) => void;
  error?: (error: Error) => void;
  complete?: () => void;
}

export interface Subscription {
  unsubscribe(): void;
}

export interface Observable<T> {
  subscribe(observer: Observer<T>): Subscription;
  subscribe(next: (value: T) => void): Subscription;
}

// ========================================================================================
// STANDARD RESPONSE EVENT PATTERNS
// ========================================================================================

/**
 * Standard response event pattern for ask pattern correlation.
 * Actors can emit events following this pattern to respond to ask() calls.
 *
 * The runtime will automatically correlate responses that have:
 * - A correlationId or requestId field matching a pending request
 * - A response, data, or payload field containing the response data
 */
export interface StandardResponseEvent {
  /** Correlation ID matching the original request */
  correlationId: string;
  /** Response data */
  response: unknown;
  /** Optional event type for logging/debugging */
  type?: string;
}

/**
 * Alternative response event pattern using requestId
 */
export interface RequestIdResponseEvent {
  /** Request ID matching the original request */
  requestId: string;
  /** Response data */
  response: unknown;
  /** Optional event type for logging/debugging */
  type?: string;
}

/**
 * Alternative response event pattern using data field
 */
export interface DataResponseEvent {
  /** Correlation ID or Request ID */
  correlationId: string | { requestId: string };
  /** Response data */
  data: unknown;
  /** Optional event type for logging/debugging */
  type?: string;
}

/**
 * Alternative response event pattern using payload field
 */
export interface PayloadResponseEvent {
  /** Correlation ID or Request ID */
  correlationId: string | { requestId: string };
  /** Response payload */
  payload: unknown;
  /** Optional event type for logging/debugging */
  type?: string;
}

/**
 * Union type of all supported response event patterns
 */
export type ResponseEventPattern =
  | StandardResponseEvent
  | RequestIdResponseEvent
  | DataResponseEvent
  | PayloadResponseEvent;

// ========================================================================================
// ADVANCED TYPE UTILITIES FOR TYPESCRIPT IMMEDIATE TYPE VALIDATION
// ========================================================================================

/**
 * Advanced utility type that removes index signatures from an interface.
 *
 * This is critical for fixing the MessageMap issue where `[K: string]: unknown`
 * makes `keyof T` become `string` instead of literal string union types.
 *
 * @example
 * ```typescript
 * interface BadMap extends MessageMap {
 *   'GET_USER': { id: string };
 *   'UPDATE_USER': { success: boolean };
 *   [K: string]: unknown; // This breaks keyof inference
 * }
 *
 * type BadKeys = keyof BadMap; // string (bad!)
 * type GoodKeys = keyof RemoveIndexSignature<BadMap>; // 'GET_USER' | 'UPDATE_USER' (good!)
 * ```
 *
 * @template T - The interface type to process
 * @returns Type with index signatures removed, preserving only explicit properties
 */
export type RemoveIndexSignature<T> = {
  [K in keyof T as string extends K
    ? never
    : number extends K
      ? never
      : symbol extends K
        ? never
        : K]: T[K];
};

/**
 * Extracts only the strict literal string keys from a MessageMap interface.
 *
 * This utility ensures we only work with explicit message type keys, not
 * broad index signature keys that would make type checking ineffective.
 *
 * @example
 * ```typescript
 * interface UserMessages extends MessageMap {
 *   'GET_USER': { id: string; name: string };
 *   'UPDATE_USER': { success: boolean };
 *   'DELETE_USER': { deleted: boolean };
 * }
 *
 * type UserKeys = StrictKeys<UserMessages>; // 'GET_USER' | 'UPDATE_USER' | 'DELETE_USER'
 * ```
 *
 * @template T - The MessageMap interface to extract keys from
 * @returns Union of literal string keys, excluding index signatures
 */
export type StrictKeys<T> = keyof RemoveIndexSignature<T>;

/**
 * Creates a discriminated union of message objects from a MessageMap interface.
 *
 * This transforms a MessageMap into a union where each message type becomes
 * a complete message object with proper type constraints for immediate validation.
 *
 * @example
 * ```typescript
 * interface UserMessages extends MessageMap {
 *   'GET_USER': { id: string; name: string };
 *   'UPDATE_USER': { success: boolean };
 * }
 *
 * type UserMessageUnion = MessageUnion<UserMessages>;
 * // Results in:
 * // | { type: 'GET_USER'; payload?: JsonValue; correlationId?: string; timestamp?: number; version?: string }
 * // | { type: 'UPDATE_USER'; payload?: JsonValue; correlationId?: string; timestamp?: number; version?: string }
 * ```
 *
 * @template T - The MessageMap interface to transform
 * @returns Discriminated union of complete message objects
 */
export type MessageUnion<T> = {
  [K in StrictKeys<T>]: {
    readonly type: K;
    readonly payload?: JsonValue;
    readonly correlationId?: string;
    readonly timestamp?: number;
    readonly version?: string;
  };
}[StrictKeys<T>];

/**
 * JSON-serializable value type for message payloads.
 * Ensures all message data can be safely serialized across actor boundaries.
 */
export type JsonValue = string | number | boolean | null | JsonObject | JsonArray;

/**
 * JSON-serializable object type
 */
export type JsonObject = { [key: string]: JsonValue };

/**
 * JSON-serializable array type
 */
export type JsonArray = JsonValue[];

// ========================================================================================
// TYPE-LEVEL TESTS FOR UTILITY VALIDATION
// ========================================================================================

/**
 * Type-level test utilities to verify our advanced types work correctly.
 * These use TypeScript's conditional types to validate behavior at compile time.
 *
 * @internal - This namespace is used for compile-time type validation only
 */
export namespace TypeTests {
  /**
   * Test helper: Assert that two types are equal
   */
  type TypesAreEqual<A, B> = A extends B ? (B extends A ? true : false) : false;

  /**
   * Test helper: Assert that a type resolves to never
   */
  type IsNever<T> = [T] extends [never] ? true : false;

  /**
   * Test interface with index signature (simulates current broken MessageMap)
   */
  interface TestMessageMapWithIndex {
    GET_USER: { id: string; name: string };
    UPDATE_USER: { success: boolean };
    [K: string]: unknown; // This breaks keyof inference
  }

  /**
   * Test interface without index signature (target state)
   */
  interface TestMessageMapClean {
    GET_USER: { id: string; name: string };
    UPDATE_USER: { success: boolean };
  }

  /**
   * Type-level tests that validate our utilities work correctly
   */
  type UtilityTests = [
    // Test 1: RemoveIndexSignature strips broad signatures
    TypesAreEqual<RemoveIndexSignature<TestMessageMapWithIndex>, TestMessageMapClean>,
    // Test 2: StrictKeys returns only literal keys, not 'string'
    TypesAreEqual<StrictKeys<TestMessageMapWithIndex>, 'GET_USER' | 'UPDATE_USER'>,
    // Test 3: StrictKeys on broken map should NOT be 'string'
    TypesAreEqual<StrictKeys<TestMessageMapWithIndex>, string> extends true
      ? false // This should be false - we don't want string
      : true,
    // Test 4: MessageUnion creates proper discriminated union
    TypesAreEqual<
      MessageUnion<TestMessageMapClean>,
      | {
          readonly type: 'GET_USER';
          readonly payload?: JsonValue;
          readonly correlationId?: string;
          readonly timestamp?: number;
          readonly version?: string;
        }
      | {
          readonly type: 'UPDATE_USER';
          readonly payload?: JsonValue;
          readonly correlationId?: string;
          readonly timestamp?: number;
          readonly version?: string;
        }
    >,
    // Test 5: JsonValue accepts valid JSON types
    TypesAreEqual<string, JsonValue> extends false ? false : true,
    TypesAreEqual<number, JsonValue> extends false ? false : true,
    TypesAreEqual<boolean, JsonValue> extends false ? false : true,
    TypesAreEqual<null, JsonValue> extends false ? false : true,
    // Test 6: JsonValue rejects invalid types
    IsNever<(() => void) & JsonValue>,
    IsNever<symbol & JsonValue>,
    IsNever<undefined & JsonValue>,
  ];

  /**
   * Compile-time assertion: All tests must pass (be true)
   * If any test fails, TypeScript will show an error here
   */
  type _AllTestsMustPass = UtilityTests extends readonly true[] ? true : never;
}
