---
title: Using XState machines
description: Drive an actor with an XState machine and handle transitions with onTransition.
---

# Using XState machines

When an actor's lifecycle has real states and guarded transitions, back it with
an XState machine. The machine constrains *which* transitions are legal; your
`onTransition` handlers decide *what happens* when one fires.

## 1. Define the machine

```ts
import { createMachine } from 'xstate';

export const compareMachine = createMachine({
  id: 'compare',
  initial: 'comparing',
  states: {
    comparing: { on: { SELECT_FORK: 'comparing', ACCEPT_FORK: 'resolved', SEND_TO_REVIEWER: 'inReview' } },
    inReview:  { on: { APPROVE: 'resolved' } },
    resolved:  { type: 'final' },
  },
});
```

## 2. Attach it and handle transitions

```ts
import { defineBehavior } from '@actor-web/runtime';

const compare = defineBehavior<CompareEvent>()
  .withMachine(compareMachine)
  .onTransition({
    ACCEPT_FORK: ({ actor }) => ({ reply: actor.getSnapshot().value }),
    APPROVE:     ({ actor }) => ({ reply: actor.getSnapshot().value }),
  })
  .build();
```

The runtime checks the machine before running a handler: a message that isn't a
legal transition from the current state is rejected, and the handler never runs.

## Guards and rejection

Put guards in the machine. If `SELECT_FORK` isn't allowed in `inReview`, sending
it there is a no-op rejection — you don't need defensive `if` checks in handlers.

## When to prefer `withFSM`

If you only need transition constraints (no hierarchy, no XState actions), the
lightweight [`withFSM`](/concepts/state-and-machines) constraint map avoids the
XState dependency while keeping the same `onTransition` ergonomics.

## Test it

Use [`@actor-web/testing`](/api/testing) to assert a machine has no unreachable
states and to report transition coverage.
