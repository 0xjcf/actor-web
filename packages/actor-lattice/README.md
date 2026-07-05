# @actor-web/lattice

Artifact and dependency coordination for Actor-Web.

The lattice package models stigmergic coordination: actors declare the artifacts
they observe, and the lattice turns matching artifact facts into activation
events. Actors do not need direct references to each other.

## Install

```bash
npm install @actor-web/runtime @actor-web/lattice
```

## Public API

| Export | Use for |
| --- | --- |
| `lattice({ id, node, timeoutMs?, journal? })` | Declare a lattice actor in a topology |
| `dependsOn({ id, node, behavior, dependencies })` | Declare an actor plus serializable artifact dependencies |
| `wireLatticeRuntime(runtime, options?)` | Register dependencies, subscribe activation events, and schedule timeout checks |
| `collectLatticeActors(topology)` | Inspect lattice actors declared in a topology |
| `collectLatticeRegistrations(topology)` | Derive dependency registrations from topology metadata |
| `collectLatticeSubscriptions(topology)` | Derive event subscriptions from lattice dependencies |
| `createLatticeActor(...)` | Build a lattice actor behavior directly |
| `createEventStoreLatticeJournal(...)` | Event-store-backed journal seam for replay |

## Usage

```ts
import { dependsOn, lattice, wireLatticeRuntime } from '@actor-web/lattice';
import { defineBehavior, startRuntime } from '@actor-web/runtime';
import { defineActorWebTopology, node } from '@actor-web/runtime/topology';

const plannerBehavior = defineBehavior<{ type: 'DEPENDENCY_SATISFIED' }>()
  .withContext({ activated: false })
  .onMessage(({ message }) => {
    if (message.type === 'DEPENDENCY_SATISFIED') {
      return { context: { activated: true } };
    }
    return undefined;
  });

const topology = defineActorWebTopology({
  nodes: { local: node('local') },
  actors: {
    workspace: lattice({ id: 'workflow-lattice', node: 'local' }),
    planner: dependsOn({
      id: 'planner',
      node: 'local',
      behavior: plannerBehavior,
      dependencies: [
        {
          id: 'planner-observes-task-brief',
          lattice: 'workspace',
          requires: [{ type: 'task.brief', key: 'task-1' }],
        },
      ],
    }),
  },
});

const runtime = await startRuntime(topology);
const wiring = await wireLatticeRuntime(runtime);
```

`dependencies[].lattice` is the topology key for the lattice actor. Artifact
`key` is a separate durable coordinate, typically a task, workflow, session, or
workspace identifier. Do not derive an artifact key from the lattice actor key.

## Semantics

- Artifact publications are facts.
- Dependency registration is idempotent by dependency id.
- `mode: 'once'` activates on the first matching artifact set.
- `mode: 'everyVersion'` activates for each new matching artifact version.
- Activation timeouts re-emit activation facts through package-owned protocol
  messages; they do not change the runtime's at-most-once transport semantics.
- Replay rebuilds lattice state from journaled facts. Replay does not re-run
  external side effects.

## License

MIT
