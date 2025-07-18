# 🎭 Actor-Web Framework API Reference

> **Framework**: Actor-Web Framework  
> **Version**: 1.0.0  
> **Package**: `@actor-core/runtime`  
> **Status**: Production Ready

## 📋 **Table of Contents**

- [Getting Started](#getting-started)
- [Core API](#core-api)
  - [Actor Creation](#actor-creation)
  - [Actor References](#actor-references)
  - [Error Handling](#error-handling)
- [Advanced Features](#advanced-features)
  - [Virtual Actors](#virtual-actors-actor-corevirtual)
  - [Event Sourcing](#event-sourcing-actor-corepersistence)
  - [Security](#security-actor-coresecurity)
- [Testing](#testing-actor-coretesting)

## 🚀 **Getting Started**

The Actor-Web Framework provides a minimal, type-safe API for building resilient applications using the actor model. This reference covers the essential APIs needed for 90% of use cases.

```typescript
import { createActorRef } from '@actor-core/runtime';
import { createMachine } from 'xstate';

// Define your actor behavior
const counterMachine = createMachine({
  initial: 'active',
  context: { count: 0 },
  states: {
    active: {
      on: {
        INCREMENT: {
          actions: assign({
            count: ({context}) => context.count + 1
          })
        }
      }
    }
  }
});

// Create an actor
const counter = createActorRef(counterMachine);

// Send messages
counter.send({ type: 'INCREMENT' });

// Request-response pattern
const state = await counter.ask({ type: 'GET_STATE' });
```

## 🎯 **Core API**

The core API provides everything needed to create and interact with actors in your application.

### **Actor Creation**

#### `createActorRef(behavior, options?)`
Creates a new actor with the specified behavior.

```typescript
function createActorRef<T>(
  behavior: ActorBehavior<T>,
  options?: {
    id?: string;
    type?: string;
    input?: unknown;
    parent?: ActorRef<unknown>;
  }
): ActorRef<T>
```

**Parameters:**
- `behavior`: XState state machine defining actor behavior
- `options.id`: Optional actor ID (auto-generated if not provided)
- `options.type`: Actor type for categorization
- `options.input`: Initial input for the state machine
- `options.parent`: Parent actor reference for supervision

**Returns:** Type-safe actor reference

**Example:**
```typescript
const userActor = createActorRef(userMachine, {
  id: 'user-123',
  type: 'User',
  input: { name: 'Alice' }
});
```

### **Actor References**

#### `ActorRef<T>`
Type-safe reference to an actor with methods for interaction.

```typescript
interface ActorRef<T> {
  // Send a message (fire-and-forget)
  send(message: T): void;
  
  // Send a message and wait for response
  ask<R = unknown>(message: T): Promise<R>;
  
  // Subscribe to actor events
  on(event: string, handler: (event: unknown) => void): () => void;
  
  // Get current snapshot
  getSnapshot(): unknown;
  
  // Actor lifecycle
  start(): void;
  stop(): void;
}
```

**Example:**
```typescript
// All methods are available on the actor reference
userActor.send({ type: 'UPDATE_PROFILE', profile });
const profile = await userActor.ask({ type: 'GET_PROFILE' });

// Subscribe to events
const unsubscribe = userActor.on('profileUpdated', ({event}) => {
  console.log('Profile updated:', event);
});

// Lifecycle management
userActor.start();
userActor.stop();
```

### **Error Handling**

#### `ActorError`
Base error class for actor-related errors.

```typescript
class ActorError extends Error {
  constructor(
    message: string, 
    public readonly actorId?: string
  );
}
```

**Example:**
```typescript
try {
  await askActor(userActor, { type: 'INVALID_MESSAGE' });
} catch (error) {
  if (error instanceof ActorError) {
    console.error(`Actor ${error.actorId} error:`, error.message);
  }
}
```

## 🌟 **Advanced Features**

Advanced features are available as separate packages to keep the core runtime lightweight.

### **Virtual Actors** (`@actor-core/virtual`)

Virtual actors provide Orleans-style location transparency and automatic lifecycle management.

```bash
npm install @actor-core/virtual
```

```typescript
import { createVirtualActorSystem } from '@actor-core/virtual';

const system = createVirtualActorSystem({
  nodeId: 'node-1',
  maxActors: 1000
});

// Register actor types
system.registerActorType('user', userBehavior);

// Get or create virtual actors
const user = await system.getActor('user', 'user-123');
```

[View Virtual Actors Documentation →](./virtual-actors.md)

### **Event Sourcing** (`@actor-core/persistence`)

Add persistence and event sourcing to your actors.

```bash
npm install @actor-core/persistence
```

```typescript
import { createEventStore, EventSourcedActor } from '@actor-core/persistence';

const eventStore = createEventStore({
  provider: 'memory'
});

class UserActor extends EventSourcedActor<UserState, UserEvent> {
  // Implementation
}
```

[View Event Sourcing Documentation →](./event-sourcing.md)

### **Security** (`@actor-core/security`)

Capability-based security for actors.

```bash
npm install @actor-core/security
```

```typescript
import { createSecureActor } from '@actor-core/security';

const secureActor = createSecureActor(actor, capabilities, sessionId);
await secureActor.invoke('getProfile');
```

[View Security Documentation →](./security.md)

## 🧪 **Testing** (`@actor-core/testing`)

Testing utilities are provided in a separate package.

```bash
npm install --save-dev @actor-core/testing
```

```typescript
import { createTestActor } from '@actor-core/testing';

const testActor = createTestActor(behavior);
testActor.send({ type: 'TEST_MESSAGE' });
expect(testActor.getState()).toEqual(expectedState);
```

[View Testing Documentation →](./testing.md)

---

## 📚 **Quick Reference**

### Common Patterns

```typescript
// Create an actor
const actor = createActorRef(machine);

// Send message
actor.send({ type: 'ACTION' });

// Request-response
const result = await actor.ask({ type: 'QUERY' });

// Subscribe to events
const unsubscribe = actor.on('stateChanged', handler);

// Lifecycle
actor.start();
actor.stop();
```

### TypeScript Types

```typescript
// Define your event types
type CounterEvent = 
  | { type: 'INCREMENT' }
  | { type: 'DECREMENT' }
  | { type: 'RESET' };

// Actor will be typed automatically
const counter = createActorRef(
  createMachine<CounterContext, CounterEvent>({
    // ... machine definition
  })
);

// Type-safe messaging
counter.send({ type: 'INCREMENT' }); // ✓
counter.send({ type: 'INVALID' });   // ✗ TypeScript error
```

## 🔗 **Next Steps**

- [View Examples](../examples/)
- [Read Architecture Guide](./architecture.md)
- [Join Community](https://github.com/actor-web/framework/discussions)

This API reference covers the essential features needed for building actor-based applications. For advanced scenarios, explore the optional packages listed above.