# Modular Package Structure Proposal

## Overview

To maintain a minimal core API while supporting advanced features, we propose restructuring the Actor-Web Framework into a modular package architecture.

## Package Structure

```
@actor-core/
├── runtime/              # Core actor runtime (minimal API)
├── virtual/             # Virtual actors & distribution
├── persistence/         # Event sourcing & storage
├── security/            # Capability-based security
├── testing/             # Testing utilities
├── monitoring/          # Metrics & observability
└── ai/                  # AI features (future)
    ├── planning/        # HTN planning
    └── memory/          # Hybrid memory system
```

## Core Runtime (`@actor-core/runtime`)

**Size Target**: ~15KB gzipped

### Exports:
```typescript
// Actor creation
export { createActorRef } from './create-actor-ref';

// Types
export type { ActorRef, ActorBehavior, ActorMessage } from './types';

// Errors
export { ActorError } from './errors';
```

### Internal (not exported):
- Phantom type utilities
- Message routers
- Internal cache implementations
- Runtime adapters

## Virtual Actors (`@actor-core/virtual`)

**When to use**: Multi-node deployments, web workers, location transparency

### Exports:
```typescript
export { createVirtualActorSystem } from './system';
export { VirtualActorRef } from './virtual-actor-ref';
export type { VirtualActorConfig, PlacementStrategy } from './types';
```

## Persistence (`@actor-core/persistence`)

**When to use**: Event sourcing, actor state persistence, audit logs

### Exports:
```typescript
export { createEventStore } from './event-store';
export { EventSourcedActor } from './event-sourced-actor';
export type { Event, EventStore, EventStoreConfig } from './types';
```

## Security (`@actor-core/security`)

**When to use**: Multi-tenant systems, capability-based access control

### Exports:
```typescript
export { createSecureActor } from './secure-actor';
export { validateCapabilities } from './capability-validator';
export type { Capability, SecurityConfig } from './types';
```

## Testing (`@actor-core/testing`)

**When to use**: Unit and integration testing of actors

### Exports:
```typescript
export { createTestActor } from './test-actor';
export { expectActorToReceive } from './expectations';
export { createMockEventStore } from './mocks';
```

## Benefits

1. **Smaller Core**: Core runtime stays minimal (~15KB)
2. **Pay-as-you-go**: Only import what you need
3. **Clear Boundaries**: Each package has a focused purpose
4. **Independent Versioning**: Advanced features can evolve separately
5. **Better Tree-shaking**: Unused features don't bloat bundles

## Migration Strategy

1. **Phase 1**: Create package structure, move code
2. **Phase 2**: Update imports in examples/tests
3. **Phase 3**: Publish individual packages
4. **Phase 4**: Deprecate monolithic exports

## Usage Example

```typescript
// Minimal usage - just core
import { createActorRef } from '@actor-core/runtime';

// With virtual actors
import { createActorRef } from '@actor-core/runtime';
import { createVirtualActorSystem } from '@actor-core/virtual';

// With persistence
import { createActorRef } from '@actor-core/runtime';
import { createEventStore } from '@actor-core/persistence';

// Kitchen sink (rare)
import { createActorRef } from '@actor-core/runtime';
import { createVirtualActorSystem } from '@actor-core/virtual';
import { createEventStore } from '@actor-core/persistence';
import { createSecureActor } from '@actor-core/security';
```

This modular approach aligns with successful actor frameworks like Akka and keeps the framework approachable while supporting advanced use cases.