---
title: Your first actor
description: Build a counter actor with defineActor and run it on a local runtime.
---

# Your first actor

We'll build the smallest useful actor — a counter — and drive it. Every code
block on this page is **type-checked against the real `@actor-web/runtime`
types** when the site builds, so what you see compiles.

## 1. Define the behavior

An actor's behavior is authored with `defineActor`. You declare the message
union it accepts, give it an initial `context`, and handle each message by
returning the next `context`.

```ts twoslash
import { defineActor } from '@actor-web/runtime';

// The messages this actor accepts.
type CounterMessage = { type: 'INCREMENT' } | { type: 'DECREMENT' };

export const counter = defineActor<CounterMessage>()
  .withContext({ count: 0 })
  .onMessage(({ message, context }) => {
    switch (message.type) {
      case 'INCREMENT':
        return { context: { count: context.count + 1 } };
      case 'DECREMENT':
        return { context: { count: context.count - 1 } };
    }
  })
  .build();
```

A few things to notice:

- The handler receives `{ message, context, actor, tools }`. Here we only need
  `message` and the current `context`.
- Returning `{ context }` replaces the actor's state — the OTP `gen_server`
  pattern. Return nothing to leave state unchanged.
- `count` is inferred as `number` from `withContext({ count: 0 })`, so
  `context.count + 1` is checked. Try changing it to a string and the build
  fails.

## 2. What a handler can return

A handler returns an `ActorHandlerResult`, any of these fields:

- `context` — replace this actor's state.
- `reply` — respond to an `ask(...)` caller (1-to-1).
- `emit` — broadcast domain events to subscribers (1-to-many). This is how
  other actors react to you — see
  [Subscriptions & events](/concepts/subscriptions-and-events).

```ts twoslash
import { defineActor } from '@actor-web/runtime';
// ---cut---
type CounterMessage = { type: 'INCREMENT' } | { type: 'DECREMENT' };

const counter = defineActor<CounterMessage>()
  .withContext({ count: 0 })
  .onMessage(({ message, context }) => {
    if (message.type === 'INCREMENT') {
      const count = context.count + 1;
      // Update state AND announce the change as a fact.
      return { context: { count }, emit: [{ type: 'COUNT_CHANGED', count }] };
    }
    return { context: { count: context.count - 1 } };
  })
  .build();
```

## Next steps

- [Subscriptions & events](/concepts/subscriptions-and-events) — let another
  actor react to `COUNT_CHANGED`.
- More to come: wiring a topology, running a local runtime, and consuming an
  actor from a UI.
