# 🎭 Actor-Web Framework API Reference

> **Framework**: Actor-Web Framework - OTP-style Actors for JavaScript/TypeScript  
> **Version**: 2.0.0  
> **Package**: `@actor-core/runtime`  
> **Status**: Production Ready with Message Plan DSL

## 📋 **Table of Contents**

- [Getting Started](#getting-started)
- [OTP-Style Actor Pattern](#otp-style-actor-pattern)
- [Core API](#core-api)
  - [Actor Creation](#actor-creation)
  - [Message Plan DSL](#message-plan-dsl)
  - [Component Behaviors](#component-behaviors)
- [Pure XState Delay Utilities](#pure-xstate-delay-utilities)
  - [Architectural Decision](#architectural-decision)
  - [Delay APIs](#delay-apis)
  - [OTP-Style Examples](#otp-style-examples)
- [Advanced Features](#advanced-features)
  - [Virtual Actors](#virtual-actors-actor-corevirtual)
  - [Event Sourcing](#event-sourcing-actor-corepersistence)
  - [Security](#security-actor-coresecurity)
- [Testing](#testing-actor-coretesting)

## 🚀 **Getting Started**

The Actor-Web Framework brings **Erlang OTP-style actor patterns** to JavaScript/TypeScript. Build resilient, fault-tolerant applications using proven patterns from telecom systems, now with modern web development ergonomics.

```typescript
import { createActor, defineBehavior, createMessage } from '@actor-core/runtime';
import { createMachine, assign } from 'xstate';

// 1. Define your state machine (replaces Erlang's recursive counter(Count))
const counterMachine = createMachine({
  id: 'counter',
  context: { count: 0 },
  initial: 'active',
  states: {
    active: {
      on: {
        INCREMENT: { 
          actions: assign({ count: ctx => ctx.count + 1 }) 
        },
        DECREMENT: { 
          actions: assign({ count: ctx => ctx.count - 1 }) 
        },
        RESET: { 
          actions: assign({ count: 0 }) 
        }
      }
    }
  }
});

// 2. Define behavior (handles messages like OTP gen_server)
const counterBehavior = defineBehavior({
  context: { messageCount: 0 },
  
  onMessage({ message, context, machine }) {
    // Track messages processed
    const newContext = { messageCount: context.messageCount + 1 };
    
    // Handle ask pattern requests - respond with current count
    if (message.type === 'GET_COUNT' && message.correlationId) {
      const currentCount = machine.getSnapshot().context.count;
      
      // ✅ CORRECT: Emit RESPONSE message for ask pattern
      return {
        context: newContext,
        emit: {
          type: 'RESPONSE',
          correlationId: message.correlationId,
          payload: currentCount,  // ask() returns this value
          timestamp: Date.now(),
          version: '1.0.0'
        }
      };
    }
    
    // Handle increment with domain event (auto fan-out)
    if (message.type === 'INCREMENT') {
      // ✅ CORRECT: Return domain event - runtime auto sends to machine + emit
      return {
        context: newContext,
        emit: {
          type: 'COUNT_CHANGED',
          oldValue: machine.getSnapshot().context.count,
          newValue: machine.getSnapshot().context.count + 1,
          operation: 'increment'
        }
      };
    }
    
    // Default: no emission, just update context
    return { context: newContext };
  }
});

// 3. Create and start the actor
const counter = createActor({ 
  machine: counterMachine,
  behavior: counterBehavior 
});

// Start the actor (required before sending messages)
counter.start();

// 4. Send messages and use ask pattern
// Send increment (fire-and-forget)
counter.send(createMessage('INCREMENT'));

// Ask for current count (request-response)
const count = await counter.ask(
  createMessage('GET_COUNT'),
  { timeout: 1000 }
);

console.log('Current count:', count); // Logs: Current count: 1
```

### Key Points:
- **`ask()` returns the `payload` directly**, not a message envelope
- **Correlation ID is automatic** - framework adds it to the message
- **Response requires specific format**: `{ type: 'RESPONSE', correlationId, payload, ... }`
- **Domain events auto fan-out** to both XState machine and event bus
- **Use `createMessage()` factory** for proper ActorMessage format

## 📡 **OTP-Style Actor Pattern**

The Actor-Web Framework directly mirrors **Erlang OTP patterns**, bringing battle-tested telecom reliability to JavaScript/TypeScript:

### Erlang ↔ Actor-Web Comparison

| Erlang OTP | Actor-Web Framework |
|------------|-------------------|
| `Count` argument threading | `context.count` in XState |
| `receive ... -> counter(NewCount)` | `machine.send()` + state re-entry |
| `Pid ! {count, NewCount}` | Message plan with `tell` mode |
| Wildcard clause (`_ -> counter(Count)`) | `return;` (no plan) |
| `gen_server` behaviors | `defineBehavior()` |
| Supervisor trees | Built-in supervision strategies |

### Complete OTP-Style Counter Example

```typescript
// Erlang counter process equivalent
const counterMachine = createMachine({
  context: { count: 0 },
  initial: 'active',
  states: {
    active: {
      on: {
        INCREMENT: { 
          actions: assign({ count: ctx => ctx.count + 1 }) 
        },
        DECREMENT: { 
          actions: assign({ count: ctx => ctx.count - 1 }) 
        },
        RESET: { 
          actions: assign({ count: 0 }) 
        }
      }
    }
  }
});

const counterBehavior = defineBehavior({
  context: { totalMessages: 0 },
  
  onMessage({ message, context, machine }) {
    const newContext = { totalMessages: context.totalMessages + 1 };
    
    // Equivalent to: receive {get_count, Pid} -> Pid ! {count, Count}
    if (message.type === 'GET_COUNT' && message.correlationId) {
      const count = machine.getSnapshot().context.count;
      
      // ✅ CORRECT: Emit RESPONSE for ask pattern correlation
      return {
        context: newContext,
        emit: {
          type: 'RESPONSE',           // Framework expects this type
          correlationId: message.correlationId,  // Match request ID
          payload: count,             // This is what ask() returns
          timestamp: Date.now(),
          version: '1.0.0'
        }
      };
    }
    
    // Equivalent to: receive {increment} -> counter(Count + 1)
    if (message.type === 'INCREMENT') {
      // Domain event for state change notification
      return {
        context: newContext,
        emit: {
          type: 'COUNT_INCREMENTED',
          previousCount: machine.getSnapshot().context.count,
          newCount: machine.getSnapshot().context.count + 1
        }
      };
    }
    
    // Equivalent to: _ -> counter(Count)  [wildcard clause]
    return { context: newContext };  // No emission
  }
});

// Spawn and use like Erlang processes
const counter = createActor({ machine: counterMachine, behavior: counterBehavior });
counter.start();

// Fire-and-forget message (like Erlang: Counter ! increment)
counter.send(createMessage('INCREMENT'));

// Request-response pattern (like Erlang: Counter ! {get_count, self()})
const count = await counter.ask(
  createMessage('GET_COUNT'),
  { timeout: 5000 }
);
console.log('Count is:', count); // Output: Count is: 1
```

### Why OTP Patterns?

1. **Battle-Tested**: 30+ years of telecom reliability
2. **Fault Tolerant**: "Let it crash" philosophy with supervision
3. **Scalable**: Message-passing avoids shared state complexity
4. **Predictable**: Clear patterns for state management and communication
5. **Type-Safe**: Full TypeScript support with XState integration

## 🎯 **Core API**

### **Message Plan DSL**

The Message Plan DSL provides a unified, declarative way to handle all actor communication patterns.

#### Message Plan Types

```typescript
type MessagePlan =
  | DomainEvent                                    // Fan-out broadcast
  | SendInstruction                               // Point-to-point command
  | AskInstruction                                // Request/response
  | (DomainEvent | SendInstruction | AskInstruction)[];  // Multiple operations

interface DomainEvent {
  type: string;
  [key: string]: JsonValue;
}

interface SendInstruction {
  to: ActorRef<any>;
  msg: ActorMessage;
  mode?: 'fireAndForget' | 'retry(3)' | 'circuitBreaker';
}

interface AskInstruction<R = unknown> {
  to: ActorRef<any>;
  ask: ActorMessage;
  onOk: DomainEvent | ((response: R) => DomainEvent);
  onError?: DomainEvent | ((error: Error) => DomainEvent);
  timeout?: number;
}
```

#### Communication Patterns

| Pattern | Description | Example |
|---------|-------------|---------|
| **Broadcast** | Fan-out to all interested parties | `return { type: 'USER_LOGGED_IN', userId }` |
| **Tell** | Fire-and-forget to specific actor | `return { to: logger, msg: { type: 'LOG', text } }` |
| **Ask** | Request-response with typed reply | `return { to: api, ask: { type: 'FETCH' }, onOk: handleData }` |
| **Multiple** | Atomic execution of multiple operations | `return [broadcast, tell, ask]` |

### **Component Behaviors**

#### `defineComponentBehavior(config)`
Defines reusable component behavior with the Message Plan DSL.

```typescript
const behavior = defineComponentBehavior({
  onMessage: ({ message, machine, dependencies }) => MessagePlan,
  dependencies: {
    backend: 'actor://system/backend',
    validator: 'actor://system/validator'
  }
});
```

**Parameters:**
- `onMessage`: Handler that returns a message plan
- `dependencies`: Required actor dependencies (resolved at mount)

**Returns:** Component behavior configuration

### **Actor Creation**

#### `createComponent(config)`
Creates a web component backed by an actor with XState machine.

```typescript
const Component = createComponent({
  machine: stateMachine,
  behavior: componentBehavior,
  template: (state) => string
});
```

**Parameters:**
- `machine`: XState state machine for UI logic
- `behavior`: Component behavior from `defineComponentBehavior`
- `template`: Template function for rendering

**Returns:** Web component class

## ⏱️ **Pure XState Delay Utilities**

The Actor-Web Framework provides **pure XState-based delay utilities** that eliminate JavaScript timers (`setTimeout`, `setInterval`) while maintaining the actor model's **location transparency** principle.

### **Architectural Decision**

**The Problem**: JavaScript timers violate the pure actor model because:
- `setTimeout`/`setInterval` don't work in all environments (Web Workers, server-side)
- Timers aren't serializable or location-transparent
- They create memory leaks if not properly cleaned up
- Testing becomes non-deterministic

**The Solution**: Two complementary approaches using pure XState patterns:

| Approach | Use Case | API Style |
|----------|----------|-----------|
| **Convenience Wrapper** | Drop-in `setTimeout` replacement | `await createActorDelay(ms)` |
| **Pure Actor Control** | Full lifecycle management | Actor-based with manual control |

### **Delay APIs**

#### `createActorDelay(ms): Promise<void>`
**Promise-based convenience wrapper** - Perfect for simple delays in actor behaviors.

```typescript
import { createActorDelay } from '@actor-core/runtime/pure-xstate-utilities';

// ✅ PURE ACTOR MODEL: Zero JavaScript timers, location-transparent
await createActorDelay(1000);  // Wait 1 second using XState 'after' transitions
```

**Features**:
- **Pure XState**: Uses `after` transitions, no `setTimeout`
- **Auto-cleanup**: Actor automatically stopped when promise resolves
- **Location-transparent**: Works everywhere (browser, Workers, Node.js)
- **Testable**: Deterministic with XState test utilities

#### `createDelayActor(ms)` + `waitForDelayActor(actor)`
**Pure actor approach** - Full control over delay lifecycle with cancellation support.

```typescript
import { createDelayActor, waitForDelayActor } from '@actor-core/runtime/pure-xstate-utilities';

// Create delay actor (doesn't start automatically)
const delayActor = createDelayActor(5000);
delayActor.start();

// Start the delay explicitly
delayActor.send({ type: 'START' });

// Wait for completion (or cancellation)
const result = await waitForDelayActor(delayActor);  // 'completed' | 'cancelled'

// Can cancel mid-delay
delayActor.send({ type: 'CANCEL' });
delayActor.stop();  // Manual cleanup
```

**Features**:
- **Full Lifecycle Control**: Manual start, stop, cancel
- **Inspection**: Can observe actor state during delay
- **Cancellation**: Interrupt delays gracefully
- **Composable**: Integrate with other actors and supervision trees

#### `PureXStateTimeoutManager`
**Timeout management service** - Handles multiple concurrent timeouts using pure XState.

```typescript
import { PureXStateTimeoutManager } from '@actor-core/runtime/pure-xstate-utilities';

const timeoutManager = new PureXStateTimeoutManager();

// Schedule timeout
const timeoutId = timeoutManager.setTimeout(() => {
  console.log('Timer fired!');
}, 2000);

// Cancel if needed
timeoutManager.clearTimeout(timeoutId);

// Cleanup all timeouts
timeoutManager.destroy();
```

### **OTP-Style Examples**

#### **Erlang gen_server with Timeout Pattern**

Classic Erlang OTP pattern - a server that times out waiting for responses:

```erlang
%% Erlang OTP gen_server with timeout
handle_call(get_data, From, State) ->
    spawn_link(fun() ->
        case fetch_data() of
            {ok, Data} -> gen_server:reply(From, Data);
            error -> gen_server:reply(From, {error, timeout})
        end
    end),
    {noreply, State, 5000}.  % 5-second timeout

handle_info(timeout, State) ->
    {stop, timeout, State}.
```

**Actor-Web Framework equivalent**:

```typescript
const serverBehavior = defineBehavior({
  onMessage: async ({ message, machine, dependencies }) => {
    if (message.type === 'GET_DATA') {
      try {
        // ✅ PURE ACTOR MODEL: XState delay instead of Erlang timeout
        const timeoutPromise = createActorDelay(5000).then(() => {
          throw new Error('Server timeout after 5 seconds');
        });
        
        const dataPromise = dependencies.dataSource.ask(
          createMessage('FETCH_DATA', { requestId: message.correlationId }),
          { timeout: 4500 }
        );
        
        const data = await Promise.race([dataPromise, timeoutPromise]);
        
        // ✅ CURRENT: Return domain event - automatically fans out to machine + emit
        return {
          type: 'DATA_FETCHED',
          requestId: message.correlationId,
          data: data.payload,
          timestamp: Date.now()
        };
        
      } catch (error) {
        // ✅ CURRENT: Error domain event
        return {
          type: 'DATA_FETCH_FAILED', 
          requestId: message.correlationId,
          error: 'timeout',
          timestamp: Date.now()
        };
      }
    }
    
    return; // Unhandled message - no message plan
  }
});
```

#### **OTP Supervisor with Restart Delays**

Erlang supervisors use exponential backoff for restart strategies:

```erlang
%% Erlang supervisor with restart delay
init([]) ->
    ChildSpec = #{
        id => worker,
        start => {worker, start_link, []},
        restart => permanent,
        shutdown => 5000,
        restart_delay => 1000  % 1 second backoff
    },
    {ok, {{one_for_one, 5, 10}, [ChildSpec]}}.
```

**Actor-Web Framework equivalent**:

```typescript
const supervisorBehavior = defineBehavior({
  onMessage: async ({ message, machine, dependencies }) => {
    if (message.type === 'CHILD_CRASHED' && message.payload?.childId) {
      const { childId, crashReason, childSpec } = message.payload;
      const context = machine.getSnapshot().context;
      const restartCount = context.restartCounts[childId] || 0;
      
      // Exponential backoff: 1s, 2s, 4s, 8s...
      const backoffDelay = Math.min(1000 * Math.pow(2, restartCount), 30000);
      
      // ✅ PURE ACTOR MODEL: XState delay for restart backoff
      await createActorDelay(backoffDelay);
      
      // ✅ CURRENT: Message Plan DSL with multiple operations
      return [
        // Domain event: broadcast restart attempt
        {
          type: 'CHILD_RESTARTING',
          childId,
          delay: backoffDelay,
          attempt: restartCount + 1,
          reason: crashReason
        },
        
        // Ask instruction: spawn new actor
        {
          to: dependencies.actorSystem,
          ask: createMessage('SPAWN_ACTOR', { 
            spec: childSpec,
            parentId: machine.getSnapshot().context.supervisorId 
          }),
          onOk: (response) => ({
            type: 'CHILD_RESTARTED',
            childId,
            newActorId: response.payload?.actorId,
            previousCrashes: restartCount + 1
          }),
          onError: (error) => ({
            type: 'RESTART_FAILED',
            childId,
            error: error.message,
            finalAttempt: restartCount >= 5
          }),
          timeout: 10000
        }
      ];
    }
    
    return;
  }
});
```

#### **Periodic Health Check Service**

OTP applications often include periodic health checks:

```erlang
%% Erlang periodic health check
init([]) ->
    erlang:send_after(30000, self(), health_check),  % 30-second intervals
    {ok, #state{}}.

handle_info(health_check, State) ->
    check_system_health(),
    erlang:send_after(30000, self(), health_check),  % Schedule next check
    {noreply, State}.
```

**Actor-Web Framework equivalent**:

```typescript
const healthMonitorBehavior = defineBehavior({
  onMessage: async ({ message, machine, dependencies }) => {
    if (message.type === 'START_MONITORING') {
      // ✅ PURE ACTOR MODEL: XState interval for periodic checks
      const stopInterval = createActorInterval(async () => {
        // Send health check message to self to trigger check
        machine.send(createMessage('PERFORM_HEALTH_CHECK', {
          scheduledAt: Date.now(),
          checkId: `health-${Date.now()}`
        }));
      }, 30000);
      
      // Store stop function in machine context for cleanup
      machine.send({
        type: 'SET_INTERVAL_HANDLE',
        payload: { intervalStop: stopInterval }
      });
      
      // ✅ CURRENT: Return domain event
      return {
        type: 'HEALTH_MONITORING_STARTED',
        interval: 30000,
        nextCheck: Date.now() + 30000
      };
    }
    
    if (message.type === 'PERFORM_HEALTH_CHECK') {
      const { checkId } = message.payload;
      
      // ✅ CURRENT: Ask instruction with proper message format
      return {
        to: dependencies.healthService,
        ask: createMessage('CHECK_SYSTEM_HEALTH', {
          checkId,
          timestamp: Date.now(),
          services: ['database', 'cache', 'external-api']
        }),
        onOk: (healthReport) => ({
          type: 'HEALTH_CHECK_COMPLETED',
          checkId,
          status: healthReport.payload?.overallStatus,
          services: healthReport.payload?.serviceStatuses,
          responseTime: Date.now() - message.payload.scheduledAt
        }),
        onError: (error) => ({
          type: 'HEALTH_CHECK_FAILED',
          checkId,
          error: error.message,
          timestamp: Date.now()
        }),
        timeout: 5000
      };
    }
    
    if (message.type === 'STOP_MONITORING') {
      const context = machine.getSnapshot().context;
      const intervalStop = context.intervalStop;
      
      if (intervalStop) {
        intervalStop(); // Stop the XState interval
      }
      
      // ✅ CURRENT: Return domain event
      return {
        type: 'HEALTH_MONITORING_STOPPED',
        stoppedAt: Date.now(),
        totalChecksPerformed: context.totalChecks || 0
      };
    }
    
    return;
  }
});
```

#### **Message Factory Usage**

All examples now use the proper message factory function:

```typescript
import { createMessage } from '@actor-core/runtime';

// ✅ CURRENT: Proper ActorMessage format
const message = createMessage('FETCH_DATA', { 
  userId: '123',
  requestId: 'req-456' 
});
// Creates: { type: 'FETCH_DATA', payload: {...}, timestamp: Date.now(), version: '1.0.0' }

// ✅ CURRENT: Domain events are automatically structured
return {
  type: 'USER_DATA_LOADED',
  userId: '123',
  data: userData,
  loadTime: Date.now()
};
// Runtime automatically handles fan-out to machine.send() AND emit()
```

### **Key Benefits of Pure XState Delays**

1. **Location Transparency**: Delays work identically in browser, Workers, Node.js
2. **Testability**: Deterministic timing with XState test schedulers
3. **Memory Safety**: Automatic cleanup prevents memory leaks
4. **Supervision**: Delays participate in actor supervision trees
5. **Cancellation**: Built-in support for interrupting delays
6. **Debugging**: XState DevTools can inspect delay state machines

### **Migration from JavaScript Timers**

```typescript
// ❌ BEFORE: JavaScript timers (violates actor model)
setTimeout(() => {
  actor.send({ type: 'DELAYED_ACTION' });
}, 1000);

const interval = setInterval(() => {
  checkStatus();
}, 5000);

// ✅ AFTER: Pure XState utilities (location-transparent)
await createActorDelay(1000);
actor.send({ type: 'DELAYED_ACTION' });

const stopInterval = createActorInterval(() => {
  checkStatus();
}, 5000);
```

This ensures your actors follow the pure actor model and can run **anywhere** - browser main thread, Web Workers, server-side, or distributed across multiple machines.

## 📝 **Examples**

### Form Submission Flow

```typescript
const submitBehavior = defineComponentBehavior({
  onMessage: ({ message, machine, dependencies }) => {
    if (message.type === 'SUBMIT_FORM') {
      return [
        // 1. Optimistic UI update
        { type: 'FORM_SUBMITTING', formId: message.formId },
        
        // 2. Validate with retry
        {
          to: dependencies.validator,
          msg: { type: 'VALIDATE_FORM', data: message.data },
          mode: 'retry(3)'
        },
        
        // 3. Save and handle response
        {
          to: dependencies.backend,
          ask: { type: 'SAVE_FORM', data: message.data },
          onOk: (response) => ({ 
            type: 'FORM_SAVED', 
            formId: response.id,
            timestamp: Date.now()
          }),
          onError: { type: 'SAVE_FAILED', formId: message.formId },
          timeout: 5000
        }
      ];
    }
  }
});
```

### Chat Message Flow

```typescript
const chatBehavior = defineComponentBehavior({
  onMessage: ({ message, dependencies }) => {
    if (message.type === 'SEND_MESSAGE') {
      return [
        // Broadcast to all participants
        { type: 'MESSAGE_SENT', text: message.text, userId: message.userId },
        
        // Persist to storage
        { 
          to: dependencies.storage,
          msg: { type: 'STORE_MESSAGE', message }
        },
        
        // Notify presence service
        { 
          to: dependencies.presence,
          msg: { type: 'USER_ACTIVE', userId: message.userId }
        }
      ];
    }
  }
});
```

### Imperative Escape Hatch

For rare cases where imperative calls are needed:

```typescript
const behavior = defineComponentBehavior({
  onMessage: async ({ message, dependencies }) => {
    // Imperative call for telemetry (not part of transaction)
    dependencies.telemetry.send({ type: 'EVENT_TRACKED', event: message.type });
    
    // Return declarative plan for main operations
    return { type: 'OPERATION_COMPLETE', id: message.id };
  }
});
```

## 🔒 **Atomicity & Durability**

The Message Plan DSL ensures all operations are atomic:

1. **State + Plan persisted together** - No partial execution
2. **Automatic retries** - Based on configured policies
3. **Exactly-once delivery** - Through transactional outbox
4. **Location transparency** - Actors can move between processes

## 🎭 **Actor References**

#### `ActorRef<T>`
Location-transparent reference to an actor.

```typescript
interface ActorRef<T> {
  // Identity
  readonly id: string;
  readonly address: ActorAddress;
  
  // Messaging (used by runtime, not directly)
  send(message: T): void;
  ask<R>(message: T, options?: AskOptions): Promise<R>;
}
```

Actor references are passed as dependencies and used in message plans, but you don't call methods on them directly in the declarative model.