/**
 * @module actor-core/runtime/type-helpers
 * @description Enhanced type helpers for better error messages
 * @author Agent A - 2025-07-18
 *
 * This module provides type helpers that generate developer-friendly error messages
 * for common mistakes like typos in event types, wrong payload structures, etc.
 */

/**
 * Helper type to extract all possible event type strings from a union
 */
export type ExtractEventTypes<T> = T extends { type: infer U } ? U : never;

/**
 * Helper type to validate event type and provide better error messages
 */
export type ValidateEventType<T, TEvent> = T extends ExtractEventTypes<TEvent>
  ? T
  : ExtractEventTypes<TEvent> extends never
    ? 'Error: No event types defined. Define events with a "type" property.'
    : `Error: Invalid event type "${T & string}". Valid types are: ${ExtractEventTypes<TEvent> & string}`;

/**
 * Helper type to find the correct event shape for a given type
 */
export type EventWithType<TEvent, TType> = Extract<TEvent, { type: TType }>;

/**
 * Helper type to validate event structure with better error messages
 */
export type ValidateEvent<T, TEvent> = T extends { type: infer TType }
  ? TType extends ExtractEventTypes<TEvent>
    ? EventWithType<TEvent, TType> extends never
      ? `Error: Event type "${TType & string}" is valid but event structure not found`
      : T extends EventWithType<TEvent, TType>
        ? T
        : {
            [K in keyof T]: K extends keyof EventWithType<TEvent, TType>
              ? EventWithType<TEvent, TType>[K] extends T[K]
                ? T[K]
                : `Error: Property "${K & string}" has wrong type. Expected: ${EventWithType<TEvent, TType>[K] & string}, Got: ${T[K] & string}`
              : `Error: Property "${K & string}" does not exist on event type "${TType & string}"`;
          }
    : ValidateEventType<TType, TEvent>
  : 'Error: Event must have a "type" property';

/**
 * Helper type to validate an array of events
 */
export type ValidateEventArray<T, TEvent> = T extends readonly unknown[]
  ? { [K in keyof T]: ValidateEvent<T[K], TEvent> }
  : T;

/**
 * Helper type for better error messages when emitting events
 */
export type ValidateEmittedEvent<T, TEvent> = T extends TEvent | TEvent[] | undefined
  ? T extends TEvent
    ? ValidateEvent<T, TEvent>
    : T extends TEvent[]
      ? ValidateEventArray<T, TEvent>
      : T
  : T extends { type: string }
    ? ValidateEvent<T, TEvent>
    : T extends readonly { type: string }[]
      ? ValidateEventArray<T, TEvent>
      : 'Error: Emitted value must be an event, array of events, or undefined';

/**
 * Helper type to show available event types in error messages
 */
export type ShowAvailableEventTypes<TEvent> = ExtractEventTypes<TEvent> extends never
  ? 'No event types defined'
  : `Available event types: ${ExtractEventTypes<TEvent> & string}`;

/**
 * Helper type to validate required fields are present
 */
export type RequiredFields<T> = {
  [K in keyof T as T[K] extends undefined ? never : K]: T[K];
};

/**
 * Helper type to check if all required fields are present
 */
export type ValidateRequiredFields<T, TRequired> =
  RequiredFields<T> extends RequiredFields<TRequired>
    ? T
    : {
        [K in keyof TRequired as TRequired[K] extends undefined ? never : K]: K extends keyof T
          ? T[K]
          : `Error: Missing required field "${K & string}"`;
      };

/**
 * Strict event validation that ensures exact match
 */
export type StrictEventValidation<T, TEvent> = T extends TEvent
  ? T extends { type: infer TType }
    ? EventWithType<TEvent, TType> extends never
      ? ValidateEvent<T, TEvent>
      : keyof T extends keyof EventWithType<TEvent, TType>
        ? T
        : `Error: Event has extra properties. Valid properties for "${TType & string}" are: ${keyof EventWithType<TEvent, TType> & string}`
    : 'Error: Event must have a "type" property'
  : ValidateEvent<T, TEvent>;

/**
 * Helper to create a typed event with validation
 */
export type TypedEvent<TEvent> = StrictEventValidation<TEvent, TEvent>;

/**
 * Utility type to make error messages more readable
 */
export type PrettyError<T> = T extends string
  ? T
  : T extends object
    ? { [K in keyof T]: PrettyError<T[K]> }
    : T;

/**
 * Helper for simple event type validation with inline error messages
 * This is useful for discriminated unions based only on the 'type' field
 */
export type ValidateSimpleEventType<
  TType extends string,
  TValidTypes extends string,
> = TType extends TValidTypes
  ? TType
  : `❌ Typo in event type: "${TType}" is not valid. Did you mean one of: ${TValidTypes}?`;

/**
 * Helper to suggest the closest matching event type
 * (In a real implementation, this would use string similarity algorithms)
 */
export type SuggestClosestEventType<
  TType extends string,
  TValidTypes extends string,
> = TType extends TValidTypes
  ? TType
  : TValidTypes extends `${infer First}${infer _Rest}`
    ? TType extends `${First}${string}`
      ? `❌ Did you mean "${TValidTypes & string}" instead of "${TType}"?`
      : ValidateSimpleEventType<TType, TValidTypes>
    : ValidateSimpleEventType<TType, TValidTypes>;

/**
 * Create a validated event with better error messages
 */
export type CreateValidatedEvent<TEvent> = <T extends TEvent>(
  event: StrictEventValidation<T, TEvent>
) => T;

/**
 * Type guard for event validation
 */
export type IsValidEvent<T, TEvent> = T extends TEvent ? true : false;

/**
 * Helper to format a list of valid options nicely
 */
export type FormatValidOptions<T extends string> = T extends string ? `"${T}"` : never;

/**
 * Better formatted error for invalid event types
 */
export type InvalidEventTypeError<TType, TValidTypes> =
  `❌ Error: "${TType & string}" is not a valid event type.

Valid event types are:
${TValidTypes extends string ? `  • ${TValidTypes}` : 'No valid types defined'}

Example usage:
  emit: { type: '${TValidTypes extends string ? TValidTypes : 'EVENT_TYPE'}', data: { ... } }`;
