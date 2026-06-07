---
title: What is Actor-Web?
description: A pure actor model for JavaScript/TypeScript — location-transparent actors inspired by Erlang/OTP.
---

# What is Actor-Web?

Actor-Web is a **pure actor model** for JavaScript and TypeScript. You build
systems out of _actors_: isolated units of state that communicate only by
passing messages. There is no shared mutable state and no direct method calls
between actors — which removes whole classes of race conditions and makes the
same code run locally, in a worker, or across a network without changing how you
write it.

It draws directly on Erlang/OTP: behaviors, supervision, "let it crash"
recovery, and location transparency.

## The core ideas

- **Actor** — an isolated unit of computation with its own state (`context`),
  processing one message at a time.
- **Behavior** — what an actor _does_ with each message, authored with
  [`defineActor`](/getting-started/your-first-actor). A handler can update its
  own state, reply to an `ask`, emit events, or send messages to other actors.
- **Topology** — a declarative description of your system: which nodes exist,
  which actors run where, and how they are supervised
  (`defineActorWebTopology`).
- **Messages vs. events** — `send`/`ask` are directed (point-to-point); `emit`
  broadcasts a fact that any subscriber can react to. See
  [Subscriptions & events](/concepts/subscriptions-and-events).
- **Sources** — the read-model/command surfaces a UI consumes, designed to plug
  into [ignite-element](https://github.com/0xjcf/ignite-element) with no
  framework ceremony.

## Why a pure actor model

| Problem | Actor-Web's answer |
| --- | --- |
| Shared-state races | No shared state; one message at a time per actor. |
| "Where does this run?" | Topology declares placement; the API is identical local or remote. |
| Cascading failures | Supervisors isolate and restart; failures don't propagate by default. |
| UI ↔ logic coupling | Actors own logic; UIs consume read-model sources at the edge. |

## Where to next

- **[Your first actor](/getting-started/your-first-actor)** — build and run a
  counter in a few lines.
- **[Subscriptions & events](/concepts/subscriptions-and-events)** — how actors
  react to each other.

::: info Documentation in progress
This site is being built out. The Overview, Getting Started, and Concepts
sections you see here are the first slice; API reference and guides land in
subsequent docs tasks.
:::
