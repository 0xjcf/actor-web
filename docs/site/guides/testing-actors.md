---
title: Testing actors
description: Deterministic behavior tests, asserting state and emitted events, and analyzing machines.
---

# Testing actors

Because behaviors are deterministic — pure decisions from `message` + `context`,
with I/O behind [tools](/concepts/tools) — they test without mocks of global
state. Feed a message, assert the result.

## Drive an actor and assert state

Use a local runtime and the actor's command-capable source. `ask` resolves after
the message is processed, so you can assert the next snapshot:

```ts
const runtime = await startRuntime(topology);
const counter = runtime.actors.counter.commands();

await counter.ask({ type: 'INCREMENT' });
expect(counter.snapshot().context.count).toBe(1);

await runtime.stop();
```

## Assert emitted events

Subscribe a collector actor to the events you care about:

```ts
const collector = await system.spawn(createEventCollectorBehavior());
await system.subscribe(actor, { subscriber: collector, events: ['COUNT_CHANGED'] });

await source.ask({ type: 'INCREMENT' });
// the collector's context now holds the COUNT_CHANGED event
```

## Determinism in tests

- Prefer `ask` over `send` when you need to observe the result — it resolves once
  the handler has run.
- Use the system's `flush()` to drain mailboxes when coordinating several actors.
- Keep time and randomness in tools, so tests inject fixed values instead of
  fighting real clocks.

## Analyze the machine

For machine-based actors, guard the state machine itself with
[`@actor-web/testing`](/api/testing):

```ts
import { assertNoUnreachableStates } from '@actor-web/testing';

it('compare machine has no dead states', () => {
  assertNoUnreachableStates(compareMachine, 'compare');
});
```

## See also

- [Actors & behaviors](/concepts/actors-and-behaviors) · [`@actor-web/testing`](/api/testing)
