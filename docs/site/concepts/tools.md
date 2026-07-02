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

The toolbox exposes `has(name)`, `list()`, and
`execute(name, input, options?)`. Calling a tool the actor wasn't granted is an
error, not a silent no-op.

## Timeouts and cancellation

Use `timeoutMs` when a tool can wait on an external system:

```ts
.onMessage(async ({ message, tools }) => {
  try {
    const result = await tools.execute(
      'verification.run',
      {
        taskId: message.taskId,
        patch: message.patch,
      },
      { timeoutMs: 30_000 }
    );
    return { reply: { result } };
  } catch (error) {
    if ((error as { code?: string }).code === 'ACTOR_TOOL_TIMEOUT') {
      return { reply: { ok: false, reason: 'verification timed out' } };
    }
    throw error;
  }
});
```

Toolboxes may also be created with `defaultTimeoutMs` so actors inherit a
deadline unless a call provides its own `timeoutMs`.

Each execution receives a fresh `AbortSignal` on the tool context. Tool adapters
should pass that signal to cancellable APIs such as `fetch`, process runners, or
model clients:

```ts
const tools = {
  'verification.run': async (input, context) => {
    const response = await fetch(input.url, { signal: context.signal });
    return { ok: response.ok };
  },
};
```

When the deadline expires, `tools.execute` aborts the signal and rejects with an
`ActorToolTimeoutError` whose `code` is `ACTOR_TOOL_TIMEOUT`. Treat that timeout
as data at the actor boundary, then decide whether to retry, block, or continue.

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
