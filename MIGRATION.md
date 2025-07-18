# Migration Guide: From @actor-web/core to @actor-core/runtime

## Overview

The `@actor-web/core` implementation violates pure actor model principles and is being deprecated. This guide helps you migrate to the new `@actor-core/runtime` which provides true location transparency and message-only communication.

## Key Differences

### Old (Deprecated) - `@actor-web/core`
- ❌ Uses singleton patterns
- ❌ Allows direct state access via `getSnapshot()`
- ❌ Contains shared global state
- ❌ Cannot support true distribution

### New (Recommended) - `@actor-core/runtime`
- ✅ Pure message-passing communication
- ✅ True location transparency
- ✅ Distributed actor directory
- ✅ No singleton dependencies

## Migration Steps

### 1. Update Package Dependencies

```bash
# Remove old package
pnpm remove @actor-web/core

# Add new runtime
pnpm add @actor-core/runtime
```

### 2. Update Imports

```typescript
// Before
import { createActorRef } from '@actor-web/core';
import { ActorRef } from '@actor-web/core';

// After
import { createActorRef } from '@actor-core/runtime';
import { ActorRef } from '@actor-core/runtime';
```

### 3. Replace Direct State Access

```typescript
// Before - Direct state access
const state = actor.getSnapshot();

// After - Request state via message
const state = await actor.ask({ type: 'GET_STATE' });
```

### 4. Update Actor Creation

```typescript
// Before
const actor = createActorRef(machine, { 
  id: 'my-actor' 
});

// After - Use actor system
const system = createActorSystem({ nodeAddress: 'node-1' });
const actor = await system.spawn({
  id: 'my-actor',
  behavior: machine
});
```

### 5. Replace Event Bus Usage

```typescript
// Before - Global event bus
eventBus.publish('user.updated', data);

// After - Actor messaging
await userActor.send({ 
  type: 'USER_UPDATED', 
  payload: data 
});
```

## Component Migration

For components using the old `createComponent`:

```typescript
// Before
import { createComponent } from '@actor-web/core';

const MyComponent = createComponent({
  machine,
  template: (state) => html`...`
});

// After - Use framework-specific adapters
// For now, components need custom implementation
// Full component support coming in v2.0
```

## Testing Migration

```typescript
// Before
import { createTestEnvironment } from '@actor-web/core/testing';

// After
import { createTestEnvironment } from '@actor-core/testing';
```

## Common Issues

### 1. Missing getSnapshot()
Replace all `getSnapshot()` calls with message-based state queries.

### 2. Global Event Delegation
The new runtime doesn't use global event delegation. Events should be handled at the component level.

### 3. Singleton Dependencies
Remove any code that relies on singleton instances. Use dependency injection or actor references.

## Timeline

- **Phase 1** (Now): Both packages available, deprecation warnings active
- **Phase 2** (v2.0): Old package moved to @actor-web/core-legacy
- **Phase 3** (v3.0): Legacy package removed from registry

## Need Help?

- Check examples in `/examples` directory
- Join Discord for migration support
- File issues at github.com/actor-web/framework