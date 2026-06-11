---
title: Messages — send, ask, emit
description: The three ways information moves between actors, and the declarative MessagePlan.
---

# Messages: send, ask, emit

Actors only communicate by messages. There are three movements, and a handler's
return value chooses between them.

## What a handler returns

A handler returns an `ActorHandlerResult` with any of these fields:

```ts
return {
  context: nextState,                 // replace this actor's state
  reply: { ok: true },                // 1-to-1 response to an ask(...)
  emit: [{ type: 'THING_HAPPENED' }], // 1-to-many broadcast to subscribers
};
```

- **`context`** — the next state (omit to leave unchanged).
- **`reply`** — the value an `ask` caller receives.
- **`emit`** — domain events broadcast to anyone subscribed (see
  [Subscriptions & events](/concepts/subscriptions-and-events)).

## send vs ask (from the caller side)

- **`send(message)`** — fire-and-forget. No response; the fastest path.
- **`ask(message, timeout?)`** — request/response. Resolves with the handler's
  `reply` (or the new `context` when no explicit reply is given).

## Talking to *other* actors: MessagePlan

To message a peer, a handler returns a **`MessagePlan`** — a declarative
instruction (or array of them) that the runtime executes:

```ts
// point-to-point tell
{ to: pipelineRef, tell: { type: 'ADVANCE' } }

// request/response, folded back as a domain event
{ to: peerRef, ask: { type: 'QUERY' }, onOk: (r) => ({ type: 'GOT', r }) }
```

`mode` is optional and defaults to `'fireAndForget'`, the only delivery mode —
delivery is at-most-once: the message is enqueued to the target mailbox once and
never retried or acknowledged. For reliability, use the ask pattern with a
timeout or an application-level ack protocol. Because the plan is *data*, the
decision of what to send stays pure and testable; the runtime owns the I/O.

## Directed vs broadcast — when to use which

- Use **`emit`** when you're announcing a fact and don't care who listens
  (decoupled, choreography-friendly).
- Use a **`SendInstruction`** when you specifically need *this* actor to do
  *that* thing (directed, orchestration).

See [Subscriptions & events](/concepts/subscriptions-and-events) for how emitted
events reach other actors.
