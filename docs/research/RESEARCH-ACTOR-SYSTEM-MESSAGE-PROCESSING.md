# Research Prompt: ActorSystem Message Processing Architecture - setTimeout vs Pure Actor Model

## 1. Project Context

Developing a pure actor model implementation in TypeScript/JavaScript for the Actor-Web Architecture framework. The system aims to provide location-transparent message passing, supervision, and fault tolerance. Currently implementing `ActorSystemImpl` which manages actor lifecycles and message routing.

## 2. Core Problem Statement

The `ActorSystemImpl` currently uses `setTimeout(() => this.processActorMessages(...), 0)` loops for processing actor mailboxes. This approach creates pseudo-event loops rather than following pure actor model principles. The ActorSystem itself should be an actor/state machine, not a manager using timer-based polling.

## 3. Current Setup / Environment

**Key Components:**
- **ActorSystemImpl**: Central system managing actors, using setTimeout for message processing
- **BoundedMailbox**: Queue implementation with overflow strategies
- **XState Integration**: Using XState v5 for actor state machines
- **TypeScript**: Strict mode with no `any` types allowed

**Current Implementation Pattern:**
```typescript
// In ActorSystemImpl
private startMessageProcessingLoop(address: ActorAddress, behavior: ActorDefinition): void {
  this.actorProcessingLoops.set(address.path, true);
  this.actorProcessingActive.set(address.path, true);
  
  // Schedule the processing on the next tick to avoid blocking
  setTimeout(() => this.processActorMessages(address, behavior), 0);
}

private async processActorMessages(address: ActorAddress, behavior: ActorDefinition): Promise<void> {
  // Process messages from mailbox
  // ...
  if (!mailbox.isEmpty()) {
    setTimeout(() => this.processActorMessages(address, behavior), 0);
  }
}
```

## 4. Build & Run Commands

```bash
pnpm build
pnpm test:runtime
```

## 5. Troubleshooting Steps Already Taken & Observations

1. **Replaced setImmediate with setTimeout**: Node.js setImmediate not available in all environments
2. **Observed Issues**:
   - Timer-based polling creates unnecessary overhead
   - Not following pure actor model principles
   - ActorSystem acts as external orchestrator rather than supervisor actor
   - Potential race conditions with processing flags

## 6. Specific Questions for Research

1. **What are the best practices for implementing mailbox processing in JavaScript/TypeScript actor systems without using timer loops?**
   - Should we use async iterators/generators?
   - How do Akka.js, Comedy.js, or other JS actor frameworks handle this?

2. **How can we implement the ActorSystem itself as a state machine/actor?**
   - What would the state machine definition look like?
   - How would it supervise child actors while being an actor itself?

3. **What's the recommended pattern for event-driven mailbox processing?**
   - Should mailboxes emit events when messages arrive?
   - How to avoid busy-waiting while maintaining responsiveness?

4. **Are there existing TypeScript/JavaScript implementations of the Erlang/OTP supervisor pattern we can reference?**
   - How do they handle the bootstrap problem (who supervises the supervisor)?

5. **What are the performance implications of different message processing strategies in JavaScript?**
   - Event emitters vs setTimeout vs async generators
   - Impact on event loop and overall application performance

## 7. Alternative Approaches to Consider

1. **Async Generator Pattern**:
```typescript
async *processMessages(mailbox: BoundedMailbox) {
  while (!this.stopped) {
    const message = await mailbox.dequeue(); // Make dequeue async with notification
    yield message;
  }
}
```

2. **Event-Driven Pattern**:
```typescript
mailbox.on('message', async (message) => {
  await this.processMessage(message);
});
```

3. **ActorSystem as XState Machine**:
```typescript
const actorSystemMachine = createMachine({
  id: 'actorSystem',
  initial: 'idle',
  states: {
    idle: { on: { START: 'running' } },
    running: {
      invoke: {
        src: 'supervisionService',
        onDone: 'stopped'
      }
    }
  }
});
```

## 8. Expected Outcome

A clear architectural pattern for implementing pure actor model message processing in JavaScript/TypeScript that:
- Eliminates timer-based polling
- Follows actor model principles
- Provides efficient, event-driven message processing
- Can be implemented with existing JavaScript runtime capabilities