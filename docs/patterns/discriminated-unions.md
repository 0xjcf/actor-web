# 🎭 Discriminated Unions Pattern

> **Pattern**: Type-safe message handling with exhaustive pattern matching  
> **Status**: ✅ Complete - Production ready  
> **Package**: `@actor-core/runtime`  
> **File**: `packages/actor-core-runtime/src/discriminated-messages.ts`

## 🎯 **Overview**

Discriminated unions provide type-safe message handling that feels natural to JavaScript developers while ensuring exhaustive pattern matching. The TypeScript compiler ensures all message types are handled, preventing runtime errors from missing cases.

## 🔧 **Core Concepts**

### Discriminated Union Structure
```typescript
// Base message type with discriminator
export interface BaseMessage {
  type: string; // This is the discriminator
  timestamp?: number;
  correlationId?: string;
  [key: string]: unknown;
}

// AI Agent message union with exhaustive cases
export type AIAgentMessage = 
  | { type: 'think'; prompt: string; context?: unknown }
  | { type: 'act'; action: string; params: unknown }
  | { type: 'observe'; data: unknown; source?: string }
  | { type: 'learn'; experience: unknown; weight?: number }
  | { type: 'reset'; preserveMemory?: boolean };
```

### Message Handler Pattern
```typescript
class AIAgentHandler {
  async handle(message: AIAgentMessage): Promise<unknown> {
    switch (message.type) {
      case 'think':
        return this.think(message.prompt, message.context);
      
      case 'act':
        return this.execute(message.action, message.params);
      
      case 'observe':
        return this.observe(message.data, message.source);
      
      case 'learn':
        return this.learn(message.experience, message.weight);
      
      case 'reset':
        return this.reset(message.preserveMemory);
      
      // TypeScript ensures all cases are handled
      default:
        const exhaustiveCheck: never = message;
        throw new Error(`Unhandled message type: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}
```

## 🚀 **Usage Examples**

### 1. **Basic Message Handling**

```typescript
import { AIAgentHandler, type AIAgentMessage } from '@actor-core/runtime';

const handler = new AIAgentHandler();

// ✅ All valid messages compile correctly
await handler.handle({ type: 'think', prompt: 'Hello world' });
await handler.handle({ type: 'act', action: 'move', params: { x: 10, y: 20 } });
await handler.handle({ type: 'observe', data: { temperature: 25 } });
await handler.handle({ type: 'learn', experience: { success: true }, weight: 0.8 });
await handler.handle({ type: 'reset', preserveMemory: true });

// ❌ Invalid messages cause compile errors
// await handler.handle({ type: 'invalid' }); // TypeScript error
// await handler.handle({ type: 'think' }); // TypeScript error: missing prompt
```

### 2. **Git Actor Message Handling**

```typescript
import { GitHandler, type GitMessage } from '@actor-core/runtime';

const gitHandler = new GitHandler();

// ✅ All valid git operations
await gitHandler.handle({ type: 'REQUEST_STATUS', requestId: 'req-123' });
await gitHandler.handle({ type: 'COMMIT', message: 'Fix bug', files: ['src/index.ts'] });
await gitHandler.handle({ type: 'PUSH', branch: 'main', remote: 'origin' });
await gitHandler.handle({ type: 'PULL', branch: 'develop' });
await gitHandler.handle({ type: 'CHECKOUT', branch: 'feature/new-feature', create: true });
await gitHandler.handle({ type: 'MERGE', branch: 'feature/branch', strategy: 'rebase' });
await gitHandler.handle({ type: 'STAGE', files: ['src/index.ts', 'README.md'] });
await gitHandler.handle({ type: 'UNSTAGE', files: ['src/index.ts'] });
```

### 3. **Workflow Actor Message Handling**

```typescript
import { WorkflowHandler, type WorkflowMessage } from '@actor-core/runtime';

const workflowHandler = new WorkflowHandler();

// ✅ All valid workflow operations
await workflowHandler.handle({ 
  type: 'start', 
  workflow: 'deployment', 
  input: { version: '1.0.0' } 
});
await workflowHandler.handle({ type: 'pause', reason: 'User requested pause' });
await workflowHandler.handle({ type: 'resume', fromStep: 'deploy' });
await workflowHandler.handle({ type: 'stop', reason: 'Error occurred' });
await workflowHandler.handle({ type: 'step', stepId: 'test', input: { testType: 'unit' } });
await workflowHandler.handle({ type: 'retry', stepId: 'build', maxAttempts: 3 });
await workflowHandler.handle({ type: 'skip', stepId: 'deploy', reason: 'Already deployed' });
```

### 4. **Message Router Pattern**

```typescript
import { MessageRouter, AIAgentHandler, GitHandler } from '@actor-core/runtime';

const router = new MessageRouter();
const aiHandler = new AIAgentHandler();
const gitHandler = new GitHandler();

// Register handlers for different message types
router.register('think', async (msg) => {
  return aiHandler.handle(msg as AIAgentMessage);
});

router.register('COMMIT', async (msg) => {
  return gitHandler.handle(msg as GitMessage);
});

// Route messages to appropriate handlers
await router.route({ type: 'think', prompt: 'Analyze this code' });
await router.route({ type: 'COMMIT', message: 'Add new feature' });
```

## 🏗️ **Advanced Patterns**

### 1. **Type Guards for Runtime Validation**

```typescript
import { isAIAgentMessage, isGitMessage, isWorkflowMessage } from '@actor-core/runtime';

// Type guards for runtime message validation
function processMessage(message: unknown) {
  if (isAIAgentMessage(message)) {
    // TypeScript knows this is an AIAgentMessage
    return aiHandler.handle(message);
  }
  
  if (isGitMessage(message)) {
    // TypeScript knows this is a GitMessage
    return gitHandler.handle(message);
  }
  
  if (isWorkflowMessage(message)) {
    // TypeScript knows this is a WorkflowMessage
    return workflowHandler.handle(message);
  }
  
  throw new Error(`Unknown message type: ${(message as any)?.type}`);
}
```

### 2. **Exhaustive Pattern Matching**

```typescript
// This pattern ensures all message types are handled
function handleAIAgentMessage(message: AIAgentMessage): string {
  switch (message.type) {
    case 'think':
      return `Thinking about: ${message.prompt}`;
    
    case 'act':
      return `Executing action: ${message.action}`;
    
    case 'observe':
      return `Observing data from ${message.source || 'unknown'}`;
    
    case 'learn':
      return `Learning with weight: ${message.weight || 1.0}`;
    
    case 'reset':
      return `Resetting (preserve memory: ${message.preserveMemory || false})`;
    
    // If we add a new message type, TypeScript will force us to handle it here
    default:
      const exhaustiveCheck: never = message;
      throw new Error(`Unhandled AI agent message: ${JSON.stringify(exhaustiveCheck)}`);
  }
}
```

### 3. **Message Transformation**

```typescript
// Transform messages while maintaining type safety
function transformAIAgentMessage(message: AIAgentMessage): AIAgentMessage {
  switch (message.type) {
    case 'think':
      return {
        ...message,
        prompt: message.prompt.toUpperCase(),
        context: { ...message.context, transformed: true }
      };
    
    case 'act':
      return {
        ...message,
        action: message.action.toLowerCase(),
        params: { ...message.params, timestamp: Date.now() }
      };
    
    case 'observe':
      return {
        ...message,
        data: { ...message.data, observedAt: Date.now() }
      };
    
    case 'learn':
      return {
        ...message,
        weight: Math.min(message.weight || 1.0, 1.0)
      };
    
    case 'reset':
      return {
        ...message,
        preserveMemory: message.preserveMemory ?? true
      };
  }
}
```

### 4. **Message Validation**

```typescript
// Validate messages before processing
function validateAIAgentMessage(message: AIAgentMessage): boolean {
  switch (message.type) {
    case 'think':
      return typeof message.prompt === 'string' && message.prompt.length > 0;
    
    case 'act':
      return typeof message.action === 'string' && message.action.length > 0;
    
    case 'observe':
      return message.data !== null && message.data !== undefined;
    
    case 'learn':
      return message.experience !== null && 
             (message.weight === undefined || (message.weight >= 0 && message.weight <= 1));
    
    case 'reset':
      return true; // Always valid
    
    default:
      return false;
  }
}
```

## 🔍 **Type Safety Verification**

### Compile-Time Exhaustiveness

```typescript
// This function demonstrates exhaustive pattern matching
function demonstrateExhaustiveness(message: AIAgentMessage) {
  switch (message.type) {
    case 'think':
      console.log('Thinking:', message.prompt);
      break;
    
    case 'act':
      console.log('Acting:', message.action);
      break;
    
    case 'observe':
      console.log('Observing:', message.data);
      break;
    
    case 'learn':
      console.log('Learning:', message.experience);
      break;
    
    case 'reset':
      console.log('Resetting');
      break;
    
    // If we comment out any case, TypeScript will show an error
    // because the switch is not exhaustive
  }
}
```

### Runtime Type Safety

```typescript
// Combine compile-time and runtime safety
function safeMessageHandler(message: unknown) {
  // Runtime validation
  if (!isAIAgentMessage(message)) {
    throw new Error('Invalid AI agent message');
  }
  
  // Compile-time exhaustive handling
  switch (message.type) {
    case 'think':
      return processThink(message.prompt, message.context);
    
    case 'act':
      return processAct(message.action, message.params);
    
    case 'observe':
      return processObserve(message.data, message.source);
    
    case 'learn':
      return processLearn(message.experience, message.weight);
    
    case 'reset':
      return processReset(message.preserveMemory);
  }
}
```

## 🧪 **Testing Discriminated Unions**

### Exhaustive Pattern Matching Tests

```typescript
import { describe, expect, it } from 'vitest';
import { AIAgentHandler, type AIAgentMessage } from '@actor-core/runtime';

describe('Discriminated Unions - Exhaustive Pattern Matching', () => {
  const handler = new AIAgentHandler();

  it('should handle all AI agent message types', async () => {
    // This test ensures that if we add a new message type to AIAgentMessage,
    // TypeScript will force us to handle it in the switch statement
    const validMessages: AIAgentMessage[] = [
      { type: 'think', prompt: 'test' },
      { type: 'act', action: 'test', params: {} },
      { type: 'observe', data: {} },
      { type: 'learn', experience: {} },
      { type: 'reset' },
    ];

    for (const message of validMessages) {
      await expect(handler.handle(message)).resolves.not.toThrow();
    }
  });

  it('should enforce exhaustive handling in switch statements', async () => {
    // This test verifies that all message types are handled
    const thinkResult = await handler.handle({ type: 'think', prompt: 'Hello' });
    expect(thinkResult).toBe('Thinking about: Hello with context: undefined');

    const actResult = await handler.handle({ type: 'act', action: 'move', params: { x: 10 } });
    expect(actResult).toEqual({ action: 'move', params: { x: 10 }, executed: true });
  });
});
```

### Type Guard Tests

```typescript
import { isAIAgentMessage, isGitMessage, isWorkflowMessage } from '@actor-core/runtime';

describe('Discriminated Unions - Type Guards', () => {
  it('should identify AI agent messages', () => {
    expect(isAIAgentMessage({ type: 'think', prompt: 'test' })).toBe(true);
    expect(isAIAgentMessage({ type: 'act', action: 'test', params: {} })).toBe(true);
    expect(isAIAgentMessage({ type: 'observe', data: {} })).toBe(true);
    expect(isAIAgentMessage({ type: 'learn', experience: {} })).toBe(true);
    expect(isAIAgentMessage({ type: 'reset' })).toBe(true);
    expect(isAIAgentMessage({ type: 'COMMIT', message: 'test' })).toBe(false);
  });

  it('should identify Git messages', () => {
    expect(isGitMessage({ type: 'REQUEST_STATUS' })).toBe(true);
    expect(isGitMessage({ type: 'COMMIT', message: 'test' })).toBe(true);
    expect(isGitMessage({ type: 'PUSH' })).toBe(true);
    expect(isGitMessage({ type: 'think', prompt: 'test' })).toBe(false);
  });
});
```

## 🎯 **Best Practices**

### 1. **Always Use Exhaustive Pattern Matching**
```typescript
// ✅ Good: Exhaustive switch with never type
switch (message.type) {
  case 'think':
    return handleThink(message);
  case 'act':
    return handleAct(message);
  default:
    const exhaustiveCheck: never = message;
    throw new Error(`Unhandled: ${JSON.stringify(exhaustiveCheck)}`);
}

// ❌ Bad: Missing cases (TypeScript will warn)
switch (message.type) {
  case 'think':
    return handleThink(message);
  // Missing other cases
}
```

### 2. **Use Type Guards for Runtime Safety**
```typescript
// ✅ Good: Combine compile-time and runtime safety
function processMessage(message: unknown) {
  if (isAIAgentMessage(message)) {
    return aiHandler.handle(message); // TypeScript knows the type
  }
  throw new Error('Invalid message type');
}

// ❌ Bad: Assume message type without validation
function processMessage(message: any) {
  return aiHandler.handle(message); // No type safety
}
```

### 3. **Keep Message Types Focused**
```typescript
// ✅ Good: Focused message types
type UserMessage = 
  | { type: 'login'; credentials: LoginCredentials }
  | { type: 'logout' }
  | { type: 'updateProfile'; profile: UserProfile };

// ❌ Bad: Overly broad message types
type GenericMessage = 
  | { type: string; [key: string]: unknown };
```

### 4. **Use Descriptive Type Names**
```typescript
// ✅ Good: Clear, descriptive type names
type AIAgentMessage = 
  | { type: 'think'; prompt: string }
  | { type: 'act'; action: string; params: unknown };

// ❌ Bad: Unclear type names
type Message = 
  | { type: 'a'; b: string }
  | { type: 'c'; d: unknown };
```

## 🔧 **Integration with Other Patterns**

### With Phantom Types
```typescript
// Combine discriminated unions with phantom types
type UserActor = ActorRef<'User'>;
type UserMessage = 
  | { type: 'login'; credentials: LoginCredentials }
  | { type: 'logout' };

function sendUserMessage(actor: UserActor, message: UserMessage) {
  // TypeScript ensures actor and message are compatible
  return sendMessage(actor, message);
}
```

### With Virtual Actors
```typescript
// Discriminated unions work seamlessly with virtual actors
const virtualUserActor = createVirtualActorRef('user', userId, userBehavior);

// Type-safe message handling
await virtualUserActor.ask({ type: 'GET_PROFILE' } as UserMessage);
```

### With Event Sourcing
```typescript
// Use discriminated unions for event types
type UserEvent = 
  | { type: 'USER_CREATED'; userId: string; name: string }
  | { type: 'USER_UPDATED'; userId: string; changes: Partial<UserProfile> }
  | { type: 'USER_DELETED'; userId: string };

class EventSourcedUserActor {
  applyEvent(event: UserEvent) {
    switch (event.type) {
      case 'USER_CREATED':
        return this.handleUserCreated(event);
      case 'USER_UPDATED':
        return this.handleUserUpdated(event);
      case 'USER_DELETED':
        return this.handleUserDeleted(event);
    }
  }
}
```

## 📊 **Performance Characteristics**

- **Compile Time**: Zero overhead - types are erased at runtime
- **Runtime**: Minimal overhead - only the discriminator field is checked
- **Memory**: Zero overhead - no additional memory usage
- **Bundle Size**: Zero impact - TypeScript types are not included in bundles

## 🚨 **Common Pitfalls**

### 1. **Forgetting Exhaustive Pattern Matching**
```typescript
// ❌ Bad: Missing cases (TypeScript will warn)
switch (message.type) {
  case 'think':
    return handleThink(message);
  // Missing other cases - TypeScript will show error
}

// ✅ Good: Exhaustive with never type
switch (message.type) {
  case 'think':
    return handleThink(message);
  case 'act':
    return handleAct(message);
  default:
    const exhaustiveCheck: never = message;
    throw new Error(`Unhandled: ${JSON.stringify(exhaustiveCheck)}`);
}
```

### 2. **Using Generic Message Types**
```typescript
// ❌ Bad: Generic types lose type safety
type GenericMessage = { type: string; [key: string]: unknown };

// ✅ Good: Specific discriminated unions
type UserMessage = 
  | { type: 'login'; credentials: LoginCredentials }
  | { type: 'logout' };
```

### 3. **Ignoring Type Guards**
```typescript
// ❌ Bad: No runtime validation
function processMessage(message: any) {
  return handler.handle(message);
}

// ✅ Good: Runtime validation with type guards
function processMessage(message: unknown) {
  if (isAIAgentMessage(message)) {
    return aiHandler.handle(message);
  }
  throw new Error('Invalid message type');
}
```

## 📚 **Related Patterns**

- **[Phantom Types](./phantom-types.md)** - Compile-time actor validation
- **[Event Sourcing](./event-sourcing.md)** - Append-only state management
- **[Actor Proxies](./actor-proxies.md)** - Type-safe communication
- **[Message Transport](./message-transport.md)** - Cross-environment messaging

---

**Next**: Learn about [Virtual Actors](./virtual-actors.md) for location transparency. 