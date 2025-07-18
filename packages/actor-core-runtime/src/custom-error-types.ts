/**
 * Custom Type Error Messages in TypeScript
 */

// Method 1: Using Template Literal Types for custom errors
type ErrorMessage<T extends string> = `Error: ${T}`;

type ValidEventTypes = 'RESPONSE' | 'INCREMENT' | 'DECREMENT';

type ValidateEventType<T extends string> = T extends ValidEventTypes
  ? T
  : ErrorMessage<`"${T}" is not a valid event type. Valid types are: ${ValidEventTypes}`>;

// Method 2: Using conditional types with never
type AssertEventType<T extends string> = T extends ValidEventTypes ? T : never; // This will show "Type '"RESPONE"' is not assignable to type 'never'"

// Method 3: Using a more sophisticated error system
type TypeError<Message extends string> = { __error__: Message };

type CheckEventType<T> = T extends { type: infer Type }
  ? Type extends ValidEventTypes
    ? T
    : TypeError<`Invalid event type "${Type & string}". Valid types: ${ValidEventTypes}`>
  : never;

// Method 4: Using impossible types to force better errors
type If<Condition, Then, Else> = Condition extends true ? Then : Else;

type IsValidEventType<T> = T extends ValidEventTypes ? true : false;

type CreateEvent<Type extends string, Data> = If<
  IsValidEventType<Type>,
  { type: Type; data: Data },
  {
    type: Type;
    data: Data;
    __TYPE_ERROR__: `"${Type}" is not a valid event type. Use one of: ${ValidEventTypes}`;
  }
>;

// Method 5: Using a validation function with type predicates
export function assertValidEventType<T extends string>(
  type: T,
  _valid?: T extends ValidEventTypes
    ? true
    : ErrorMessage<`"${T}" is not valid. Use: ${ValidEventTypes}`>
): asserts type is T & ValidEventTypes {
  // Runtime check could go here
}

// Example usage:
type TestEvent1 = ValidateEventType<'RESPONSE'>; // 'RESPONSE'
type TestEvent2 = ValidateEventType<'RESPONE'>; // Error: "RESPONE" is not a valid event type...

// For stack traces - TypeScript doesn't support custom stack traces,
// but we can use type-level breadcrumbs:
type WithContext<T, Context extends string> = T & { __context__?: Context };

type ValidateWithContext<
  T extends string,
  Context extends string = 'Unknown',
> = T extends ValidEventTypes
  ? T
  : ErrorMessage<`[${Context}] "${T}" is invalid. Expected: ${ValidEventTypes}`>;

// Usage with context:
type FromComponent = ValidateWithContext<'RESPONE', 'CounterComponent.onMessage'>;
