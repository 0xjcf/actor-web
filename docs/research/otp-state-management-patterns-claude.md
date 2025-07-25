# OTP State Management Patterns for Actor-Web TypeScript Framework

## State update patterns solve Actor-Web's critical limitation

The research reveals that Erlang/OTP's return-based state management pattern, successfully scaled to billions of users at WhatsApp and Discord, provides the ideal solution for Actor-Web's context-based actors. By returning new state from message handlers rather than mutating in place, actors maintain purity while enabling state updates. Combined with XState's `assign` pattern and production-grade behavior switching techniques, Actor-Web can support both simple context updates and complex state machines within its existing MessagePlan architecture.

## Return-based state updates: The OTP foundation

Erlang/OTP's gen_server behavior demonstrates how pure actors update state through handler return values. Every message handler returns a tuple containing the response and the new state, ensuring immutability while enabling state evolution. This pattern has proven itself at massive scale - WhatsApp handles **900 million users with just 50 engineers** using these patterns, achieving **2 million concurrent connections per server**.

The core pattern translates directly to TypeScript:

```typescript
interface HandlerReturn<TState, TResponse> {
  response?: TResponse;
  state: TState;
  actions?: Action[];
}

class ContextActor<TState> {
  async handle(message: Message, context: TState): Promise<HandlerReturn<TState, any>> {
    switch (message.type) {
      case 'INCREMENT':
        return { 
          state: { ...context, count: context.count + 1 },
          response: context.count + 1
        };
      case 'RESET':
        return { 
          state: { ...context, count: 0 },
          response: 'reset complete'
        };
      default:
        return { state: context }; // No state change
    }
  }
}
```

This pattern maintains Actor-Web's pure actor model while solving the state update problem. The handler receives immutable context and returns new state, which the framework applies atomically after message processing completes.

## XState-inspired assign pattern for complex updates

Modern TypeScript actor frameworks, particularly XState, provide sophisticated patterns for type-safe state updates. XState's `assign` action demonstrates how to compose multiple state updates while maintaining immutability:

```typescript
// Adapted assign pattern for Actor-Web
type StateUpdater<TContext> = (context: TContext, event: any) => Partial<TContext>;

interface StateUpdate<TContext> {
  type: 'assign';
  updates: Record<string, StateUpdater<TContext>>;
}

function assign<TContext>(updates: Record<string, StateUpdater<TContext>>): StateUpdate<TContext> {
  return { type: 'assign', updates };
}

// Usage in Actor-Web handler
async handle(message: Message, context: UserContext): Promise<HandlerReturn<UserContext, any>> {
  switch (message.type) {
    case 'UPDATE_PROFILE':
      const updates = assign({
        name: (ctx, event) => event.name || ctx.name,
        email: (ctx, event) => event.email || ctx.email,
        lastUpdated: () => new Date().toISOString()
      });
      
      // Apply updates immutably
      const newContext = applyUpdates(context, updates, message);
      return { state: newContext, response: 'profile updated' };
  }
}
```

## Behavior switching enables dynamic actor evolution

The "becomes" pattern from Akka and Proto.Actor provides elegant behavior switching without complex state machines. Actors can switch their entire message handling logic based on state transitions:

```typescript
type BehaviorFunction<TState> = (
  message: Message, 
  context: TState
) => Promise<HandlerReturn<TState, any>>;

interface BehaviorContext<TState> {
  context: TState;
  behavior: BehaviorFunction<TState>;
}

// Behavior factory functions
function createCounterBehavior(): BehaviorFunction<CounterState> {
  return async (message, context) => {
    switch (message.type) {
      case 'INCREMENT':
        return { 
          state: { ...context, value: context.value + 1 },
          response: context.value + 1
        };
      case 'SWITCH_TO_MULTIPLIER':
        return {
          state: context,
          behavior: createMultiplierBehavior(), // Switch behavior
          response: 'switched to multiplier mode'
        };
    }
  };
}

function createMultiplierBehavior(): BehaviorFunction<CounterState> {
  return async (message, context) => {
    switch (message.type) {
      case 'MULTIPLY':
        return {
          state: { ...context, value: context.value * message.factor },
          response: context.value * message.factor
        };
      case 'SWITCH_TO_COUNTER':
        return {
          state: context,
          behavior: createCounterBehavior(), // Switch back
          response: 'switched to counter mode'
        };
    }
  };
}
```

This pattern enables Actor-Web to support dynamic behavior changes without rebuilding the entire actor, crucial for long-running stateful services.

## Hybrid architecture supports both simple and complex state

Production frameworks like Orleans and Akka demonstrate that supporting both simple state updates and complex state machines in the same framework is not only possible but essential. Actor-Web can adopt a hybrid approach:

```typescript
// Enhanced Actor-Web actor definition
interface ActorDefinition<TContext = any> {
  name: string;
  initialContext?: TContext;
  machine?: StateMachine<TContext, any, any>; // XState machine
  handlers?: MessageHandlers<TContext>; // Simple handlers
}

// Simple context-based actor
const counterActor: ActorDefinition<{ count: number }> = {
  name: 'counter',
  initialContext: { count: 0 },
  handlers: {
    INCREMENT: async (ctx) => ({
      state: { count: ctx.count + 1 },
      response: ctx.count + 1
    }),
    DECREMENT: async (ctx) => ({
      state: { count: ctx.count - 1 },
      response: ctx.count - 1
    })
  }
};

// Complex state machine actor
const sessionActor: ActorDefinition<SessionContext> = {
  name: 'session',
  machine: createMachine({
    initial: 'anonymous',
    context: { userId: null, permissions: [] },
    states: {
      anonymous: {
        on: {
          LOGIN: {
            target: 'authenticated',
            actions: assign({
              userId: (_, event) => event.userId,
              permissions: (_, event) => event.permissions
            })
          }
        }
      },
      authenticated: {
        on: {
          LOGOUT: {
            target: 'anonymous',
            actions: assign({
              userId: () => null,
              permissions: () => []
            })
          }
        }
      }
    }
  })
};
```

## Hot code reloading preserves actor state

Erlang's code_change callback pattern enables zero-downtime deployments by preserving state across code updates. Actor-Web can implement similar functionality:

```typescript
interface VersionedState<T> {
  version: string;
  data: T;
}

interface StateMigration<TFrom, TTo> {
  fromVersion: string;
  toVersion: string;
  migrate: (oldState: TFrom) => TTo;
}

class UpgradeableActor<TState> {
  private migrations = new Map<string, StateMigration<any, any>>();
  
  registerMigration<TFrom, TTo>(migration: StateMigration<TFrom, TTo>) {
    const key = `${migration.fromVersion}->${migration.toVersion}`;
    this.migrations.set(key, migration);
  }
  
  async upgrade(
    newHandlers: MessageHandlers<TState>,
    currentVersion: string,
    targetVersion: string
  ): Promise<void> {
    // Find migration path
    const migration = this.migrations.get(`${currentVersion}->${targetVersion}`);
    
    if (migration) {
      // Suspend message processing
      await this.suspend();
      
      try {
        // Migrate state
        const currentState = await this.getState();
        const migratedState = migration.migrate(currentState);
        
        // Update handlers and state atomically
        await this.setState(migratedState);
        this.handlers = newHandlers;
        
      } finally {
        // Resume processing
        await this.resume();
      }
    }
  }
}

// Example migration
const v1ToV2Migration: StateMigration<UserV1, UserV2> = {
  fromVersion: '1.0.0',
  toVersion: '2.0.0',
  migrate: (oldState) => ({
    ...oldState,
    preferences: oldState.preferences || defaultPreferences,
    metadata: {
      migrated: true,
      migratedAt: new Date().toISOString()
    }
  })
};
```

## Performance patterns from production systems

Production benchmarks reveal critical performance insights. Proto.Actor achieves **45,000 messages/second** throughput by minimizing serialization overhead for local actors. Key optimizations for Actor-Web include:

**Immutable updates with structural sharing** minimize memory overhead:
```typescript
import { produce } from 'immer';

// Efficient nested updates
const updateNestedState = produce((draft: ComplexState) => {
  draft.users[userId].profile.lastActive = Date.now();
  draft.metrics.activeUsers = draft.metrics.activeUsers + 1;
});

// Applied in handler
return { 
  state: updateNestedState(context),
  response: 'updated'
};
```

**Batch state updates** reduce overhead for multiple changes:
```typescript
interface BatchUpdate<TContext> {
  updates: Array<(ctx: TContext) => TContext>;
}

function batchUpdates<TContext>(
  context: TContext, 
  updates: Array<(ctx: TContext) => TContext>
): TContext {
  return updates.reduce((ctx, update) => update(ctx), context);
}

// Usage
return {
  state: batchUpdates(context, [
    ctx => ({ ...ctx, status: 'processing' }),
    ctx => ({ ...ctx, startTime: Date.now() }),
    ctx => ({ ...ctx, attempts: ctx.attempts + 1 })
  ])
};
```

## Practical implementation patterns

Based on the research, here's a complete pattern for Actor-Web that addresses all requirements:

```typescript
// Core types maintaining MessagePlan compatibility
interface ActorHandlerResult<TContext, TResponse = void> {
  state?: TContext; // New state (undefined = no change)
  response?: TResponse;
  behavior?: BehaviorFunction<TContext>; // Behavior switch
  effects?: Effect[]; // Side effects to execute
}

// Enhanced actor class supporting both patterns
class Actor<TContext> {
  private context: TContext;
  private behavior?: BehaviorFunction<TContext>;
  private machine?: StateMachine<TContext, any, any>;
  
  constructor(private definition: ActorDefinition<TContext>) {
    this.context = definition.initialContext || {} as TContext;
    this.machine = definition.machine;
    this.behavior = definition.behavior;
  }
  
  async handleMessage(message: Message): Promise<any> {
    // Machine-based actors use XState
    if (this.machine) {
      const { state, actions } = this.machine.transition(
        this.machine.getSnapshot(), 
        message
      );
      
      // Apply context updates from actions
      const newContext = actions.reduce((ctx, action) => {
        if (action.type === 'xstate.assign') {
          return action.assignment(ctx, message);
        }
        return ctx;
      }, this.context);
      
      this.context = newContext;
      return state.context;
    }
    
    // Context-based actors use handlers or behaviors
    const handler = this.behavior || this.definition.handlers?.[message.type];
    if (!handler) {
      throw new Error(`No handler for message type: ${message.type}`);
    }
    
    const result = await handler(this.context, message);
    
    // Apply state updates
    if (result.state !== undefined) {
      this.context = result.state;
    }
    
    // Apply behavior switch
    if (result.behavior !== undefined) {
      this.behavior = result.behavior;
    }
    
    // Execute effects
    if (result.effects) {
      await Promise.all(result.effects.map(effect => effect()));
    }
    
    return result.response;
  }
  
  getSnapshot(): TContext {
    return this.context;
  }
}
```

## Conclusion

The research demonstrates that Actor-Web's state management challenge has been solved elegantly by established actor frameworks. By adopting Erlang/OTP's return-based state updates, XState's assign pattern for complex updates, and Akka's behavior switching, Actor-Web can maintain pure actor principles while enabling practical state management. The hybrid approach supporting both simple context and complex state machines provides maximum flexibility, while hot code reloading patterns ensure production readiness. These patterns, proven at scale by WhatsApp, Discord, and countless production systems, offer Actor-Web a clear path forward that maintains type safety, enables efficient state updates, and preserves the elegance of the actor model.