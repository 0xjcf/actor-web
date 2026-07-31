# Learn Actor-Web

[Open the web learning experience](https://0xjcf.github.io/actor-web/learning/) for the guide, workbook, and
interactive lab as one navigable product.

## Two products, two jobs

Actor-Web has two complementary learning products alongside the official
documentation:

| Product | Use it when you need to | Primary question |
| --- | --- | --- |
| [Actor-Web documentation](../site/index.md) | Install, configure, integrate, or look up an API | "How do I use Actor-Web?" |
| [Actor-Web learning guide](./guide/README.md) | Build the mental models behind the architecture | "Why does Actor-Web work this way?" |
| [Actor-Web workbook](./workbook/README.md) | Predict behavior, run experiments, and produce evidence | "Can I prove that I understand it?" |

The official documentation is task-oriented and reference-oriented. The
learning guide is a book: it develops ideas in dependency order and connects
them to Actor-Web internals. The workbook is practice: it turns each chapter
into predictions, failure experiments, source traces, and an exit assessment.

Interactive labs support the workbook. They are explanatory projections, not
profilers, runtime contracts, or substitutes for the source and tests.

## Who this is for

The learning path is useful for:

- JavaScript and TypeScript developers learning the actor model
- Actor-Web users who want to understand runtime behavior before designing a
  production topology
- maintainers who need a shared vocabulary for mailboxes, supervision,
  delivery, durability, policy, and reconciliation
- developers coming from Erlang, Elixir, Akka, Orleans, XState, or ordinary
  request-response services who want to compare guarantees precisely

You do not need prior Erlang, distributed-systems, or formal-methods
experience. Each chapter introduces only the prerequisites needed for the next
one.

## How a chapter works

Every completed chapter follows the same learning contract:

1. **Question** — one architectural question you should be able to answer.
2. **Model** — the smallest useful mental model and vocabulary.
3. **Mechanism** — how the underlying platform behaves.
4. **Actor-Web mapping** — where the mechanism appears in public API, source,
   and tests.
5. **Failure boundary** — what the abstraction cannot guarantee.
6. **Practice** — predictions, implementation, and failure injection in the
   workbook.
7. **Evidence** — a compact learning record you can explain without the guide.

Future chapters remain marked **planned** until their guide, workbook, and
verification material are complete. A title alone never implies that learning
content is ready.

## Course map

| Week | Topic | Status | Guide | Workbook | Lab |
| --- | --- | --- | --- | --- | --- |
| 1 | JavaScript concurrency and actor mailboxes | Available | [Read](https://0xjcf.github.io/actor-web/learning/guide/01-javascript-concurrency-and-mailboxes.html) | [Practice](https://0xjcf.github.io/actor-web/learning/workbook/01-javascript-concurrency-and-mailboxes.html) | [Open](https://0xjcf.github.io/actor-web/learning/labs/week-01-event-loop-and-mailbox.html) |
| 2 | Actor model and OTP behaviors | Planned | Course map only | Planned | Planned |
| 3 | Supervision and failure domains | Planned | Course map only | Planned | Planned |
| 4 | Behaviors, FSMs, and statecharts | Planned | Course map only | Planned | Planned |
| 5 | Distributed systems and delivery semantics | Planned | Course map only | Planned | Planned |
| 6 | Durable execution, idempotency, and reconciliation | Planned | Course map only | Planned | Planned |
| 7 | Authentication, authorization, and capabilities | Planned | Course map only | Planned | Planned |
| 8 | Facts, traces, CQRS, and projections | Planned | Course map only | Planned | Planned |
| 9 | Ports, adapters, and ecosystem authority | Planned | Course map only | Planned | Planned |
| 10 | Conformance and failure-oriented testing | Planned | Course map only | Planned | Planned |

The complete curriculum and maturity snapshot remain in the
[Actor-Web Architecture Study Guide](../actor-web-architecture-study-guide.md).

## Recommended weekly rhythm

Plan for five to seven hours:

- 90 minutes reading the guide and primary sources
- 90 minutes tracing Actor-Web source and tests
- two hours completing workbook experiments
- one hour injecting and explaining a failure
- 30 minutes completing the learning record

Use a failure-first loop throughout:

```text
predict -> observe -> explain -> break -> inspect evidence -> revise the model
```

## Maturity and authority

This learning product is non-normative. It explains current source and accepted
architectural direction, but the runtime packages, tests, conformance fixtures,
and published documentation remain authoritative for product behavior.

Every chapter must label claims as one of:

- **current** — verified in the referenced source and tests
- **accepted target** — agreed direction that is not yet a shipped guarantee
- **candidate** — implemented or proposed, but not yet published or accepted
- **deferred** — deliberately outside the current guarantee

When a chapter and current source disagree, trust the source and report the
learning-content drift.
