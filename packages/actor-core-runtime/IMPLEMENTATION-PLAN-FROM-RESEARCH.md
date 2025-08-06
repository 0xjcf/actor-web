# Implementation Plan Based on TypeScript Research

## Immediate Actions

### 1. Fix Overload Ordering (Research Section: "Ensuring the Correct Overload is Chosen")

The research emphasizes that TypeScript checks overloads top-down. We need to reorder our spawn overloads to put the most specific first:

```typescript
// CURRENT (problematic) - generic overload might be too early
async spawn<TBehavior>(
  behavior: TBehavior
): Promise<...conditional type...>

// SUGGESTED - specific overload first
async spawn<C, M extends ActorMessage>(
  behavior: BehaviorSpec<any, any, C, any> & ActorBehavior<any, any> & { __contextType: C; __messageType?: M }
): Promise<ActorRef<C, M extends ActorMessage ? M : ActorMessage>>;

// Then the fallback
async spawn(behavior: ActorBehavior<any, any>): Promise<ActorRef<unknown, ActorMessage>>;
```

### 2. Use Helper Types for Extraction (Research Section: "One idea, though...")

Instead of inline conditionals, use dedicated extraction types:

```typescript
type ContextOf<T> = T extends { __contextType: infer C } ? C : unknown;
type MessageOf<T> = T extends { __messageType: infer M }
  ? (M extends ActorMessage ? M : ActorMessage)
  : ActorMessage;

async function spawn<TBehavior>(
  behavior: TBehavior
): Promise<ActorRef<ContextOf<TBehavior>, MessageOf<TBehavior>>> { ... }
```

### 3. Handle Optional __messageType Better

The research notes that optional properties can cause `infer` to yield `never`. We should ensure MessageOf handles this gracefully by always defaulting to ActorMessage.

## Alternative Approach (if above doesn't work)

### Split spawn into two methods (mentioned in research)

```typescript
spawnWithContext<C, M extends ActorMessage>(
  behavior: BehaviorWithContextBrand<C, M>
): Promise<ActorRef<C, M>>

spawn(behavior: ActorBehavior): Promise<ActorRef<unknown, ActorMessage>>
```

## What NOT to Change

1. **Keep the branding approach** - Research confirms it's valid and used by major libraries
2. **Don't switch to discriminated unions** - Research concludes it doesn't provide clear benefits
3. **Keep the intersection type structure** - It's appropriate for this use case

## Testing Strategy

1. Create minimal test with just `{ __contextType: T }` to verify overload matching
2. Test with full built behavior to ensure complex intersection works
3. Verify both with and without __messageType property

## Expected Outcome

After implementing these changes, `system.spawn(built)` should properly return `ActorRef<{ count: number; name: string }, ActorMessage>` instead of `ActorRef<unknown, ActorMessage>`.