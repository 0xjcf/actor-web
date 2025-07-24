# Research Prompt: TypeScript Immediate Type Validation for Generic Actor Message Types

## Project Context

Developing the Actor-Web Framework, a pure actor model architecture for TypeScript/JavaScript applications. The framework provides a `TypeSafeActor<T extends MessageMap>` interface that should enforce compile-time type safety for actor message communication. The goal is to provide immediate TypeScript error detection when developers use invalid message types at call sites, similar to how discriminated unions work.

**Key Technologies:**
- TypeScript 5.x with strict type checking
- Generic interfaces and conditional types
- Actor model message passing architecture
- XState integration for state management

## Core Problem Statement

Our `TypeSafeActor` implementation fails to provide immediate TypeScript type validation. Specifically:

1. **Invalid message types are NOT rejected** - TypeScript allows `typedActor.send({ type: 'INVALID_MESSAGE' })` when the message type is not in the MessageMap
2. **Ask pattern returns `Promise<unknown>`** - Instead of typed responses like `Promise<{ id: number; name: string }>`, all responses are `Promise<unknown>`
3. **`@ts-expect-error` directives are unused** - Rigorous testing reveals TypeScript is not throwing expected compile-time errors

The conditional type approach we implemented is not working as intended.

## Current Setup / Environment

**Target:** TypeScript 5.x, Node.js environment, Vitest for testing

**Key Interface Definition:**
```typescript
export interface MessageMap {
  [K: string]: unknown;
}

export interface TypeSafeActor<T extends MessageMap> {
  send<K extends keyof T>(message: K extends keyof T ? {
    readonly type: K;
    readonly payload?: JsonValue;
    readonly correlationId?: string;
    readonly timestamp?: number;
    readonly version?: string;
  } : never): void;
  
  ask<K extends keyof T>(message: K extends keyof T ? {
    readonly type: K;
    readonly payload?: JsonValue;
    readonly correlationId?: string;
    readonly timestamp?: number;
    readonly version?: string;
  } : never): Promise<T[K]>;
}
```

**Example MessageMap:**
```typescript
interface ValidMessageMap extends MessageMap {
  'GET_USER': { id: number; name: string };
  'UPDATE_USER': { success: boolean; message: string };
  'DELETE_USER': { deleted: boolean };
}
```

**Implementation Function:**
```typescript
export function asTypeSafeActor<T extends MessageMap>(actor: ActorRef): TypeSafeActor<T> {
  return {
    send: (message) => actor.send(message),
    ask: (message) => actor.ask(message),
    start: () => actor.start(),
    stop: () => actor.stop(),
    getSnapshot: () => actor.getSnapshot()
  };
}
```

## Build & Run Commands

```bash
cd packages/actor-core-runtime
pnpm test src/unit/type-safe-actor-validation.test.ts
npx tsc --noEmit src/unit/type-safe-actor-validation.test.ts
pnpm lint src/unit/type-safe-actor-validation.test.ts
```

## Troubleshooting Steps Already Taken & Observations

1. **Conditional Type Implementation** - Implemented `K extends keyof T ? MessageObject : never` pattern
   - **Result:** TypeScript does not reject invalid message types, conditional type does not evaluate to `never`

2. **Rigorous Testing with `@ts-expect-error`** - Created comprehensive test file with invalid message types
   - **Result:** All `@ts-expect-error` directives are unused, meaning TypeScript is not throwing expected errors

3. **Return Type Analysis** - Investigated ask pattern return types
   - **Result:** All ask calls return `Promise<unknown>` instead of `Promise<T[K]>`

4. **Generic Parameter Investigation** - Tested explicit generic parameters
   - **Result:** TypeScript may be inferring `K` as `string` instead of specific literal types

5. **Interface Structure Analysis** - Verified MessageMap extends and type constraints
   - **Result:** Interface structure appears correct but type inference is not working

## Specific Questions for Research

1. **Why do TypeScript conditional types fail for generic message validation?**
   - What are the limitations of `K extends keyof T ? ValidType : never` patterns?
   - How does TypeScript's generic inference work with conditional types in interfaces?

2. **What are proven TypeScript patterns for immediate type validation of generic object keys?**
   - Function overloads vs conditional types vs discriminated unions
   - Template literal types and mapped types for key constraint
   - Phantom types or branded types for message validation

3. **How do successful TypeScript libraries implement type-safe generic APIs?**
   - How does XState achieve type safety for event objects?
   - How do libraries like tRPC enforce immediate type validation?
   - What patterns do popular TypeScript frameworks use for generic type constraints?

4. **What alternative approaches exist for constraining generic parameters at call sites?**
   - Strict function signatures with overloads
   - Template literal pattern matching
   - Assertion functions and type predicates
   - Discriminated union types with exhaustive checking

5. **Are there TypeScript compiler flags or configurations that affect conditional type evaluation?**
   - Does `strict` mode impact conditional type behavior?
   - How do `exactOptionalPropertyTypes` or other flags affect generic inference?
   - Are there TypeScript version-specific behaviors for conditional types?

---

**Expected Outcome:** Implementation approach that provides immediate TypeScript compile-time errors for invalid message types and properly typed return values for the ask pattern, similar to how strongly-typed GraphQL or tRPC clients work. 