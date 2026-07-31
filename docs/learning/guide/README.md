# Actor-Web Learning Guide

## What this book teaches

This guide develops Actor-Web from the runtime underneath it upward:

```text
JavaScript scheduling
  -> actors and mailboxes
  -> behaviors and state machines
  -> supervision and placement
  -> distributed delivery
  -> durable execution and reconciliation
  -> policy, facts, projections, and conformance
```

It is intentionally different from API documentation. API documentation tells
you which function to call. This guide explains the problem an abstraction
solves, the guarantee it provides, the guarantee it cannot provide, and why the
API has its current shape.

## Reading modes

Choose the route that matches your goal:

### New to actors

Read in order. Complete at least the prediction and exit-test sections in the
workbook before moving to the next chapter.

### Experienced with Erlang, Elixir, or another actor runtime

Pay special attention to the **Actor-Web is different** sections. Actor-Web
borrows actor and OTP ideas, but JavaScript scheduling, browser portability,
delivery guarantees, persistence, and fault isolation are not BEAM semantics.

### Maintaining Actor-Web

Use each chapter's source trail and failure boundary as an orientation map.
Reconfirm drift-prone implementation details before changing runtime behavior.

## Chapters

| Chapter | Architectural question | Status |
| --- | --- | --- |
| [1. JavaScript concurrency and actor mailboxes](./01-javascript-concurrency-and-mailboxes.md) | If JavaScript is single-threaded, why do we need an actor concurrency model? | Current |
| 2. Actor identity and OTP behaviors | What does an actor provide that a class with async methods does not? | Planned |
| 3. Supervision and failure domains | When is "let it crash" safer than catching an error? | Planned |
| 4. Behaviors, FSMs, and statecharts | Why should a model propose rather than choose arbitrary transitions? | Planned |
| 5. Distributed delivery | What can happen after a valid message leaves the caller? | Planned |
| 6. Durable execution | How do we resume without repeating an irreversible effect? | Planned |
| 7. Principals, policy, and capabilities | Why is discovery not authorization? | Planned |
| 8. Facts, traces, and projections | How do multiple products share truth without sharing authority? | Planned |
| 9. Ports, adapters, and ecosystem boundaries | Where should provider- and product-specific meaning live? | Planned |
| 10. Conformance and failure testing | How do we prove a guarantee across implementations? | Planned |

## Chapter contract

New chapters should follow the
[chapter template](./chapter-template.md). A chapter is complete only when it:

- defines the vocabulary before using it to justify an API
- includes at least one platform mechanism and one Actor-Web source trace
- distinguishes current behavior from targets and deferred guarantees
- shows the failure mode the abstraction is meant to contain
- links to a workbook module with observable completion evidence
- remains useful without Ignite Element, FAS, or another optional integration

Return to the [learning-product home](../README.md) or open the
[workbook](../workbook/README.md).
