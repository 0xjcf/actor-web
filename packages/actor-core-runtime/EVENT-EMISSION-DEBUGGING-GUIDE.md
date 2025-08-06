# Event Emission Debugging Guide

This document follows the layered development workflow to systematically debug and fix the event emission system that is causing integration tests to fail.

## Issue Summary

**Problem**: Event emission integration tests are timing out because emitted events are not reaching subscriber actors.

**Symptoms**:
- All event emission tests timeout after 5 seconds
- Events are being emitted but not delivered to subscribers
- The event collector never receives the expected events

## Layered Architecture Overview

Based on EVENT-EMISSION-LAYER-ARCHITECTURE.md, the event emission system has these layers:

### Layer 1: Actor Behavior Definition
- **Purpose**: Define how actors emit events
- **Components**: `defineActor()`, `onMessage()` handlers, `emit: [...]` returns
- **Status**: ✅ WORKING - Actors correctly return emit arrays

### Layer 2: Message Processing
- **Purpose**: Process actor message handler results
- **Components**: `PureActorBehaviorHandler`, `OTPMessagePlanProcessor`
- **Status**: ✅ WORKING - Handler correctly identifies and processes emit arrays

### Layer 3: Event Emission
- **Purpose**: Emit events to the system
- **Components**: `dependencies.emit()`, `emitEventToSubscribers()`
- **Status**: ⚠️ PARTIALLY WORKING - Events are emitted but not delivered

### Layer 4: Event Routing
- **Purpose**: Route events to subscribers
- **Components**: `AutoPublishingRegistry`, subscription management
- **Status**: ❌ BROKEN - Events not reaching subscribers

### Layer 5: Message Delivery
- **Purpose**: Deliver events to actor mailboxes
- **Components**: `enqueueMessage()`, mailbox system
- **Status**: ❓ UNKNOWN - Need to verify

## Layer-by-Layer Debugging Plan

### Layer 1: Actor Behavior Definition ✅

**Test**: Verify actors correctly define emit behavior

```typescript
// TEST: Actor returns emit array
const counterBehavior = defineActor<CounterMessage>()
  .withContext<CounterContext>({ count: 0 })
  .onMessage(({ message, actor }) => {
    if (message.type === 'INCREMENT') {
      return {
        context: { count: actor.getSnapshot().context.count + 1 },
        emit: [{ type: 'COUNT_INCREMENTED', ... }]
      };
    }
  });
```

**Verification Points**:
- [x] Actor behavior builds correctly
- [x] onMessage handler returns correct structure
- [x] emit array is properly formatted

**Unit Test Location**: `src/unit/fluent-behavior-builder.test.ts`

### Layer 2: Message Processing ✅

**Test**: Verify message processor handles emit arrays

**Components**:
1. `PureActorBehaviorHandler.handleMessage()`
2. `OTPMessagePlanProcessor.processOTPResult()`
3. `OTPMessagePlanProcessor.processEmitArray()`

**Verification Points**:
- [x] Handler detects ActorHandlerResult with emit array
- [x] OTP processor is invoked for results with emit
- [x] processEmitArray is called with correct events

**Debug Logs Found**:
```
🔍 BEHAVIOR HANDLER: Processing OTP ActorHandlerResult
🔍 OTP STEP DEBUG: Starting emit processing
🔍 EMIT ARRAY DEBUG: Processing message
```

**Unit Test Needed**: Test for OTPMessagePlanProcessor emit handling

### Layer 3: Event Emission ⚠️

**Test**: Verify dependencies.emit() is called correctly

**Components**:
1. `createActorDependencies()` in actor-system-impl.ts
2. `dependencies.emit()` function
3. `emitEventToSubscribers()` method

**Verification Points**:
- [x] dependencies.emit is called for each event
- [ ] Event message is properly formatted
- [ ] emitEventToSubscribers receives correct parameters

**Debug Point**: Add logging to trace event flow
```typescript
emit: (event: unknown) => {
  const eventMessage = this.createEventMessage(address, event);
  this.autoPublishingRegistry.trackEmittedEvent(actorId, eventMessage.type);
  this.emitEventToSubscribers(address, eventMessage);
}
```

**Unit Test Needed**: Test for event emission flow

### Layer 4: Event Routing ❌

**Test**: Verify auto-publishing registry routes events

**Components**:
1. `AutoPublishingRegistry.analyzeActorBehavior()`
2. `AutoPublishingRegistry.addSubscriber()`
3. `AutoPublishingRegistry.getSubscribersForEvent()`

**Verification Points**:
- [ ] Publisher is registered in auto-publishing registry
- [ ] Subscriber is added to publisher's subscriber list
- [ ] getSubscribersForEvent returns correct subscribers

**Critical Debug**: This appears to be where the failure occurs

**Debug Logs to Add**:
```typescript
// In emitEventToSubscribers
console.log('🔍 EMIT DEBUG: Getting subscribers', {
  publisherId,
  eventType,
  registeredPublishers: Array.from(this.autoPublishingRegistry.publishableActors.keys())
});
```

**Unit Test Needed**: Test for AutoPublishingRegistry

### Layer 5: Message Delivery ❓

**Test**: Verify events are enqueued to subscriber mailboxes

**Components**:
1. `enqueueMessage()` method
2. Mailbox system
3. Message processing loop

**Verification Points**:
- [ ] enqueueMessage is called for each subscriber
- [ ] Messages are added to mailboxes
- [ ] Processing loop picks up messages

**Unit Test Needed**: Test for event delivery to mailboxes

## Test Implementation Plan

### 1. Unit Test: Auto-Publishing Registry
```typescript
describe('AutoPublishingRegistry', () => {
  it('should track publishers and subscribers', () => {
    const registry = new AutoPublishingRegistry();
    const publisherId = 'actor://test/publisher';
    const behavior = { onMessage: () => {} };
    
    // Analyze publisher
    registry.analyzeActorBehavior(publisherId, behavior);
    
    // Add subscriber
    const subscriber = { address: { path: 'actor://test/subscriber' } };
    registry.addSubscriber(publisherId, 'subscriber-id', subscriber, ['TEST_EVENT']);
    
    // Get subscribers
    const subscribers = registry.getSubscribersForEvent(publisherId, 'TEST_EVENT');
    expect(subscribers).toHaveLength(1);
  });
});
```

### 2. Integration Test: Minimal Event Flow
```typescript
describe('Minimal Event Emission', () => {
  it('should deliver event from publisher to subscriber', async () => {
    const system = createActorSystem({ nodeAddress: 'test' });
    await system.start();
    
    // Create publisher
    const publisher = defineActor()
      .withContext({})
      .onMessage(() => ({
        context: {},
        emit: [{ type: 'TEST_EVENT', data: 'hello' }]
      }));
    
    // Create subscriber that collects events
    let received = [];
    const subscriber = defineActor()
      .withContext({})
      .onMessage(({ message }) => {
        received.push(message);
        return {};
      });
    
    const pub = await system.spawn(publisher, { id: 'publisher' });
    const sub = await system.spawn(subscriber, { id: 'subscriber' });
    
    // Subscribe
    await system.subscribe(pub, { subscriber: sub, events: ['TEST_EVENT'] });
    
    // Trigger emission
    await pub.send({ type: 'TRIGGER' });
    
    // Wait and verify
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('TEST_EVENT');
  });
});
```

## Root Cause Analysis

Based on the debugging, the most likely issue is in Layer 4 (Event Routing):

1. The `AutoPublishingRegistry` may not be correctly mapping publishers to subscribers
2. The publisher ID format might not match between registration and lookup
3. The event type filtering might be incorrectly implemented

## Fix Implementation Strategy

### Step 1: Add Comprehensive Logging
Add debug logs at each layer to trace the exact flow and identify where events are lost.

### Step 2: Create Focused Unit Tests
Create unit tests for each component in the event emission chain.

### Step 3: Fix the Root Cause
Once identified through testing and logging, fix the specific component that's failing.

### Step 4: Verify Integration Tests Pass
Ensure all event emission integration tests pass after the fix.

## Current Status

- **Layer 1-2**: ✅ Working correctly
- **Layer 3**: ⚠️ Partially working, needs verification
- **Layer 4**: ❌ Likely source of the bug
- **Layer 5**: ❓ Unknown, needs testing

## Next Steps

1. Add detailed logging to `emitEventToSubscribers()` and `AutoPublishingRegistry`
2. Create unit test for `AutoPublishingRegistry`
3. Create minimal integration test to isolate the issue
4. Fix the identified problem
5. Verify all integration tests pass