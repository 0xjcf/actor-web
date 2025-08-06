# Spawn Type Inference Fix

## Current Status

✅ **Working:**
- Context is properly typed inside the fluent builder's onMessage handler
- The built behavior has __contextType brand property
- TypedOTPMessageHandler correctly types the actor parameter

❌ **Not Working:**
- ActorRef returned by spawn has unknown context
- The spawn overload isn't matching behaviors with __contextType

## Root Cause

The spawn method has multiple overloads that check for:
1. FluentBehaviorBuilder (not applicable - we pass built behavior)
2. ContextBehaviorBuilder (not applicable - we pass built behavior)  
3. Objects with __contextType property (this should match!)
4. Default case returns ActorRef<unknown, ActorMessage>

The built behavior DOES have __contextType, but TypeScript isn't matching the overload.

## Investigation Needed

1. Check if the spawn overload condition is correct
2. Verify the built behavior type structure matches the overload
3. Test if we can force the overload to match

## Proposed Solutions

### Solution 1: Fix the Overload Condition
The current overload checks for:
```typescript
TBehavior extends { __contextType: infer C }
```

But the built behavior might have a more complex type that doesn't match this simple check.

### Solution 2: Use a Type Helper
Create a helper function that explicitly extracts and passes the context type:
```typescript
function spawnWithContext<TContext>(
  system: ActorSystem,
  behavior: BehaviorSpec & { __contextType: TContext }
): Promise<ActorRef<TContext, ActorMessage>> {
  return system.spawn(behavior) as Promise<ActorRef<TContext, ActorMessage>>;
}
```

### Solution 3: Modify Build Return Type
Ensure the build() method returns a type that TypeScript can match in the overload.

## Next Steps

1. Debug why the overload isn't matching
2. Implement the most appropriate solution
3. Test the complete flow