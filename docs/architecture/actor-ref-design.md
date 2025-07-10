# 🎭 ActorRef Architecture Design

> **Agent A (Tech Lead) - Actor-SPA Framework Architecture**  
> **Version**: 1.0 | **Date**: 2025-07-10 | **Status**: Architecture Definition

## 🎯 Executive Summary

This document defines the core ActorRef architecture for the Actor-SPA framework, establishing a pure actor model with message-only communication, supervision patterns, and fault tolerance. The design consolidates existing implementations while ensuring type safety and performance.

## 🏗️ Core Architecture Principles

### 1. Pure Actor Model
- **Message-Only Communication**: No direct state access between actors
- **Location Transparency**: ActorRef abstracts actor location and implementation
- **Supervision Trees**: Hierarchical fault tolerance with configurable strategies
- **Reactive State**: Observable patterns for UI integration

### 2. Type Safety First
- **Zero `any` Types**: Complete TypeScript safety throughout
- **Event Type Constraints**: Constrained generics for message types
- **Correlation IDs**: Type-safe request/response patterns
- **Error Boundaries**: Typed error handling and propagation

### 3. Performance Optimized
- **Bounded Mailboxes**: Configurable backpressure handling
- **Memory Efficient**: Minimal object allocation in hot paths
- **Lazy Evaluation**: Deferred computation where possible
- **Batch Processing**: Message batching for performance

## 🔧 Core Interface Design

### Primary ActorRef Interface

```typescript
/**
 * Core ActorRef interface - Pure actor reference for message-based communication
 * 
 * @template TEvent - Event types this actor can receive
 * @template TEmitted - Event types this actor can emit  
 * @template TSnapshot - Snapshot type for actor state observation
 */
export interface ActorRef<
  TEvent extends EventObject = EventObject,
  TEmitted = unknown,
  TSnapshot extends ActorSnapshot = ActorSnapshot,
> {
  // ========================================================================================
  // IDENTITY & METADATA
  // ========================================================================================
  
  /** Unique identifier for this actor */
  readonly id: string;
  
  /** Current lifecycle status */
  readonly status: ActorStatus;
  
  /** Parent actor reference (if child) */
  readonly parent?: ActorRef<EventObject, unknown>;
  
  /** Supervision strategy applied to this actor */
  readonly supervision?: SupervisionStrategy;

  // ========================================================================================
  // MESSAGE PASSING (CORE ACTOR MODEL)
  // ========================================================================================
  
  /**
   * Send fire-and-forget message to actor
   * @param event - Event to send
   */
  send(event: TEvent): void;
  
  /**
   * Request/response pattern with correlation ID
   * @param query - Query to send
   * @param options - Timeout and other options
   * @returns Promise resolving to response
   */
  ask<TQuery, TResponse>(
    query: TQuery, 
    options?: AskOptions
  ): Promise<TResponse>;

  // ========================================================================================
  // STATE OBSERVATION (REACTIVE PATTERNS)
  // ========================================================================================
  
  /**
   * Observe state changes reactively
   * @param selector - Function to select state slice
   * @returns Observable of selected state
   */
  observe<TSelected>(
    selector: (snapshot: TSnapshot) => TSelected
  ): Observable<TSelected>;
  
  /**
   * Get current state snapshot (one-time read)
   * @returns Current actor snapshot
   */
  getSnapshot(): TSnapshot;

  // ========================================================================================
  // ACTOR LIFECYCLE
  // ========================================================================================
  
  /** Start the actor if not already running */
  start(): void;
  
  /** Stop actor gracefully and cleanup resources */
  stop(): Promise<void>;
  
  /** Restart actor with same configuration */
  restart(): Promise<void>;

  // ========================================================================================
  // ACTOR SUPERVISION (HIERARCHICAL FAULT TOLERANCE)
  // ========================================================================================
  
  /**
   * Spawn child actor under supervision
   * @param behavior - Actor behavior or state machine
   * @param options - Spawn options including supervision
   * @returns Reference to spawned child
   */
  spawn<TChildEvent extends EventObject, TChildEmitted = unknown>(
    behavior: ActorBehavior<TChildEvent> | StateMachine<unknown, unknown, TChildEvent>,
    options?: SpawnOptions
  ): ActorRef<TChildEvent, TChildEmitted>;
  
  /**
   * Stop a specific child actor
   * @param childId - ID of child to stop
   */
  stopChild(childId: string): Promise<void>;
  
  /**
   * Get all child actor references
   * @returns Map of child IDs to actor references
   */
  getChildren(): ReadonlyMap<string, ActorRef<EventObject, unknown>>;
}
```

### Supporting Types

```typescript
export type ActorStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

export interface ActorSnapshot {
  status: ActorStatus;
  context: unknown;
  error?: Error;
  timestamp: number;
}

export interface AskOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

export interface SpawnOptions {
  id?: string;
  supervision?: SupervisionStrategy;
  autoStart?: boolean;
  input?: unknown;
}

export type SupervisionStrategy = 
  | 'restart-on-failure'
  | 'stop-on-failure'
  | 'escalate'
  | 'ignore'
  | ((error: Error, attempts: number) => SupervisionAction);

export type SupervisionAction = 'restart' | 'stop' | 'escalate' | 'ignore';
```

## 📨 Message Protocol Design

### Event Types Hierarchy

```typescript
// Base event constraint
export interface EventObject {
  type: string;
}

// Application events
export interface ApplicationEvent extends EventObject {
  payload?: unknown;
  metadata?: EventMetadata;
}

// System events for actor lifecycle
export interface SystemEvent extends EventObject {
  type: `actor.${string}`;
  actorId: string;
  timestamp: number;
}

// Query/response events
export interface QueryEvent<TParams = unknown> extends EventObject {
  type: 'query';
  request: string;
  params?: TParams;
  correlationId: string;
  timeout?: number;
}

export interface ResponseEvent<TResult = unknown> extends EventObject {
  type: 'response';
  correlationId: string;
  result?: TResult;
  error?: Error;
  timestamp: number;
}
```

### Request/Response Pattern

```typescript
/**
 * Correlation-based request/response manager
 */
export class RequestResponseManager {
  private pendingRequests = new Map<string, PendingRequest>();
  
  /**
   * Create request with correlation ID
   */
  createRequest<TQuery, TResponse>(
    query: TQuery,
    options: AskOptions = {}
  ): RequestContext<TResponse> {
    const correlationId = generateCorrelationId();
    const timeout = options.timeout ?? 5000;
    
    const promise = new Promise<TResponse>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new TimeoutError(`Request ${correlationId} timed out`, timeout));
      }, timeout);
      
      this.pendingRequests.set(correlationId, { resolve, reject, timeoutId });
    });
    
    const queryEvent: QueryEvent<TQuery> = {
      type: 'query',
      request: typeof query === 'string' ? query : (query as any).type,
      params: query,
      correlationId,
      timeout,
    };
    
    return { queryEvent, promise, correlationId };
  }
  
  /**
   * Handle incoming response
   */
  handleResponse<TResponse>(response: ResponseEvent<TResponse>): void {
    const pending = this.pendingRequests.get(response.correlationId);
    if (!pending) return;
    
    this.pendingRequests.delete(response.correlationId);
    clearTimeout(pending.timeoutId);
    
    if (response.error) {
      pending.reject(response.error);
    } else {
      pending.resolve(response.result as TResponse);
    }
  }
}
```

## 🏛️ Supervision Architecture

### Supervision Strategies

```typescript
/**
 * Built-in supervision strategies
 */
export const SupervisionStrategies = {
  /**
   * Restart actor on failure (default)
   */
  RestartOnFailure: {
    maxRestarts: 3,
    restartWindow: 60000, // 1 minute
    onFailure: (error: Error, attempts: number): SupervisionAction => {
      return attempts < 3 ? 'restart' : 'stop';
    }
  },
  
  /**
   * Stop actor immediately on failure
   */
  StopOnFailure: {
    onFailure: (): SupervisionAction => 'stop'
  },
  
  /**
   * Escalate to parent supervisor
   */
  Escalate: {
    onFailure: (): SupervisionAction => 'escalate'
  },
  
  /**
   * Ignore failures and continue
   */
  Ignore: {
    onFailure: (): SupervisionAction => 'ignore'
  }
} as const;
```

### Supervisor Implementation

```typescript
/**
 * Actor supervisor with configurable fault tolerance
 */
export class ActorSupervisor {
  private supervisedActors = new Map<string, SupervisedActor>();
  
  /**
   * Supervise an actor with strategy
   */
  supervise(
    actorRef: ActorRef<EventObject, unknown>,
    strategy: SupervisionStrategy
  ): void {
    const supervised: SupervisedActor = {
      actorRef,
      strategy,
      restartCount: 0,
      restartTimestamps: [],
    };
    
    this.supervisedActors.set(actorRef.id, supervised);
    this.subscribeToActorErrors(actorRef);
  }
  
  /**
   * Handle actor failure according to strategy
   */
  async handleFailure(
    actorRef: ActorRef<EventObject, unknown>,
    error: Error
  ): Promise<void> {
    const supervised = this.supervisedActors.get(actorRef.id);
    if (!supervised) return;
    
    const action = this.determineAction(supervised, error);
    
    switch (action) {
      case 'restart':
        await this.restartActor(supervised);
        break;
      case 'stop':
        await this.stopActor(supervised);
        break;
      case 'escalate':
        await this.escalateError(supervised, error);
        break;
      case 'ignore':
        // Log and continue
        console.warn(`Ignoring error in actor ${actorRef.id}:`, error);
        break;
    }
  }
}
```

## 🔗 XState Integration Patterns

### State Machine Adapter

```typescript
/**
 * Adapter for XState v5 integration
 */
export class XStateActorRef<
  TEvent extends EventObject,
  TEmitted = unknown
> implements ActorRef<TEvent, TEmitted> {
  
  constructor(
    private interpreter: ActorRef<TEvent>,
    private options: ActorRefOptions = {}
  ) {}
  
  send(event: TEvent): void {
    this.interpreter.send(event);
  }
  
  async ask<TQuery, TResponse>(
    query: TQuery,
    options?: AskOptions
  ): Promise<TResponse> {
    const requestManager = this.getRequestManager();
    const { queryEvent, promise } = requestManager.createRequest<TQuery, TResponse>(
      query,
      options
    );
    
    this.interpreter.send(queryEvent as TEvent);
    return promise;
  }
  
  observe<TSelected>(
    selector: (snapshot: SnapshotFrom<AnyStateMachine>) => TSelected
  ): Observable<TSelected> {
    return new Observable<TSelected>((observer) => {
      const subscription = this.interpreter.subscribe((snapshot) => {
        try {
          const selected = selector(snapshot);
          observer.next(selected);
        } catch (error) {
          observer.error(error);
        }
      });
      
      return () => subscription.unsubscribe();
    });
  }
}
```

## 🚀 Performance Considerations

### Memory Management
- **Bounded Mailboxes**: Prevent memory leaks with configurable limits
- **Subscription Cleanup**: Automatic cleanup on actor stop
- **Weak References**: Use WeakMap for parent/child relationships where appropriate

### Message Throughput
- **Batch Processing**: Process multiple messages in single tick
- **Priority Queues**: High-priority messages bypass normal queue
- **Backpressure**: Apply pressure when mailbox approaches limits

### Error Handling
- **Error Boundaries**: Isolate errors to actor boundaries
- **Graceful Degradation**: Fallback behaviors for failure scenarios
- **Circuit Breakers**: Prevent cascading failures

## 📊 Integration Points

### Component Bridge
```typescript
/**
 * Bridge between actors and React/framework components
 */
export function useActorRef<TEvent, TState>(
  actorRef: ActorRef<TEvent>,
  selector: (snapshot: ActorSnapshot) => TState
): [TState, (event: TEvent) => void] {
  const [state, setState] = useState(() => selector(actorRef.getSnapshot()));
  
  useEffect(() => {
    const subscription = actorRef.observe(selector).subscribe(setState);
    return () => subscription.unsubscribe();
  }, [actorRef, selector]);
  
  const send = useCallback((event: TEvent) => {
    actorRef.send(event);
  }, [actorRef]);
  
  return [state, send];
}
```

## 🎯 Migration Strategy

### Phase 1: Core Interface
1. Consolidate existing ActorRef interfaces
2. Implement unified factory function
3. Add comprehensive type safety

### Phase 2: Supervision
1. Implement supervision strategies
2. Add fault tolerance patterns
3. Create supervision hierarchy

### Phase 3: Integration
1. XState v5 adapter
2. Component bridge patterns
3. Performance optimizations

## 🔍 Future Considerations

- **Web Worker Support**: Remote actors across worker boundaries
- **Persistence**: Actor state snapshots and event sourcing
- **Clustering**: Multi-node actor distribution
- **DevTools**: Actor inspection and debugging tools

---

**This architecture ensures the Actor-SPA framework provides a pure actor model with excellent TypeScript support, fault tolerance, and integration patterns suitable for modern web applications.**