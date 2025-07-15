# Actor Standardization Guide

## Overview

This document defines the standardized patterns that all actors in the Actor-Web framework must follow to ensure consistent actor-to-actor communication and framework integration.

## Current State Analysis

### ✅ What We Have
- Unified ActorRef interface with comprehensive communication system
- Event emission system for actor-to-actor communication
- Request/response pattern with `ask()`
- Supervision and hierarchy support

### ❌ Current Problems
- **Git Actor**: Uses custom `createGitActor()` pattern
- **No Actor Registry**: Actors can't discover each other
- **Inconsistent Messaging**: Each actor implements own patterns
- **No Standardized Factory**: Different creation patterns per actor

## Standardized Actor Pattern

### 1. Actor Creation Pattern

All actors must use the unified creation pattern:

```typescript
// ❌ WRONG - Custom factory functions
const gitActor = createGitActor(baseDir);
const customActor = createCustomActor(config);

// ✅ CORRECT - Unified pattern
const gitActor = createActorRef(gitActorMachine, {
  id: 'git-actor',
  input: { baseDir },
  supervision: 'restart',
  autoStart: true,
});

const customActor = createActorRef(customActorMachine, {
  id: 'custom-actor',
  input: { config },
  supervision: 'escalate',
  autoStart: false,
});
```

### 2. Actor Registry Integration

All actors must register themselves for discovery:

```typescript
import { ActorRegistry } from '@actor-core/runtime';

// Register actor for discovery
ActorRegistry.register('actor://system/git', gitActor);
ActorRegistry.register('actor://system/custom', customActor);

// Discover and communicate with other actors
const gitActor = ActorRegistry.lookup('actor://system/git');
if (gitActor) {
  gitActor.send({ type: 'CHECK_STATUS' });
}
```

### 3. Event Emission for Communication

All actors must emit events for other actors to observe:

```typescript
// Emit events for other actors
gitActor.emit({
  type: 'COMMIT_COMPLETED',
  commitHash: 'abc123',
  branch: 'feature/test',
});

// Subscribe to events from other actors
gitActor.subscribe((event) => {
  console.log('Git actor event:', event);
});
```

### 4. Request/Response Pattern

All actors must support the `ask()` pattern for synchronous communication:

```typescript
// Request/response pattern
const status = await gitActor.ask({
  type: 'GET_STATUS',
  timeout: 5000,
});

// In actor machine, handle requests
const gitActorMachine = setup({
  // ... other config
  actors: {
    handleRequest: fromPromise(async ({ input }) => {
      if (input.type === 'GET_STATUS') {
        return await getGitStatus();
      }
      throw new Error('Unknown request type');
    }),
  },
});
```

### 5. Supervision Strategy

All actors must define supervision strategies:

```typescript
const actor = createActorRef(machine, {
  supervision: {
    strategy: 'restart',
    maxRetries: 3,
    retryDelay: 1000,
  },
});
```

## Migration Plan for Git Actor

### Phase 1: Interface Compatibility
```typescript
// Add compatibility layer
export function createGitActor(baseDir?: string): ActorRef<GitEvent, GitEmittedEvent> {
  const actorRef = createActorRef(gitActorMachine, {
    id: generateGitActorId('git-actor'),
    input: { baseDir },
    supervision: 'restart',
    autoStart: false,
  });

  // Register in actor registry
  ActorRegistry.register(`actor://system/git/${actorRef.id}`, actorRef);

  return actorRef;
}
```

### Phase 2: Event Emission Integration
```typescript
// Add event emission to git actor state machine
const gitActorMachine = setup({
  // ... existing config
  actions: {
    emitCommitCompleted: emit({
      type: 'COMMIT_COMPLETED',
      commitHash: ({ context }) => context.lastCommitHash,
    }),
  },
});
```

### Phase 3: Request/Response Handlers
```typescript
// Add request handlers
const gitActorMachine = setup({
  // ... existing config
  actors: {
    handleStatusRequest: fromPromise(async ({ input }) => {
      // Return current status
      return {
        currentBranch: input.context.currentBranch,
        uncommittedChanges: input.context.uncommittedChanges,
      };
    }),
  },
});
```

## Framework Guidelines

### Actor Naming Convention
- Use hierarchical addressing: `actor://system/subsystem/actor-name`
- Examples:
  - `actor://system/git/main`
  - `actor://system/ui/dashboard`
  - `actor://worker/background/processor`

### Event Naming Convention
- Use SCREAMING_SNAKE_CASE for event types
- Include actor context: `GIT_COMMIT_COMPLETED`, `UI_BUTTON_CLICKED`
- Follow pattern: `{ACTOR}_{ACTION}_{STATUS}`

### State Machine Patterns
- All actors must have `idle` state as initial state
- All completion states must have `CONTINUE` transition back to idle
- All error states must have `RETRY` transition
- All invoke states must have `onDone` and `onError` handlers

## Testing Requirements

### Actor Communication Tests
```typescript
describe('Actor Communication', () => {
  it('should communicate between actors', async () => {
    const gitActor = createActorRef(gitActorMachine);
    const uiActor = createActorRef(uiActorMachine);

    // Subscribe to git actor events
    const events: GitEvent[] = [];
    gitActor.subscribe((event) => events.push(event));

    // Send message to git actor
    gitActor.send({ type: 'COMMIT_CHANGES', message: 'test' });

    // Verify event emission
    await waitFor(() => {
      expect(events).toContainEqual({
        type: 'COMMIT_COMPLETED',
        commitHash: expect.any(String),
      });
    });
  });
});
```

### Registry Tests
```typescript
describe('Actor Registry', () => {
  it('should register and discover actors', () => {
    const actor = createActorRef(testMachine);
    
    ActorRegistry.register('actor://test/example', actor);
    
    const found = ActorRegistry.lookup('actor://test/example');
    expect(found).toBe(actor);
  });
});
```

## Benefits of Standardization

1. **Consistent Communication**: All actors use same patterns
2. **Easy Discovery**: Registry enables actor-to-actor discovery
3. **Framework Integration**: Unified supervision and lifecycle
4. **Testing**: Standardized testing patterns
5. **Future-Proof**: Easy to add new communication features

## Implementation Priority

1. **High Priority**: Update git-actor to use standardized pattern
2. **Medium Priority**: Implement actor registry system
3. **Low Priority**: Add advanced communication features

This standardization ensures all actors can communicate seamlessly and new actors follow consistent patterns. 