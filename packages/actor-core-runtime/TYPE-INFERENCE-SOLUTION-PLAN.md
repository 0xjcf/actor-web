# Type Inference Solution Plan

## Problem Summary
We have two incompatible ActorRef types causing type inference to fail. The fluent builder creates behaviors with context type information, but spawn returns ActorRef with unknown context.

## Root Cause
1. `actor-system.ts` imports typed ActorRef: `ActorRef<TContext, TMessage>`
2. Most other files import standard ActorRef: `ActorRef<TEvent, TEmitted, TSnapshot>`
3. These are completely different interfaces with different type parameters
4. `typed-spawn.ts` imports the wrong ActorRef type

## Solution Design

### Option 1: Use Typed ActorRef Everywhere (Recommended)
Since the actor system is already committed to the typed ActorRef interface, we should:

1. **Update all imports** to use typed-actor-ref.ts
2. **Fix typed-spawn.ts** to import the correct ActorRef
3. **Update ActorSystemImpl.spawn** to be generic and extract context type
4. **Ensure fluent builder** brands behaviors with __contextType

### Option 2: Create Type Aliases
Alternative approach to avoid breaking changes:

1. Rename current ActorRef in actor-ref.ts to XStateActorRef
2. Export typed ActorRef as the main ActorRef
3. Use XStateActorRef internally where needed

## Implementation Steps

### Step 1: Fix typed-spawn.ts imports
```typescript
// Change from:
import type { ActorRef } from './actor-ref.js';
// To:
import type { ActorRef } from './typed-actor-ref.js';
```

### Step 2: Make ActorSystemImpl.spawn generic
```typescript
async spawn<TContext = unknown>(
  behavior: BehaviorSpec & { __contextType?: TContext },
  options?: SpawnOptions
): Promise<ActorRef<TContext, ActorMessage>> {
  // Extract context type from behavior
  const inferredContext = behavior.__contextType;
  // ... rest of implementation
  return createTypedActorRef<TContext>(actorInstance, address);
}
```

### Step 3: Update fluent builder build method
Ensure it properly brands with __contextType:
```typescript
build(): BehaviorSpec<TMsg, TEmitted, TCtx, TRes> & { __contextType: TCtx } {
  // ... implementation
}
```

### Step 4: Fix type extraction in typed-spawn
Update ExtractContext to work with proper type:
```typescript
export type ExtractContext<B> = B extends { __contextType: infer C } ? C : unknown;
```

## Testing Strategy

1. Create test file that verifies context is properly typed
2. Test fluent builder → spawn → getSnapshot flow
3. Ensure no type casting needed

## Migration Impact

- Minimal if we fix imports systematically
- May need to update some test files
- Public API remains the same

## Decision: Proceed with Option 1
Use typed ActorRef everywhere since that's what the actor system interface already expects.