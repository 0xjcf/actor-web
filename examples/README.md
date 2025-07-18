# Actor-Web Framework Examples

## ⚠️ Migration Notice

Many examples in this directory are being updated for v2.0.0 which uses the new `@actor-core/runtime`.

### Updated Examples
- `state-machine-analysis-demo.ts` - Shows how to analyze state machines
- `actor-architecture-diagram.ts` - Demonstrates actor system architecture

### Examples Being Updated
- Component examples (`*-ui.ts` files) - Components are being redesigned for v2.0
- Coffee shop examples - Being migrated to pure actor model

### How to Run Examples

```bash
# Install dependencies
pnpm install

# Run an example
pnpm tsx examples/state-machine-analysis-demo.ts
```

### Migration Guide

See [MIGRATION.md](../MIGRATION.md) for instructions on updating examples to v2.0.

## Creating New Examples

New examples should use `@actor-core/runtime`:

```typescript
import { createActorSystem } from '@actor-core/runtime';

const system = createActorSystem({
  nodeAddress: 'example-node'
});

await system.start();

const actor = await system.spawn({
  id: 'my-actor',
  onMessage: async (message, state) => {
    console.log('Received:', message);
    return state;
  }
});

await actor.send({ 
  type: 'HELLO', 
  payload: 'World',
  timestamp: Date.now()
});
```