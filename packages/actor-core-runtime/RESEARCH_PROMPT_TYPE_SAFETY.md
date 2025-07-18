# Research Prompt: TypeScript Excess Property Checking Not Working for Union Types in Return Positions

## Project Context

We're developing an Actor Model framework in TypeScript where actors can emit events during message processing. The `ActorBehavior` interface allows actors to return either just their context state or their context with emitted events. We need type safety to ensure emitted events match their declared type structure.

## Core Problem Statement

TypeScript is not enforcing excess property checks for object literals within arrays when they're part of a union type return value. Specifically, when an actor returns `{ context, emit: [{ type: 'EVENT', dat: 'value' }] }` where the event type should only have a `data` property, TypeScript doesn't report an error for the incorrect `dat` property.

## Current Setup / Environment

**TypeScript Version:** (using current project configuration)

**Key Type Definitions:**
```typescript
// ActorBehavior interface
export interface ActorBehavior<TMessage = ActorMessage, TContext = unknown, TEmitted = ActorMessage> {
  context?: TContext;
  onMessage(params: { message: TMessage; context: TContext }): Promise<TContext | { context: TContext; emit?: TEmitted | TEmitted[] }>;
  onStart?(params: { context: TContext }): Promise<TContext>;
  onStop?(params: { context: TContext }): Promise<void>;
  supervisionStrategy?: SupervisionStrategy;
}
```

**Example Code Showing the Issue:**
```typescript
// This SHOULD show a type error but doesn't
const emitterBehavior: ActorBehavior<ActorMessage, {}, { type: string; data: string }> = {
  context: {},
  onMessage: async ({ message, context }) => {
    return {
      context,
      emit: [
        { type: 'TEST_EVENT_1', dat: 'Hello' }, // ERROR: 'dat' should not be allowed (should be 'data')
        { type: 'TEST_EVENT_2', data: 'World' }, // OK: 'data' is correct
      ],
    };
  },
};
```

## Build & Run Commands

```bash
# Type checking
npx tsc --noEmit --strict src/examples/event-emission-simple.ts

# Running tests
npm test
```

## Troubleshooting Steps Already Taken & Observations

1. **Direct type assignment works correctly:**
   - When directly assigning to a typed variable, TypeScript correctly reports excess property errors
   - Example: `const test: { data: string } = { dat: 'Hello' }` correctly shows an error

2. **Tried conditional types:**
   - Modified `ActorBehaviorResult` to use conditional types to enforce stricter checking
   - Result: Made the type system more complex but didn't solve the core issue

3. **Created helper functions (`withEmit`):**
   - Helper functions DO enforce type checking correctly
   - But this requires users to use helper functions instead of direct object literals
   - User requirement: Type safety should work without helper functions

4. **Examined TypeScript behavior:**
   - The issue appears to be that TypeScript's excess property checking is limited within union type return positions
   - When returning `TContext | { context: TContext; emit?: TEmitted[] }`, the checking on array elements within `emit` is not strict

5. **Implementation uses type casting:**
   - Current implementation uses `as { context: unknown; emit?: unknown }` which bypasses all type checking
   - Need a solution that maintains type safety throughout

## Specific Questions for Research

1. **What are the known limitations of TypeScript's excess property checking in union type return positions, and are there recommended workarounds?**

2. **Is there a way to enforce strict excess property checking for array elements within object literals that are part of a union type return value?**

3. **Are there TypeScript compiler options or configuration settings that can make excess property checking more strict in these scenarios?**

4. **What are the best practices for designing TypeScript interfaces that need to return either a value OR a value with additional properties while maintaining full type safety?**

5. **Are there examples of other TypeScript libraries that have solved similar type safety challenges with union return types containing arrays of typed objects?**

## Additional Context

- We want to maintain a clean API where users can return object literals directly
- The solution should not require users to use helper functions or type assertions
- The framework needs to support both single event emission and arrays of events
- Type safety is critical as this is a core API that will be used throughout applications