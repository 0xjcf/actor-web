# System Event Subscription Debugging Guide

This document follows the layered development workflow to systematically debug and fix the system event subscription issue that is causing the graceful shutdown test to fail.

## Issue Summary

**Problem**: System event subscriptions via `subscribeToSystemEvents` are not receiving events, causing the graceful shutdown test to fail.

**Symptoms**:
- Test expects array containing 'actorSpawned' but receives empty array
- System event actor receives and processes messages correctly
- Send instructions are created but callbacks are never invoked
- Issue persists even with test mode enabled

## Layered Architecture Overview

The system event subscription flow has these layers:

### Layer 1: System Event Generation
- **Purpose**: Generate system events (actorSpawned, actorStopped, etc.)
- **Components**: `ActorSystemImpl.emitSystemEvent()`, event creation
- **Status**: ✅ WORKING - Events are generated with correct format

### Layer 2: System Event Actor Message Processing
- **Purpose**: System event actor receives and processes EMIT_SYSTEM_EVENT messages
- **Components**: `SystemEventActor.onMessage()`, message handling
- **Status**: ✅ WORKING - Actor receives messages and creates send instructions

### Layer 3: Message Plan Processing
- **Purpose**: Process send instructions returned by system event actor
- **Components**: `PureActorBehaviorHandler`, `MessagePlanProcessor`, `plan-interpreter`
- **Status**: ❓ UNKNOWN - Need to verify send instructions are executed

### Layer 4: Callback Path Routing
- **Purpose**: Route messages to callback paths
- **Components**: `enqueueMessage()` callback path handling, callback storage
- **Status**: ❌ BROKEN - Path mismatch prevents callback invocation

### Layer 5: Callback Invocation
- **Purpose**: Invoke the actual callback function
- **Components**: Callback map lookup, function invocation
- **Status**: ❌ BROKEN - Never reached due to Layer 4 issues

## Layer-by-Layer Debugging Plan

### Layer 1: System Event Generation ✅

**Test**: Verify system events are generated correctly

```typescript
// TEST: System emits events with correct format
it('should emit system event with correct format', async () => {
  const system = createActorSystem({ nodeAddress: 'test' });
  await system.start();
  
  // Spy on enqueueMessage to capture emitted events
  const enqueueSpy = vi.spyOn(system as any, 'enqueueMessage');
  
  // Trigger event generation
  await system.spawn(behavior, { id: 'test-actor' });
  
  // Verify EMIT_SYSTEM_EVENT message sent
  expect(enqueueSpy).toHaveBeenCalledWith(
    expect.objectContaining({ path: '/system/system-event-actor' }),
    expect.objectContaining({
      type: 'EMIT_SYSTEM_EVENT',
      systemEventType: 'actorSpawned',
      systemTimestamp: expect.any(Number),
      systemData: expect.any(Object)
    })
  );
});
```

**Verification Points**:
- [x] `emitSystemEvent` creates correct message format
- [x] Uses `systemEventType`, `systemTimestamp`, `systemData` fields
- [x] Message is sent to system event actor

### Layer 2: System Event Actor Processing ✅

**Test**: Verify system event actor processes messages and returns send instructions

```typescript
// TEST: System event actor creates send instructions
it('should process EMIT_SYSTEM_EVENT and return send instructions', async () => {
  const behavior = createSystemEventActor();
  const actor = createMockActor();
  
  // Add subscriber
  const subscriberPath = 'actor://test/callback/123';
  await behavior.onMessage({
    message: {
      type: 'SUBSCRIBE_TO_SYSTEM_EVENTS',
      subscriberPath,
      _timestamp: Date.now(),
      _version: '1.0.0'
    },
    actor,
    dependencies: mockDependencies
  });
  
  // Emit event
  const result = await behavior.onMessage({
    message: {
      type: 'EMIT_SYSTEM_EVENT',
      systemEventType: 'actorSpawned',
      systemTimestamp: Date.now(),
      systemData: { actorId: 'test' },
      _timestamp: Date.now(),
      _version: '1.0.0'
    },
    actor,
    dependencies: mockDependencies
  });
  
  // Verify send instructions returned
  expect(result).toBeInstanceOf(Array);
  expect(result).toHaveLength(1);
  expect(result[0]).toHaveProperty('to');
  expect(result[0]).toHaveProperty('tell');
});
```

**Verification Points**:
- [x] Actor maintains subscriber list in external state
- [x] Creates SendInstruction array for notifications
- [x] Returns instructions from message handler

**Debug Logs Found**:
```
🔍 SYSTEM EVENT ACTOR: Processing EMIT_SYSTEM_EVENT
🔍 SYSTEM EVENT ACTOR: Sending notifications { eventType: 'actorSpawned', notificationCount: 1 }
```

### Layer 3: Message Plan Processing ❓

**Test**: Verify plan interpreter executes send instructions

```typescript
// TEST: Plan interpreter processes send instructions
it('should execute send instructions from message plan', async () => {
  const sendSpy = vi.fn().mockResolvedValue(undefined);
  const targetRef = {
    id: 'target',
    send: sendSpy,
    // ... other ActorRef methods
  };
  
  const plan = [{
    to: targetRef,
    tell: { type: 'TEST', _timestamp: Date.now(), _version: '1.0.0' },
    mode: 'fireAndForget'
  }];
  
  const result = await processMessagePlan(plan, runtimeContext);
  
  expect(result.success).toBe(true);
  expect(result.sendInstructionsProcessed).toBe(1);
  expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'TEST' }));
});
```

**Critical Issue**: System event actor creates fake actor refs with no-op send methods!

### Layer 4: Callback Path Routing ❌

**Test**: Verify callback path matching and routing

```typescript
// TEST: Callback path handling in enqueueMessage
it('should handle callback paths correctly', async () => {
  const system = createActorSystem({ nodeAddress: 'test' });
  const callback = vi.fn();
  
  // Register callback with specific path format
  const callbackPath = 'actor://test/callback/123';
  (system as any).systemEventCallbacks.set(callbackPath, callback);
  
  // Send message to callback path
  await (system as any).enqueueMessage(
    { path: callbackPath },
    {
      type: 'SYSTEM_EVENT_NOTIFICATION',
      eventType: 'actorSpawned',
      timestamp: Date.now(),
      _timestamp: Date.now(),
      _version: '1.0.0'
    }
  );
  
  // Verify callback invoked
  expect(callback).toHaveBeenCalledWith(
    expect.objectContaining({ eventType: 'actorSpawned' })
  );
});
```

**Path Mismatch Issue**:
- Stored path: `actor://test/callback/123`
- System event actor uses: `/system/callbacks/system-events/123`
- enqueueMessage checks: `path.includes('/callback/')`

### Layer 5: Callback Invocation ❌

**Test**: Verify callback function is invoked with correct event data

```typescript
// TEST: Callback receives correct event format
it('should invoke callback with SystemEventPayload format', () => {
  const callback = vi.fn();
  const eventData = {
    eventType: 'actorSpawned',
    timestamp: Date.now(),
    data: { actorId: 'test' }
  };
  
  // Simulate callback invocation
  callback(eventData);
  
  expect(callback).toHaveBeenCalledWith(
    expect.objectContaining({
      eventType: 'actorSpawned',
      timestamp: expect.any(Number),
      data: expect.any(Object)
    })
  );
});
```

## Root Cause Analysis

Based on the debugging, there are TWO critical issues:

1. **Path Format Mismatch**: 
   - subscribeToSystemEvents stores: `actor://${nodeAddress}/callback/${id}`
   - System event actor expects: `/system/callbacks/system-events/${id}`
   - These paths never match, so callbacks are never found

2. **Fake Actor Ref Problem**:
   - System event actor creates fake actor refs with `send: () => Promise.resolve()`
   - Plan interpreter calls `instruction.to.send()` which does nothing
   - Even if paths matched, the message wouldn't be delivered

## Fix Implementation Strategy

### Option 1: Direct Callback Invocation (Recommended)
Instead of using send instructions, have the system event actor directly invoke callbacks:

```typescript
// In system event actor
case 'EMIT_SYSTEM_EVENT': {
  // ... existing code ...
  
  // Direct callback invocation instead of send instructions
  for (const [_subscriberId, subscriber] of systemEventState.subscribers.entries()) {
    if (!subscriber.eventTypes || subscriber.eventTypes.includes(event.eventType)) {
      // Send directly to actor system for callback invocation
      dependencies.send(subscriber.path, {
        type: 'SYSTEM_EVENT_NOTIFICATION',
        eventType: event.eventType,
        timestamp: event.timestamp,
        data: event.data
      });
    }
  }
  return; // No send instructions needed
}
```

### Option 2: Fix Path Matching
Align the path formats between subscription and callback handling:

```typescript
// In subscribeToSystemEvents
const callbackPath = `/system/callbacks/system-events/${callbackId}`;

// In system event actor - use the same format
```

### Option 3: Real Actor Refs for Callbacks
Create actual lightweight actors for callbacks instead of fake refs.

## Test Implementation Plan

### 1. Unit Test: System Event Actor Subscription
```typescript
describe('SystemEventActor', () => {
  it('should maintain subscriber list', async () => {
    // Test subscription management
  });
  
  it('should filter events by type', async () => {
    // Test event type filtering
  });
});
```

### 2. Unit Test: Callback Path Handling
```typescript
describe('Callback Path Handling', () => {
  it('should detect callback paths', () => {
    // Test path detection logic
  });
  
  it('should invoke callbacks for matching paths', () => {
    // Test callback invocation
  });
});
```

### 3. Integration Test: End-to-End Event Flow
```typescript
describe('System Event Subscription Integration', () => {
  it('should deliver system events to subscribers', async () => {
    const system = createActorSystem({ nodeAddress: 'test' });
    system.enableTestMode();
    await system.start();
    
    const events: string[] = [];
    const unsubscribe = system.subscribeToSystemEvents((event) => {
      events.push(event.eventType);
    });
    
    // Trigger system event
    await system.spawn(behavior, { id: 'test-actor' });
    
    // Verify synchronously in test mode
    expect(events).toContain('actorSpawned');
    
    unsubscribe();
  });
});
```

## Current Status

- **Layer 1**: ✅ System event generation works correctly
- **Layer 2**: ✅ System event actor processes messages correctly
- **Layer 3**: ❓ Send instructions created but may not execute properly
- **Layer 4**: ❌ Path mismatch prevents callback lookup
- **Layer 5**: ❌ Never reached due to Layer 4 failure

## Next Steps

1. Create unit tests for each layer to validate our understanding
2. Fix the path mismatch issue
3. Implement direct callback invocation or proper actor refs
4. Verify the graceful shutdown test passes
5. Add comprehensive logging for future debugging