---
title: Tools
description: Declared effects, the functional core / imperative shell boundary, and per-actor allowlists.
---

# Tools

Actors are deterministic: a behavior must not reach out to the network, the
clock, the filesystem, or a database directly. All of that — every effect — goes
through a **tool**. Tools are the actor model's version of dependency injection,
and they keep the **functional core** pure while the **imperative shell** owns
I/O.

## Using a tool

A behavior's handler receives a `tools` toolbox scoped to what the actor is
allowed to use:

```ts
.onMessage(async ({ message, tools }) => {
  const result = await tools.execute('verification.run', {
    taskId: message.taskId,
    patch: message.patch,
  });
  return { reply: { result } };
});
```

The toolbox exposes `has(name)`, `list()`, and `execute(name, input)`. Calling a
tool the actor wasn't granted is an error, not a silent no-op.

## Declaring tools

Tools are declared on the topology and granted to actors via an allowlist:

```ts
defineActorWebTopology({
  tools: [tool('repo.diff'), tool('verification.run')],
  actors: {
    verifier: actor({
      id: 'verifier',
      node: 'local',
      behavior: createVerifier,
      tools: ['repo.diff', 'verification.run'], // least privilege
    }),
  },
});
```

Each actor sees only its granted tools — least privilege by construction.

## Functional core / imperative shell

| Layer | Responsibility |
| --- | --- |
| Functional core | Pure decisions from `message` + `context`. No I/O, no clock. |
| Imperative shell | Coordination, lifecycle, wiring. |
| Adapters (tools) | The actual I/O. Return **facts**, don't throw expected errors. |

Because effects are injected and adapters return facts, behaviors are
deterministic and testable: feed a message and a context, assert the result — no
network, no mocks of global state.
