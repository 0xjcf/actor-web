/**
 * Custom Type Error Messages in TypeScript
 *
 * This file contains demonstration types for TypeScript error patterns.
 * Types prefixed with underscore are intentionally unused examples.
 */

// Method 1: Using Template Literal Types for custom errors
type ErrorMessage<T extends string> = `Error: ${T}`;

type ValidEventTypes = 'RESPONSE' | 'INCREMENT' | 'DECREMENT';

type ValidateEventType<T extends string> = T extends ValidEventTypes
  ? T
  : ErrorMessage<`"${T}" is not a valid event type. Valid types are: ${ValidEventTypes}`>;

// Method 2: Using conditional types with never
type _AssertEventType<T extends string> = T extends ValidEventTypes ? T : never; // This will show "Type '"RESPONE"' is not assignable to type 'never'"

// Method 3: Using a more sophisticated error system
type TypeError<Message extends string> = { __error__: Message };

type _CheckEventType<T> = T extends { type: infer Type }
  ? Type extends ValidEventTypes
    ? T
    : TypeError<`Invalid event type: ${Type extends string ? Type : 'unknown'}`>
  : TypeError<'Event must have a type property'>;

// Method 4: Using utility types with better error messages
type If<Condition extends boolean, True, False> = Condition extends true ? True : False;

type IsValidEventType<T> = T extends ValidEventTypes ? true : false;

type _CreateEvent<Type extends string, Data> = If<
  IsValidEventType<Type>,
  { type: Type; data: Data },
  TypeError<`Cannot create event with invalid type: ${Type}`>
>;

// Export the main validation function that is actually used
export type { ValidateEventType };

// Example usage (these are demonstrations):
// type _TestEvent1 = ValidateEventType<'RESPONSE'>; // 'RESPONSE'
// type _TestEvent2 = ValidateEventType<'RESPONE'>; // Error: "RESPONE" is not a valid event type

// For stack traces - TypeScript doesn't support custom stack traces,
// but we can use type-level breadcrumbs:
type _WithContext<T, Context extends string> = T & { __context__?: Context };

type _ValidateWithContext<T extends string, Context extends string> = T extends ValidEventTypes
  ? T
  : ErrorMessage<`Invalid "${T}" in ${Context}`>;

// Usage with context:
// type _FromComponent = _ValidateWithContext<'RESPONE', 'CounterComponent.onMessage'>;
