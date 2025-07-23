# 🎯 Actor-Web Framework API Roadmap

> **Purpose**: Define the evolution of the Actor-Web Framework API from current state to v1.0 public release and enterprise features  
> **Last Updated**: 2025-07-21  
> **Status**: Planning Document

## 📋 Executive Summary

The Actor-Web Framework API will evolve to bring **Erlang OTP-style actor patterns** to JavaScript/TypeScript. We're targeting a **minimal, battle-tested core** that mirrors proven telecom patterns while offering modern web development ergonomics and optional enterprise modules.

### Key Principles
1. **OTP-Style Patterns**: Direct mapping from Erlang/OTP to JS/TS with XState
2. **Minimal Core API**: ~15KB gzipped with only essential actor primitives
3. **Progressive Enhancement**: Advanced features in separate packages
4. **Message Plan DSL**: Declarative, atomic state + event handling (like `Pid ! Reply`)
5. **Location Transparency**: Actors work anywhere with URI addressing
6. **Zero Breaking Changes**: Smooth migration path from v0.x to v1.0

## 🌟 Current State (v0.x)

### Problems Identified
- **API Surface Too Large**: Exposing internal types, utilities, and experimental features
- **Dual-Write Bugs**: Separate `machine.send()` + `emit()` calls cause inconsistency
- **Boilerplate Heavy**: Developers juggle send, emit, ask, retry logic manually
- **Hidden Coupling**: Ad-hoc actor spawning creates memory leaks
- **Mixed Paradigms**: Hybrid model with direct state access violates actor principles

### What We Have
```typescript
// Current verbose API
onMessage({ message, machine, emit }) {
  if (machine.matches('saving')) {
    emit({ type: 'SAVED', data });        // Broadcast
    machine.send({ type: 'SAVE_SUCCESS' }); // Update UI
    deps.store.send({ type: 'PERSIST' });   // Side effect
  }
}
```

## 🚀 Phase 1: Message Plan DSL (Q1 2025)

### Goal
Introduce the **Message Plan DSL** to unify all communication patterns into a single, declarative return value.

### Core API Changes

#### 1. OTP-Style Actor Patterns
```typescript
// NEW: OTP-style counter - XState + Message Plans
const counterMachine = createMachine({
  context: { count: 0 },
  states: {
    alive: {
      on: {
        INCREMENT: { actions: assign({ count: ctx => ctx.count + 1 }) }
      }
    }
  }
});

const counterBehavior = defineBehavior({
  onMessage({ message, machine, deps }) {
    // Equivalent to Erlang: receive {increment, Pid} -> ...
    if (message.type === 'INCREMENT' && message.replyTo) {
      // Fan-out pattern: No manual machine.send() needed!
      // Runtime automatically updates state AND handles reply
      return {
        type: 'INCREMENT',
        replyTo: message.replyTo,
        currentCount: machine.getSnapshot().context.count
      };
    }
    
    // Wildcard clause - no action needed
    return;
  }
});

// Create and use like Erlang processes
const counter = createActor({ machine: counterMachine, behavior: counterBehavior }).start();
const count = await counter.ask({ type: 'INCREMENT', replyTo: self });
```

#### 2. Transactional Outbox (Built-in)
- State + message plan persisted atomically
- Automatic retry with exponential backoff
- Exactly-once delivery via UUID v7 keys
- Survives crashes, offline scenarios

#### 3. Backward Compatibility
```typescript
// Old imperative style still works for non-durable operations
deps.telemetry.send({ type: 'PING' });  // Fire-and-forget, no durability
```

### Migration Guide
| Old Pattern | New Pattern | Benefit |
|------------|-------------|---------|
| `machine.send() + emit()` | Return message plan | Atomic, crash-safe |
| Manual correlation IDs | Built-in ask pattern | Type-safe replies |
| Try-catch error handling | `onErr` handlers | Declarative flow |
| Polling/waiting | Event subscriptions | Reactive, efficient |

### Success Metrics
- [ ] 50% less boilerplate in typical components
- [ ] Zero dual-write bugs in production
- [ ] <4KB additional bundle size
- [ ] 100% backward compatibility

## 📦 Phase 2: Modular Architecture (Q2 2025)

### Goal
Split the monolithic package into focused modules with clear boundaries.

### Package Structure
```
@actor-core/
├── runtime          # Core API (15KB) - PUBLIC
├── components       # Web components (10KB) - PUBLIC  
├── testing          # Test utilities (8KB) - PUBLIC
├── virtual          # Distributed actors - ENTERPRISE
├── persistence      # Event sourcing - ENTERPRISE
├── security         # Capability-based - ENTERPRISE
├── monitoring       # Observability - ENTERPRISE
└── ai               # Agent patterns - ENTERPRISE
```

### Core Runtime API (`@actor-core/runtime`)

#### Exports (Public v1.0)
```typescript
// Actor creation
export { createActor, defineActor } from './actor';
export { createComponent, defineComponentBehavior } from './component';

// Message Plan DSL
export { defineBehavior, ask, tell, broadcast } from './behavior';

// Types (only public interfaces)
export type { 
  ActorRef,        // Opaque handle to actor
  ActorMessage,    // Standard message format
  MessagePlan,     // DSL return types
  ComponentConfig  // Component options
} from './types';

// Lifecycle
export { createActorSystem } from './system';
```

#### NOT Exported (Internal)
- Phantom type utilities
- Message routing internals
- Cache implementations
- Transport details
- Internal type guards

### Component Package (`@actor-core/components`)

```typescript
// Focused on web component integration
export { html, css } from './template';
export { createComponent } from './component';
export { useActor } from './hooks';
```

### Testing Package (`@actor-core/testing`)

```typescript
// Testing utilities
export { TestActorSystem } from './test-system';
export { mockActor } from './mocks';
export { waitForMessage } from './assertions';
```

## 🌐 Phase 3: Location Transparency (Q3 2025)

### Goal
Enable actors to run anywhere with zero code changes.

### URI Addressing Scheme
```typescript
// Actors addressed by URI, not implementation
dependencies: {
  store: 'actor://sw/persistence',      // Service Worker
  sync: 'actor://worker/sync',          // Web Worker
  analytics: 'actor://tab/analytics',   // Another tab
  ai: 'actor://cloud/gpt-assistant'     // Remote cloud
}
```

### Transport Layer
```typescript
// Framework handles routing transparently
interface Transport {
  send(message: ActorMessage, to: ActorURI): Promise<void>;
  connect(uri: ActorURI): Promise<Channel>;
}

// Built-in transports
- MemoryTransport      // Same process
- WorkerTransport      // Web/Service Workers  
- BroadcastTransport   // Cross-tab
- WebSocketTransport   // Remote actors
```

### Developer Experience
```typescript
// Same code works everywhere
const result = await actor.ask({ type: 'CALCULATE', data });
// Framework routes via appropriate transport
```

## 🏢 Phase 4: Enterprise Features (Q4 2025)

### Virtual Actors (`@actor-core/virtual`)
Orleans-style actors with automatic lifecycle management.

```typescript
// Only loaded when you import the package
import { createVirtualSystem } from '@actor-core/virtual';

const system = createVirtualSystem({
  placement: 'consistent-hash',
  persistence: 'auto'
});
```

### Event Sourcing (`@actor-core/persistence`)
Audit trails and time-travel debugging.

```typescript
import { EventSourcedActor } from '@actor-core/persistence';

const auditedActor = EventSourcedActor.from(baseActor, {
  store: postgresEventStore,
  snapshotEvery: 100
});
```

### Capability Security (`@actor-core/security`)
Fine-grained permissions for multi-tenant systems.

```typescript
import { secureActor } from '@actor-core/security';

const secured = secureActor(baseActor, {
  capabilities: ['read:profile', 'write:preferences']
});
```

### AI Agent Patterns (`@actor-core/ai`)
Advanced patterns for autonomous agents.

```typescript
import { createAgent } from '@actor-core/ai';

const agent = createAgent({
  planner: HTNPlanner,
  memory: HybridMemory,
  tools: [gitTool, testTool]
});
```

## 📊 API Versioning Strategy

### Semantic Versioning
- **v0.x**: Beta - Breaking changes allowed
- **v1.0**: Stable Public API - No breaking changes
- **v2.0**: Major evolution (2+ years out)

### Deprecation Policy
1. Mark deprecated in minor release (e.g., v1.2)
2. Console warnings in next minor (e.g., v1.3)
3. Remove in next major (e.g., v2.0)
4. Minimum 6 months deprecation period

### Feature Flags
```typescript
// Opt into experimental features
createActorSystem({
  experimental: {
    distributedActors: true,
    aiAgents: true
  }
});
```

## 🎯 Success Criteria

### Public API (v1.0)
- [ ] Core runtime <15KB gzipped
- [ ] Zero dependencies (pure TypeScript)
- [ ] 100% type coverage (no `any`)
- [ ] <100ms actor creation time
- [ ] Works in all environments (Browser, Node, Edge)

### Enterprise Features
- [ ] Each package <20KB gzipped
- [ ] Pay-for-what-you-use (tree-shakeable)
- [ ] No impact on core performance
- [ ] Separate documentation sites
- [ ] Commercial support available

## 🗺️ Migration Timeline

### From Current to v1.0

#### Stage 1: Soft Launch (Q1 2025)
- Message Plan DSL available via flag
- Both APIs work side-by-side
- Migration guide published

#### Stage 2: Default Switch (Q2 2025)
- Message Plan DSL becomes default
- Old API deprecated with warnings
- Codemods available

#### Stage 3: Cleanup (Q3 2025)
- Old API moved to `@actor-core/legacy`
- Core packages finalized
- v1.0-rc released

#### Stage 4: GA Release (Q4 2025)
- v1.0 stable release
- Enterprise packages in beta
- Full documentation

## 📚 Documentation Strategy

### Public Documentation
1. **Quick Start**: 5-minute guide with core API only
2. **Core Concepts**: Actor model, messages, behaviors
3. **API Reference**: Only exported public APIs
4. **Examples**: Common patterns and recipes
5. **Migration Guide**: From v0.x to v1.0

### Enterprise Documentation
1. **Architecture Guide**: Advanced patterns
2. **Package Guides**: One per enterprise package
3. **Case Studies**: Real-world implementations
4. **Performance Tuning**: Optimization strategies
5. **Support Portal**: Priority assistance

## 🔒 Governance

### API Design Process
1. RFC in GitHub Discussions
2. Community feedback period (2 weeks)
3. Core team review
4. Implementation in `next` branch
5. Beta testing period (4 weeks)
6. Stable release

### Breaking Change Policy
- No breaking changes in public API after v1.0
- Enterprise APIs may evolve faster
- Clear migration paths always provided
- Automated tooling for upgrades

## 🎉 Vision Statement

By v1.0, the Actor-Web Framework will bring **Erlang OTP's battle-tested reliability** to JavaScript/TypeScript. Developers will:

1. **Start simple** with familiar OTP patterns in a 15KB core
2. **Scale seamlessly** with location-transparent actors across workers and cloud
3. **Add capabilities** through focused packages (like OTP applications)
4. **Trust 30+ years** of proven telecom patterns and supervision strategies
5. **Enjoy modern DX** with TypeScript, XState, and web-native APIs

The framework will be the **OTP for the web** - bringing telecom-grade reliability to modern applications with zero learning curve for Erlang/Elixir developers. 