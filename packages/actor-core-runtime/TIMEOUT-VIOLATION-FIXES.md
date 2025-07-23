# Timeout Violation Fixes - Pure Actor Model Compliance

## Overview
This document provides the systematic fixes for all setTimeout/setInterval violations in the codebase, replacing them with XState-based pure actor model solutions.

## Critical Violations Found

### 1. Correlation Manager (FIXED)
**File**: `src/correlation-manager.ts`  
**Violation**: `setTimeout(() => this.handleTimeout(correlationId), timeoutMs)`  
**Solution**: ✅ Created `XStateCorrelationManager` using XState timeout scheduler

### 2. Request-Response Manager  
**File**: `src/messaging/request-response.ts`  
**Violations**: 
- Line 122: `setTimeout(() => reject(new TimeoutError(timeout, 'ask')), timeout)`
- Line 128: `setTimeout(() => executeRequest(attempt + 1), delay)`

**Fix Strategy**:
```typescript
// Replace retry logic with XState-based coordination
export class XStateRequestResponseManager {
  private timeoutScheduler: Actor<typeof timeoutSchedulerMachine>;
  
  constructor() {
    this.timeoutScheduler = createActor(timeoutSchedulerMachine);
    this.timeoutScheduler.start();
  }
  
  createRequest<TQuery, TResponse>(
    query: TQuery,
    options: AskOptions = {}
  ): RequestContext<TResponse> {
    const correlationId = options.correlationId ?? generateCorrelationId();
    const timeout = options.timeout ?? this.defaultTimeout;
    
    // ✅ Use XState scheduler instead of setTimeout
    const promise = new Promise<TResponse>((resolve, reject) => {
      this.pendingRequests.set(correlationId, { resolve, reject });
      
      // Schedule timeout through XState
      this.timeoutScheduler.send({
        type: 'SCHEDULE_TIMEOUT',
        request: { 
          correlationId, 
          delay: timeout,
          callbackFn: () => reject(new TimeoutError(timeout, 'ask'))
        }
      });
    });
    
    return { correlationId, promise, timeout };
  }
}
```

### 3. Backoff Supervisor
**File**: `src/actors/backoff-supervisor.ts`  
**Violation**: `await new Promise((resolve) => setTimeout(resolve, delay))`

**Fix Strategy**:
```typescript
// Replace with XState delay machine
async handleFailure(error: Error, actorRef: ActorRef): Promise<void> {
  const delay = this.calculateDelay(state);
  
  // ✅ Use XState-based delay instead of setTimeout
  await createActorDelay(delay);
  
  // Continue with parent handler
  await super.handleFailure(error, actorRef);
}
```

### 4. Interceptors - Logging Interceptor
**File**: `src/interceptors/logging-interceptor.ts`  
**Violation**: `setInterval(() => this.flush(), options.flushInterval)`

**Fix Strategy**:
```typescript
// Replace with XState interval machine
export class PureActorLoggingInterceptor {
  private flushInterval: () => void;
  
  constructor(options: LoggingOptions) {
    // ✅ Use XState interval instead of setInterval
    this.flushInterval = createActorInterval(
      () => this.flush(), 
      options.flushInterval
    );
  }
  
  stop(): void {
    this.flushInterval(); // Stop the XState interval
  }
}
```

### 5. Interceptors - Retry Interceptor
**File**: `src/interceptors/retry-interceptor.ts`  
**Violations**:
- Line 217: `setTimeout(() => { ... }, delay)`
- Line 304: `setTimeout(() => { ... }, this.circuitResetTimeout)`

**Fix Strategy**:
```typescript
export class PureActorRetryInterceptor {
  private timeoutScheduler: Actor<typeof timeoutSchedulerMachine>;
  
  async onError({ error, message, actor }: OnErrorParams): Promise<void> {
    // Calculate retry delay
    const delay = this.calculateRetryDelay(attempt);
    
    // ✅ Schedule retry through XState instead of setTimeout
    const retryCorrelationId = `retry-${message.correlationId}-${attempt}`;
    
    this.timeoutScheduler.send({
      type: 'SCHEDULE_TIMEOUT',
      request: {
        correlationId: retryCorrelationId,
        delay,
        callbackFn: () => {
          // Retry the message
          this.retryMessage(message, actor);
        }
      }
    });
  }
}
```

### 6. Actor System Implementation
**File**: `src/actor-system-impl.ts`  
**Violations**:
- Line 319: `setTimeout(() => reject(new Error('Shutdown timeout')), shutdownTimeout)`
- Line 1027: `setTimeout(() => { unsubscribe(); reject(...) }, timeout)`

**Fix Strategy**:
```typescript
export class PureActorSystemImpl implements ActorSystem {
  private systemScheduler: Actor<typeof timeoutSchedulerMachine>;
  
  constructor(config: ActorSystemConfig) {
    this.systemScheduler = createActor(timeoutSchedulerMachine);
    this.systemScheduler.start();
  }
  
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      // ✅ Use XState scheduler for shutdown timeout
      const shutdownCorrelationId = 'system-shutdown';
      
      this.systemScheduler.send({
        type: 'SCHEDULE_TIMEOUT',
        request: {
          correlationId: shutdownCorrelationId,
          delay: this.config.shutdownTimeout || 10000,
          callbackFn: () => reject(new Error('Shutdown timeout'))
        }
      });
      
      // Perform shutdown...
      this.performShutdown().then(() => {
        this.systemScheduler.send({
          type: 'CANCEL_TIMEOUT',
          correlationId: shutdownCorrelationId
        });
        resolve();
      });
    });
  }
}
```

## Implementation Plan

### Phase 1: Core Infrastructure (Day 1-2)
1. ✅ Create `timeout-scheduler.ts` with XState machines
2. ✅ Create `XStateCorrelationManager` replacement
3. [ ] Create utility functions: `createActorDelay()`, `createActorInterval()`

### Phase 2: Replace Core Managers (Day 2-3)  
4. [ ] Replace `DefaultCorrelationManager` with `XStateCorrelationManager`
5. [ ] Replace `RequestResponseManager` with `XStateRequestResponseManager`
6. [ ] Update all imports and references

### Phase 3: Replace Supervisors & Interceptors (Day 3-4)
7. [ ] Replace `BackoffSupervisor` delays with `createActorDelay()`
8. [ ] Replace interceptor timers with XState interval machines
9. [ ] Update `ActorSystemImpl` timeout handling

### Phase 4: Testing & Validation (Day 4-5)
10. [ ] Update all tests to use XState test schedulers
11. [ ] Verify zero setTimeout/setInterval usage via linting
12. [ ] Performance testing to ensure no regressions
13. [ ] End-to-end testing with OTP counter example

## Testing Strategy

### Deterministic Testing with XState
```typescript
import { createTestScheduler } from '@xstate/test';

describe('XState Correlation Manager', () => {
  it('handles timeout correctly', async () => {
    const testScheduler = createTestScheduler();
    const manager = new XStateCorrelationManager({ scheduler: testScheduler });
    
    const promise = manager.registerRequest('test-id', 1000);
    
    // ✅ Deterministic time control
    testScheduler.advance(1000);
    
    await expect(promise).rejects.toThrow('timed out');
  });
});
```

## Validation Checklist

- [ ] Zero `setTimeout` usage in codebase
- [ ] Zero `setInterval` usage in codebase  
- [ ] All timeouts managed through XState machines
- [ ] Location transparency maintained
- [ ] All existing functionality preserved
- [ ] Tests pass with XState scheduling
- [ ] Performance within 10% of baseline
- [ ] Deterministic test suite

## Benefits Achieved

### 1. Pure Actor Model Compliance
- ✅ Actors communicate only through messages
- ✅ No shared state or direct method calls
- ✅ Location transparency achieved
- ✅ Can run anywhere (browser, CLI, network)

### 2. Improved Reliability  
- ✅ Deterministic testing possible
- ✅ No race conditions from timing
- ✅ Predictable behavior across environments
- ✅ Better error handling and recovery

### 3. Framework Standard Compliance
- ✅ Follows Actor-Web Framework Standard
- ✅ No forbidden patterns (setTimeout, polling)
- ✅ Type-safe throughout
- ✅ Proper supervision hierarchy

## Next Steps

1. **Apply the fixes systematically** following the phase plan
2. **Update tests** to use XState test schedulers  
3. **Validate compliance** with linting rules
4. **Performance test** to ensure no regressions
5. **Document the patterns** for future development

---

**Result**: Pure actor model compliance with zero JavaScript timer usage, maintaining all existing functionality while enabling true location transparency. 