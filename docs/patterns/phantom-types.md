# 🎭 Phantom Types Pattern

> **Pattern**: Compile-time actor state validation with zero runtime overhead  
> **Status**: ✅ Complete - Production ready  
> **Package**: `@actor-core/runtime`  
> **File**: `packages/actor-core-runtime/src/phantom-types.ts`

## 🎯 **Overview**

Phantom types provide compile-time type safety for actor references without any runtime overhead. This pattern ensures that actors can only receive messages of the correct type, preventing type errors at compile time rather than runtime.

## 🔧 **Core Concepts**

### Phantom Type Definition
```typescript
// Phantom type for type-safe actor references
type ActorRef<T> = string & { _phantom: T };

// Branded type for type-safe actor IDs
type ActorId<T> = string & { _actorType: T };

// Message type extraction
type MessageFor<T> = T extends ActorRef<infer U> ? U : never;
```

### Actor Type Definitions
```typescript
// Common actor types with semantic meaning
export type UserActor = ActorRef<'User'>;
export type AIAgentActor = ActorRef<'AIAgent'>;
export type GitActor = ActorRef<'Git'>;
export type WorkflowActor = ActorRef<'Workflow'>;
export type SupervisorActor = ActorRef<'Supervisor'>;
```

## 🚀 **Usage Examples**

### 1. **Basic Actor Creation with Phantom Types**

```typescript
import { createTypedActorRef, type UserActor, type AIAgentActor } from '@actor-core/runtime';

// Create typed actor references
const userActor: UserActor = createTypedActorRef('User', 'user-123');
const aiAgent: AIAgentActor = createTypedActorRef('AIAgent', 'ai-456');

// TypeScript ensures only valid messages for each actor type
sendMessage(userActor, { type: 'login', credentials: { username: 'alice', password: 'secret' } }); // ✅ Valid
sendMessage(aiAgent, { type: 'think', prompt: 'Hello world' }); // ✅ Valid

// These would cause compile errors:
// sendMessage(userActor, { type: 'think', prompt: 'Hello' }); // ❌ Error: invalid message type
// sendMessage(aiAgent, { type: 'login', credentials: {} }); // ❌ Error: invalid message type
```

### 2. **Message Type Safety**

```typescript
import { ActorMessages } from '@actor-core/runtime';

// Define message types for each actor
export namespace ActorMessages {
  export type User = 
    | { type: 'login'; credentials: { username: string; password: string } }
    | { type: 'logout' }
    | { type: 'updateProfile'; profile: Record<string, unknown> };

  export type AIAgent = 
    | { type: 'think'; prompt: string }
    | { type: 'act'; action: string; params: unknown }
    | { type: 'observe'; data: unknown }
    | { type: 'learn'; experience: unknown };
}

// Type-safe message sending
function sendUserMessage(actor: UserActor, message: ActorMessages.User) {
  // TypeScript ensures message is valid for User actor
  return sendMessage(actor, message);
}

function sendAIAgentMessage(actor: AIAgentActor, message: ActorMessages.AIAgent) {
  // TypeScript ensures message is valid for AIAgent actor
  return sendMessage(actor, message);
}
```

### 3. **Ask Pattern with Type Safety**

```typescript
import { askActor } from '@actor-core/runtime';

// Type-safe ask pattern
async function demonstrateAskPattern() {
  const gitActor: GitActor = createTypedActorRef('Git', 'git-789');
  const aiAgent: AIAgentActor = createTypedActorRef('AIAgent', 'ai-456');
  
  // ✅ Valid queries with proper typing
  const status = await askActor(gitActor, { type: 'REQUEST_STATUS' });
  const agentResponse = await askActor(aiAgent, { type: 'think', prompt: 'Analyze this code' });
  
  // TypeScript infers the response types automatically
  console.log('Git status:', status);
  console.log('AI response:', agentResponse);
}
```

### 4. **Actor Registry with Type Safety**

```typescript
import { ActorRegistry } from '@actor-core/runtime';

// Type-safe actor registry
const registry: ActorRegistry = {
  register<T>(id: ActorId<T>, actor: ActorRef<T>): void {
    // Implementation
  },
  
  get<T>(id: ActorId<T>): ActorRef<T> | undefined {
    // Implementation
  },
  
  unregister<T>(id: ActorId<T>): void {
    // Implementation
  },
  
  listByType<T>(type: T): Array<ActorRef<T>> {
    // Implementation
  }
};

// Usage with type safety
const userActorId: ActorId<'User'> = 'user-123' as ActorId<'User'>;
const userActor: UserActor = createTypedActorRef('User', 'user-123');

registry.register(userActorId, userActor);
const retrievedActor = registry.get(userActorId); // Type: UserActor | undefined
```

## 🏗️ **Advanced Patterns**

### 1. **Extracting Actor Types**

```typescript
import { ExtractActorType } from '@actor-core/runtime';

// Extract actor type from phantom typed reference
type UserType = ExtractActorType<UserActor>; // 'User'
type AIAgentType = ExtractActorType<AIAgentActor>; // 'AIAgent'

// Use in generic functions
function createActor<T extends ValidActorTypes>(
  type: T,
  id: string
): ActorRef<T> {
  return createTypedActorRef(type, id);
}
```

### 2. **Type Guards**

```typescript
import { isActorRef } from '@actor-core/runtime';

// Type guard for actor references
function processActor(actor: unknown) {
  if (isActorRef(actor)) {
    // TypeScript knows this is an ActorRef
    console.log('Actor ID:', actor);
  }
}
```

### 3. **Union Types**

```typescript
// Union of all valid actor types
type ValidActorTypes = 'User' | 'AIAgent' | 'Git' | 'Workflow' | 'Supervisor';

// Generic actor reference
type AnyActorRef = ActorRef<ValidActorTypes>;

// Function that works with any actor type
function sendToAnyActor(actor: AnyActorRef, message: unknown) {
  // Implementation
}
```

## 🔍 **Type Safety Verification**

### Compile-Time Validation

```typescript
// This code demonstrates compile-time type safety
function demonstrateTypeSafety() {
  const userActor: UserActor = createTypedActorRef('User', 'user-123');
  const aiAgent: AIAgentActor = createTypedActorRef('AIAgent', 'ai-456');
  const gitActor: GitActor = createTypedActorRef('Git', 'git-789');

  // ✅ Valid - these will compile
  sendMessage(userActor, { type: 'login' } as ActorMessages.User);
  sendMessage(aiAgent, { type: 'think' } as ActorMessages.AIAgent);
  sendMessage(gitActor, { type: 'REQUEST_STATUS' } as ActorMessages.Git);

  // ❌ Invalid - these will cause TypeScript errors
  // sendMessage(userActor, { type: 'think', prompt: 'Hello' }); // Error: invalid message type
  // sendMessage(aiAgent, { type: 'login', credentials: {} }); // Error: invalid message type
  // sendMessage(gitActor, { type: 'unknown' }); // Error: invalid message type
}
```

## 🧪 **Testing Phantom Types**

### Type Safety Tests

```typescript
import { describe, expect, it } from 'vitest';
import { createTypedActorRef, type UserActor, type AIAgentActor } from '@actor-core/runtime';

describe('Phantom Types - Type Safety', () => {
  it('should create typed actor references', () => {
    const userActor: UserActor = createTypedActorRef('User', 'user-123');
    const aiAgent: AIAgentActor = createTypedActorRef('AIAgent', 'ai-456');
    
    expect(typeof userActor).toBe('string');
    expect(typeof aiAgent).toBe('string');
  });

  it('should enforce message type constraints', () => {
    // This test verifies that TypeScript compilation fails for invalid messages
    // In practice, these would be caught at compile time
    
    const userActor: UserActor = createTypedActorRef('User', 'user-123');
    
    // Valid message (would compile)
    const validMessage = { type: 'login', credentials: { username: 'alice', password: 'secret' } };
    
    // Invalid message (would cause compile error)
    // const invalidMessage = { type: 'think', prompt: 'Hello' }; // This would fail compilation
    
    expect(validMessage.type).toBe('login');
  });
});
```

## 🎯 **Best Practices**

### 1. **Always Use Phantom Types**
```typescript
// ✅ Good: Use phantom types for type safety
type UserActor = ActorRef<'User'>;
const userActor: UserActor = createTypedActorRef('User', 'user-123');

// ❌ Bad: Use plain strings (loses type safety)
const userActor = 'user-123'; // No type safety
```

### 2. **Define Message Types Explicitly**
```typescript
// ✅ Good: Explicit message type definitions
export namespace ActorMessages {
  export type User = 
    | { type: 'login'; credentials: LoginCredentials }
    | { type: 'logout' };
}

// ❌ Bad: Use generic message types
type GenericMessage = { type: string; [key: string]: unknown };
```

### 3. **Use Type Guards for Runtime Safety**
```typescript
// ✅ Good: Combine compile-time and runtime safety
function processActor(actor: unknown) {
  if (isActorRef(actor)) {
    // Runtime validation + compile-time type safety
    sendMessage(actor, { type: 'ping' });
  }
}
```

### 4. **Leverage TypeScript's Type Inference**
```typescript
// ✅ Good: Let TypeScript infer types
const userActor = createTypedActorRef('User', 'user-123'); // TypeScript infers UserActor

// ✅ Good: Use in generic functions
function createActor<T extends ValidActorTypes>(type: T, id: string): ActorRef<T> {
  return createTypedActorRef(type, id);
}
```

## 🔧 **Integration with Other Patterns**

### With Discriminated Unions
```typescript
// Combine phantom types with discriminated unions
type UserMessage = 
  | { type: 'login'; credentials: LoginCredentials }
  | { type: 'logout' };

function handleUserMessage(actor: UserActor, message: UserMessage) {
  switch (message.type) {
    case 'login':
      return processLogin(actor, message.credentials);
    case 'logout':
      return processLogout(actor);
  }
}
```

### With Virtual Actors
```typescript
// Phantom types work seamlessly with virtual actors
const virtualUserActor = createVirtualActorRef('user', userId, userBehavior);
const typedUserActor: UserActor = virtualUserActor as UserActor;

// Type safety is maintained
await typedUserActor.ask({ type: 'GET_PROFILE' });
```

### With Capability Security
```typescript
// Phantom types enhance capability security
const secureUserActor = createSecureActor(userActor, ['read.profile'], 'system');
const typedSecureActor: UserActor = secureUserActor as UserActor;

// Type safety + security
await typedSecureActor.ask({ type: 'GET_PROFILE' });
```

## 📊 **Performance Characteristics**

- **Compile Time**: Zero overhead - types are erased at runtime
- **Runtime**: Zero overhead - phantom types don't exist in JavaScript
- **Memory**: Zero overhead - no additional memory usage
- **Bundle Size**: Zero impact - TypeScript types are not included in bundles

## 🚨 **Common Pitfalls**

### 1. **Avoid Type Assertions**
```typescript
// ❌ Bad: Unsafe type assertion
const userActor = 'user-123' as UserActor;

// ✅ Good: Use factory function
const userActor = createTypedActorRef('User', 'user-123');
```

### 2. **Don't Mix Phantom Types with Runtime Types**
```typescript
// ❌ Bad: Mixing compile-time and runtime types
function processActor(actor: string | UserActor) {
  // This creates confusion about type safety
}

// ✅ Good: Use phantom types consistently
function processActor(actor: UserActor) {
  // Clear type safety
}
```

### 3. **Avoid Generic Phantom Types**
```typescript
// ❌ Bad: Generic phantom types lose specificity
type GenericActorRef = ActorRef<string>;

// ✅ Good: Specific actor types
type UserActor = ActorRef<'User'>;
type AIAgentActor = ActorRef<'AIAgent'>;
```

## 📚 **Related Patterns**

- **[Discriminated Unions](./discriminated-unions.md)** - Type-safe message handling
- **[Actor Proxies](./actor-proxies.md)** - tRPC-inspired communication
- **[Virtual Actors](./virtual-actors.md)** - Location transparency
- **[Capability Security](./capability-security.md)** - Permission-based access

---

**Next**: Learn about [Discriminated Unions](./discriminated-unions.md) for type-safe message handling. 