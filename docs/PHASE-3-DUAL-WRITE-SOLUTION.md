# Phase 3: Solving the Dual-Write Problem with Transactional Outbox

## The Current Problem

In the current implementation, components perform two separate operations that should be atomic:

```typescript
// Current approach - TWO SEPARATE WRITES:
onMessage: async ({ message, context, machine, emit }) => {
  if (message.type === 'SUBMIT_FORM') {
    // Write 1: Update XState machine (UI state)
    machine.send({ type: 'SAVE_STARTED' });
    
    // Write 2: Emit domain event
    emit({ type: 'FORM_SUBMITTED', data: formData });
    
    // 🚨 PROBLEM: What if the process crashes here?
    // - UI shows "saving" but event never emitted
    // - Other actors never know about the submission
  }
}
```

## Phase 3 Solution: Transactional Outbox

The transactional outbox pattern makes **both operations atomic automatically**, without changing the developer API:

```typescript
// Phase 3 - SAME API, but ATOMIC execution:
onMessage: async ({ message, context, machine, emit }) => {
  if (message.type === 'SUBMIT_FORM') {
    // Developer writes the same code as before
    machine.send({ type: 'SAVE_STARTED' });
    emit({ type: 'FORM_SUBMITTED', data: formData });
    
    // But the framework NOW:
    // 1. Intercepts both operations
    // 2. Starts a transaction
    // 3. Persists XState snapshot
    // 4. Persists emitted event in outbox
    // 5. Commits transaction (all or nothing)
    // 6. Applies state change to UI
    // 7. Background worker delivers events
  }
}
```

## How It Works Under the Hood

### 1. Transparent Interception

The framework intercepts state changes and event emissions:

```typescript
// Inside the component runtime (Phase 3)
const wrappedMachine = {
  send: (event) => {
    // Queue state change for transaction
    pendingStateChanges.push(event);
  }
};

const wrappedEmit = (event) => {
  // Queue event for transaction
  pendingEvents.push(event);
};

// After onMessage completes:
if (pendingStateChanges.length || pendingEvents.length) {
  await durableStore.transaction(async (tx) => {
    // Save everything atomically
    await tx.saveActorState(actorId, machine.getSnapshot());
    await tx.saveToOutbox(actorId, pendingEvents);
  });
  
  // Only after commit:
  // - Apply state changes to XState
  // - Background worker delivers outbox events
}
```

### 2. Atomic Persistence with DurableStore

```typescript
interface DurableStore {
  // Atomic API - both succeed or both fail
  putStateAndEvent(
    actorId: string,
    state: ActorSnapshot,
    events: ActorMessage[]
  ): Promise<void>;
}

// Browser: IndexedDB transaction
// Node/Electron: SQLite transaction
// Fallback: In-memory with warning
```

### 3. Guaranteed Delivery

Even if the process crashes after the transaction:
- On restart, the persisted state is restored to XState
- The outbox forwarder finds undelivered events
- Events are delivered exactly once (UUID v7 idempotency)
- UI and system state remain perfectly synchronized

## Benefits for Developers

1. **Zero Code Changes**: Keep using `machine.send()` and `emit()` as before
2. **Automatic Atomicity**: Framework ensures consistency
3. **Crash Recovery**: State and events survive any failure
4. **Offline Support**: Events queued until connection restored
5. **No Manual Coordination**: No need for sagas or compensating transactions

## Example: Form Submission

### Current (Phase 2) - Risk of Inconsistency
```typescript
onMessage: async ({ message, machine, emit }) => {
  // These happen separately - risky!
  machine.send({ type: 'SUBMIT' });
  
  const result = await backend.save(data);
  if (result.ok) {
    emit({ type: 'SAVED', id: result.id });
    machine.send({ type: 'SUBMIT_SUCCESS' });
  }
  // 💥 Crash here = UI shows success but no SAVED event!
}
```

### With Phase 3 - Automatic Consistency
```typescript
onMessage: async ({ message, machine, emit }) => {
  // Same code, but now atomic!
  machine.send({ type: 'SUBMIT' });
  
  const result = await backend.save(data);
  if (result.ok) {
    emit({ type: 'SAVED', id: result.id });
    machine.send({ type: 'SUBMIT_SUCCESS' });
  }
  // ✅ Framework ensures all-or-nothing execution
}
```

## Configuration

```typescript
// Opt into different durability levels
configureOutbox({
  durability: 'auto',      // Default: IndexedDB/SQLite
  store: 'indexeddb',      // Or 'sqlite', 'memory', custom
  flushInterval: 100,      // Ms between outbox flushes
  onError: (evt, err) => { // Handle persistence errors
    console.error('Outbox error:', err);
  }
});
```

## Summary

Phase 3's transactional outbox **transparently** solves the dual-write problem:

1. **No API changes** - Developers keep using `machine.send()` and `emit()`
2. **Automatic atomicity** - Framework batches operations into transactions
3. **Guaranteed consistency** - State and events always synchronized
4. **Production reliability** - Survives crashes, network issues, and restarts

The beauty is that developers get bank-level reliability without writing any extra code or changing their mental model. The framework handles all the complexity behind the scenes. 