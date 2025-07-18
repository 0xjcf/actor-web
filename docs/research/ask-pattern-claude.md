# Implementing the Ask Pattern for Actor-Web Framework: A Research-Driven Strategy

## Architecture recommendation: Hybrid ActorRef/System approach

Based on comprehensive research of mature actor frameworks (Akka, Orleans, Erlang/OTP) and TypeScript/XState patterns, I recommend a **hybrid implementation strategy** that combines ActorRef-level type safety with System-level infrastructure. This approach best suits your requirements for TypeScript strict typing, XState v5 integration, and location transparency.

## Core implementation strategy

### Phase 1: System-level foundation with RequestResponseManager

Leverage your existing RequestResponseManager as the central correlation infrastructure:

```typescript
// Extend existing RequestResponseManager for actor-specific needs
interface ActorAskRequest<T, R> {
  correlationId: string;
  targetRef: ActorRef<T>;
  message: T;
  timeout: number;
  resolve: (value: R) => void;
  reject: (error: Error) => void;
}

class EnhancedRequestResponseManager {
  private pendingAsks = new Map<string, ActorAskRequest<any, any>>();
  
  async ask<T, R>(
    target: ActorRef<T>,
    message: T,
    timeout = 5000
  ): Promise<R> {
    const correlationId = generateCorrelationId();
    
    return new Promise<R>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingAsks.delete(correlationId);
        reject(new AskTimeoutError(`Ask timeout after ${timeout}ms`));
      }, timeout);
      
      this.pendingAsks.set(correlationId, {
        correlationId,
        targetRef: target,
        message,
        timeout,
        resolve: (value: R) => {
          clearTimeout(timeoutId);
          this.pendingAsks.delete(correlationId);
          resolve(value);
        },
        reject: (error: Error) => {
          clearTimeout(timeoutId);
          this.pendingAsks.delete(correlationId);
          reject(error);
        }
      });
      
      // Send message with correlation ID
      target.send({
        type: 'ASK_REQUEST',
        payload: message,
        correlationId,
        replyTo: this.selfRef // System's response handler
      });
    });
  }
}
```

### Phase 2: Type-safe ActorRef API with XState v5

Implement ActorRef-level ask that integrates with XState's event system:

```typescript
// Type-safe message protocol definition
interface AskProtocol<TRequest, TResponse> {
  request: TRequest;
  response: TResponse;
}

// Generic actor ref with ask capability
class TypedActorRef<TEvent extends { type: string }> {
  constructor(
    private xstateRef: ActorRefFrom<any>,
    private system: ActorSystem
  ) {}
  
  ask<TRequest extends TEvent, TResponse>(
    request: TRequest,
    options?: { timeout?: number }
  ): Promise<TResponse> {
    return this.system.getRequestResponseManager().ask<TRequest, TResponse>(
      this,
      request,
      options?.timeout
    );
  }
  
  send(event: TEvent): void {
    this.xstateRef.send(event);
  }
}

// XState machine with ask pattern support
const createAskableActor = <TContext, TEvent extends { type: string }>() => {
  return setup({
    types: {
      context: {} as TContext & {
        pendingRequests: Map<string, { replyTo: ActorRef<any> }>;
      },
      events: {} as TEvent | {
        type: 'ASK_REQUEST';
        payload: any;
        correlationId: string;
        replyTo: ActorRef<any>;
      } | {
        type: 'ASK_RESPONSE';
        payload: any;
        correlationId: string;
      }
    }
  }).createMachine({
    context: {
      pendingRequests: new Map()
    },
    on: {
      ASK_REQUEST: {
        actions: [
          // Store correlation info
          assign({
            pendingRequests: ({ context, event }) => {
              const map = new Map(context.pendingRequests);
              map.set(event.correlationId, { replyTo: event.replyTo });
              return map;
            }
          }),
          // Process request
          ({ event, self }) => {
            // Handle request asynchronously
            handleRequest(event.payload).then(response => {
              self.send({
                type: 'INTERNAL_RESPONSE_READY',
                correlationId: event.correlationId,
                response
              });
            });
          }
        ]
      },
      INTERNAL_RESPONSE_READY: {
        actions: ({ context, event }) => {
          const request = context.pendingRequests.get(event.correlationId);
          if (request) {
            request.replyTo.send({
              type: 'ASK_RESPONSE',
              payload: event.response,
              correlationId: event.correlationId
            });
          }
        }
      }
    }
  });
};
```

### Phase 3: Location transparency and serialization

Implement ask pattern that works across process boundaries:

```typescript
// Serializable ask messages
interface RemoteAskRequest {
  type: 'REMOTE_ASK';
  targetPath: string;
  message: SerializedMessage;
  correlationId: string;
  replyTo: string; // Actor path for response
}

// Use MessagePack for efficient serialization
import { encode, decode } from '@msgpack/msgpack';

class DistributedActorRef<T> extends TypedActorRef<T> {
  async ask<TRequest, TResponse>(
    request: TRequest,
    options?: { timeout?: number }
  ): Promise<TResponse> {
    if (this.isLocal()) {
      return super.ask(request, options);
    }
    
    // Remote ask handling
    const correlationId = generateCorrelationId();
    const serialized = encode({
      type: 'REMOTE_ASK',
      targetPath: this.path,
      message: encode(request),
      correlationId,
      replyTo: this.system.self.path
    });
    
    return this.system.sendRemoteAsk(
      this.remoteNode,
      serialized,
      correlationId,
      options?.timeout
    );
  }
}

// Handle actor migration with pending asks
class MigrationAwareActor {
  private pendingAsks = new Map<string, PendingAsk>();
  
  async migrate(newLocation: string): Promise<void> {
    // Serialize pending asks
    const pendingData = Array.from(this.pendingAsks.entries()).map(
      ([id, ask]) => ({
        correlationId: id,
        request: ask.request,
        replyTo: ask.replyTo.path,
        startTime: ask.startTime
      })
    );
    
    // Transfer to new location
    await this.system.transferActor(this.id, newLocation, {
      state: this.state,
      pendingAsks: pendingData
    });
    
    // Rehydrate at new location continues processing
  }
}
```

### Phase 4: Avoiding common pitfalls

Implement safeguards against deadlocks and memory leaks:

```typescript
// Deadlock prevention through request tracking
class DeadlockPreventingSystem {
  private askChains = new Map<string, Set<string>>();
  
  canAsk(from: string, to: string): boolean {
    // Check for circular dependencies
    const chain = this.askChains.get(to) || new Set();
    if (chain.has(from)) {
      console.warn(`Potential deadlock detected: ${from} -> ${to}`);
      return false;
    }
    return true;
  }
  
  recordAsk(from: string, to: string, correlationId: string): void {
    const chain = this.askChains.get(from) || new Set();
    chain.add(to);
    this.askChains.set(from, chain);
    
    // Cleanup on completion
    setTimeout(() => {
      chain.delete(to);
      if (chain.size === 0) {
        this.askChains.delete(from);
      }
    }, 30000); // Cleanup after max timeout
  }
}

// Memory leak prevention
class CorrelationCleaner {
  private readonly CLEANUP_INTERVAL = 60000; // 1 minute
  private readonly MAX_AGE = 300000; // 5 minutes
  
  startCleanup(manager: RequestResponseManager): void {
    setInterval(() => {
      const now = Date.now();
      for (const [id, request] of manager.pendingAsks) {
        if (now - request.startTime > this.MAX_AGE) {
          request.reject(new Error('Ask expired'));
          manager.pendingAsks.delete(id);
        }
      }
    }, this.CLEANUP_INTERVAL);
  }
}
```

### Migration strategy for CLI

Transform synchronous CLI patterns to pure message-passing:

```typescript
// Current synchronous pattern
const branch = await gitActor.getSnapshot().context.currentBranch;

// New ask pattern
interface GitActorProtocol {
  'REQUEST_BRANCH_INFO': { type: 'REQUEST_BRANCH_INFO' };
  'BRANCH_INFO_RESPONSE': { 
    type: 'BRANCH_INFO_RESPONSE';
    branch: string;
    correlationId: string;
  };
}

// CLI command using ask
async function getCurrentBranch(): Promise<string> {
  const response = await gitActorRef.ask<
    GitActorProtocol['REQUEST_BRANCH_INFO'],
    GitActorProtocol['BRANCH_INFO_RESPONSE']
  >({ type: 'REQUEST_BRANCH_INFO' });
  
  return response.branch;
}

// Alternative: Event-driven CLI
const cliMachine = createMachine({
  states: {
    idle: {
      on: {
        GET_BRANCH: 'requestingBranch'
      }
    },
    requestingBranch: {
      entry: sendTo('gitActor', { type: 'REQUEST_BRANCH_INFO' }),
      on: {
        BRANCH_INFO_RESPONSE: {
          target: 'displayingBranch',
          actions: assign({ branch: (_, event) => event.branch })
        }
      }
    }
  }
});
```

## Testing strategy

Implement comprehensive testing support:

```typescript
// Type-safe test utilities
class AskTestKit<T extends { type: string }> {
  private responses = new Map<string, any>();
  
  mockAsk<TReq extends T, TRes>(
    request: TReq,
    response: TRes
  ): void {
    this.responses.set(request.type, response);
  }
  
  createMockActorRef(): TypedActorRef<T> {
    return {
      ask: async (request) => {
        const response = this.responses.get(request.type);
        if (!response) {
          throw new Error(`No mock response for ${request.type}`);
        }
        return response;
      },
      send: jest.fn()
    } as any;
  }
}

// Integration test example
test('ask pattern with timeout', async () => {
  const system = new ActorSystem();
  const slowActor = system.spawn(createSlowActor());
  
  await expect(
    slowActor.ask({ type: 'SLOW_REQUEST' }, { timeout: 100 })
  ).rejects.toThrow(AskTimeoutError);
});
```

## Performance optimization guidelines

1. **Prefer tell over ask** for internal actor communication
2. **Use forward chains** instead of ask chains for pipelines
3. **Implement batching** for high-throughput scenarios
4. **Configure appropriate timeouts** based on operation complexity
5. **Monitor ask patterns** with metrics:

```typescript
const askMetrics = {
  totalAsks: new Counter('actor_asks_total'),
  askDuration: new Histogram('actor_ask_duration_seconds'),
  askTimeouts: new Counter('actor_ask_timeouts_total'),
  pendingAsks: new Gauge('actor_asks_pending')
};
```

## Conclusion

This implementation strategy provides a robust ask pattern that:
- Integrates with existing RequestResponseManager and correlation logic
- Provides type-safe TypeScript APIs with XState v5
- Supports location transparency and distributed actors
- Avoids common pitfalls through careful design
- Enables gradual migration from synchronous patterns
- Maintains pure actor model principles

The hybrid ActorRef/System approach balances type safety with performance, making it ideal for the Actor-Web Framework's requirements.