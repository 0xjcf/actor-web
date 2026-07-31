# Chapter 1: JavaScript Concurrency and Actor Mailboxes

## The question

> If JavaScript executes one stack at a time, why do we still need an actor
> concurrency model?

Because "one JavaScript stack" and "one owner of mutable state" are different
guarantees.

The JavaScript runtime decides when callbacks receive execution time. An actor
runtime decides which identity owns state, how messages wait for that identity,
how one message is selected, and what happens when demand exceeds capacity.
Actor-Web relies on JavaScript scheduling; it does not replace it.

## Why this chapter comes first

Every later Actor-Web guarantee runs on top of a host scheduler. Before studying
supervision, distribution, durable execution, or agent authorization, you need
to be able to distinguish:

- work that is waiting from JavaScript that is executing
- concurrent operations from parallel JavaScript execution
- a host callback queue from an actor mailbox
- serialized state mutation from fair CPU scheduling
- asynchronous waiting from synchronous blocking

Without those distinctions, it is easy to attribute VM-level guarantees to an
application-level actor library.

## Outcomes

After this chapter, you can:

- predict the order of synchronous code, Promise reactions, Node
  `process.nextTick(...)`, timers, and `setImmediate(...)` in bounded examples
- explain the purpose of the Node.js timers, pending-callbacks, poll, check, and
  close-callbacks phases
- explain why a timer threshold is not an execution deadline
- distinguish concurrency, cooperative scheduling, and CPU parallelism
- trace a local Actor-Web `send(...)` through mailbox scheduling and handling
- explain `drop`, `fail`, and `park` as different pressure decisions
- state exactly what one-message-at-a-time handling protects
- explain why a long actor handler can still starve unrelated actors

## Four layers, four different questions

Use this ladder instead of one overloaded "event loop" diagram:

| Layer | Owns | Question it answers |
| --- | --- | --- |
| JavaScript execution | The current call stack and language jobs | What JavaScript is executing now? |
| Host scheduling | Timers, I/O readiness, phase queues, and task selection | Which callback can receive a turn next? |
| Actor-Web runtime | Actor identity, mailbox, routing, processing rounds, and pressure | Which message may this actor handle next? |
| Application behavior | Domain context, valid transitions, and effects | What should this message mean in the current state? |

The layers interact, but none substitutes for the layer above or below it.

## Vocabulary

| Term | Meaning in this chapter | Important boundary |
| --- | --- | --- |
| Call stack | The JavaScript frames executing synchronously now | A queued callback cannot interrupt it |
| Task or macrotask | A host-scheduled unit such as a script, timer callback, or `setImmediate` callback | Exact sources and ordering differ by host |
| Microtask | A language/runtime job such as a Promise reaction | Microtasks run before the host selects a later macrotask |
| `nextTick` queue | Node-specific callbacks processed after the current operation | It is not a libuv event-loop phase |
| Event-loop phase | A Node/libuv stage with a class of callbacks or I/O work | It is host scheduling, not actor scheduling |
| Concurrency | Multiple operations are in progress over overlapping time | It does not require simultaneous JavaScript execution |
| Parallelism | Work executes simultaneously on multiple CPU execution resources | Requires workers, processes, or another parallel runtime |
| Cooperative scheduling | Running JavaScript must return control to the host or cross a host scheduling boundary before host work progresses | Awaiting an already-settled Promise can continue through microtasks and still delay timers or I/O |
| Actor mailbox | A queue of messages addressed to one actor identity | It is not a Node phase queue or automatically durable |
| Backpressure | The producer is made to wait or reduce demand | Actor-Web's `park` policy is the direct example here |
| Load shedding | Excess work is deliberately discarded | Actor-Web's `drop` policy is the direct example here |

## Model 1: run to completion

JavaScript executes the current stack synchronously. A callback waiting
elsewhere cannot preempt it.

```js
console.log('A');

setTimeout(() => console.log('timer'), 0);

Promise.resolve().then(() => console.log('promise'));

console.log('B');
```

For the introductory browser-style model, the output is:

```text
A
B
promise
timer
```

The initial script owns the stack until it returns. The fulfilled Promise
reaction waits in the microtask queue. The zero-millisecond timer becomes
eligible for a later task; zero does not mean immediate and does not reserve CPU
time.

This model is deliberately smaller than Node.js. It is useful because it
isolates the language-level relationship between the current stack,
microtasks, and later host callbacks.

## Model 2: the Node.js phase loop

Node.js adds host-specific structure. Its current simplified phase model is:

```text
startup-compatible timers
          |
          v
pending callbacks
          |
          v
idle, prepare (internal)
          |
          v         incoming connections and data
        poll <----------------------------------+
          |
          v
        check          setImmediate callbacks
          |
          v
close callbacks
          |
          v
        timers         setTimeout and setInterval callbacks
          |
          +--------------------> next iteration
```

The essential phases are:

- **pending callbacks** executes selected I/O callbacks deferred from the
  previous iteration
- **idle, prepare** is internal runtime machinery
- **poll** waits for and processes most I/O events
- **check** runs `setImmediate(...)` callbacks
- **close callbacks** runs callbacks such as abrupt socket close handling
- **timers** runs eligible `setTimeout(...)` and `setInterval(...)` callbacks

Starting with Node 20's libuv version, timers normally run after poll in an
iteration. A compatibility timer pass can still occur before entering the loop.
This detail is one reason a learning diagram should identify the Node version
and remain a projection rather than claiming to be an exact execution trace.

Read the current primary source before relying on a phase detail:

- [Node.js event loop, timers, and `nextTick`](https://nodejs.org/learn/asynchronous-work/event-loop-timers-and-nexttick)
- [Node.js `setImmediate(...)`](https://nodejs.org/learn/asynchronous-work/understanding-setimmediate)

### `nextTick` and Promise jobs are checkpoints, not phases

The official phase diagram intentionally omits `process.nextTick(...)` because
the `nextTick` queue is processed after the current operation rather than as a
libuv phase. Promise reactions use the Promise microtask queue.

For the bounded CommonJS examples in Node's learning material, reason in this
order after the current operation:

```text
current JavaScript operation completes
  -> process.nextTick queue
  -> Promise microtask queue
  -> later macrotask / event-loop callback
```

Do not turn this into an unqualified global ordering rule. ES modules begin in
an asynchronous context, callbacks can schedule more jobs, and timer versus
`setImmediate` ordering depends on where the calls were made.

### `setImmediate` versus `setTimeout(0)`

When both are scheduled from the main module, their relative ordering can vary.
When both are scheduled inside an I/O callback, Node reaches the check phase
before the next timer opportunity, so `setImmediate(...)` runs first.

That contextual behavior matters to Actor-Web because its normal scheduler uses
`setImmediate(...)` when the host provides it.

## Model 3: concurrency is not parallel JavaScript

One JavaScript isolate can coordinate many operations that are simultaneously
in progress:

- a network request can wait in the operating system
- a filesystem operation can run through libuv's worker pool
- a timer threshold can elapse
- several actor mailboxes can contain messages

The JavaScript callbacks that react to those operations still need turns on the
isolate's thread.

```js
setTimeout(() => console.log('timer finally ran'), 0);

const startedAt = performance.now();
while (performance.now() - startedAt < 250) {
  // The timer may be ready, but JavaScript cannot run its callback yet.
}
```

Node's rule of thumb is to keep each callback's work small. A long callback
prevents other clients and callbacks on the event-loop thread from getting a
turn. See [Do not block the event loop](https://nodejs.org/learn/asynchronous-work/dont-block-the-event-loop).

For CPU-intensive JavaScript that must run in parallel, use a worker-thread
pool, a separate process, or another execution boundary. Node's
[`worker_threads` documentation](https://nodejs.org/api/worker_threads.html)
distinguishes CPU-intensive JavaScript from the asynchronous I/O that Node can
already handle efficiently.

## Model 4: an actor mailbox is a different queue

The event loop schedules callbacks for an isolate. An Actor-Web mailbox queues
messages for one actor identity.

| Host scheduler concern | Actor mailbox concern |
| --- | --- |
| When can this callback receive a turn? | Which message may this actor handle next? |
| Coordinates timers, I/O, microtasks, and phase callbacks | Coordinates messages addressed to one actor |
| A long callback delays the isolate | A full mailbox applies an actor pressure policy |
| Knows nothing about actor identity | Scopes sequencing and statistics to one actor |
| Does not provide domain ordering | Preserves local FIFO dequeueing without creating global order |

Actor serialization gives a state-ownership rule:

> Actor-Web does not dequeue the next message for an actor until the current
> delivery has settled.

That prevents overlapping handling of two messages against the same actor
context. It does not make the JavaScript callback preemptible.

## Synchronous work versus `await`

These handlers are both sequential from the actor's perspective, but they treat
the host scheduler differently.

```ts
async function cpuHeavyHandler(): Promise<void> {
  const until = performance.now() + 250;
  while (performance.now() < until) {
    // Synchronous work blocks every callback on this isolate.
  }
}
```

```ts
async function ioHandler(): Promise<void> {
  const result = await readFromNetwork();
  consume(result);
}
```

While `ioHandler` is awaiting, the host can run other callbacks. Actor-Web still
waits for that delivery before taking the same actor's next message. Therefore:

- the same actor remains logically serialized
- other actors can progress while the awaited operation is pending
- synchronous work before or after the `await` can still block the isolate
- `await` does not automatically move CPU work to another thread

## Trace a local Actor-Web message

Read these files in order:

1. [`actor-ref.ts`](../../../packages/actor-core-runtime/src/actor-ref.ts)
2. [`actor-system-impl.ts`](../../../packages/actor-core-runtime/src/actor-system-impl.ts)
3. [`mailbox.ts`](../../../packages/actor-core-runtime/src/messaging/mailbox.ts)
4. [`message-delivery.test.ts`](../../../packages/actor-core-runtime/src/unit/message-delivery.test.ts)
5. [`async-messaging.test.ts`](../../../packages/actor-core-runtime/src/integration/async-messaging.test.ts)

The current normal local path is:

```text
ActorRef.send(message)
  -> actor system resolves the actor address
  -> message enters that actor's BoundedMailbox
  -> runtime schedules processActorMessages on a future macrotask
  -> Node uses setImmediate; other hosts fall back to setTimeout(0)
  -> runtime dequeues and awaits one delivery at a time
  -> after at most 100 messages, remaining work is scheduled for another turn
```

The scheduler is implemented by `scheduleMacrotask` in
[`actor-system-impl.ts`](../../../packages/actor-core-runtime/src/actor-system-impl.ts).
The same file contains `startMessageProcessingLoop(...)`,
`processActorMessages(...)`, and the 100-message safety limit.

On Node, `setImmediate(...)` places the processing callback in the check phase.
On a host without `setImmediate`, the timer fallback reaches the host's timer or
task mechanism. The mailbox itself remains outside both mechanisms.

### Why the 100-message batch exists

One processing callback can handle up to 100 available messages. If more
remain, Actor-Web schedules another macrotask.

This is a cooperative fairness valve:

- it prevents one continuously non-empty mailbox from retaining the same
  processing round forever
- it gives the host a scheduling boundary at which other callbacks can run
- it does not interrupt one slow handler
- it is not a transaction boundary, acknowledgement, retry, or durability
  guarantee

## Capacity and pressure policy

The current default `BoundedMailbox` has:

- capacity `1000`
- overflow strategy `drop`
- metrics enabled
- FIFO dequeueing within the mailbox

The three policies express different producer/consumer relationships:

| Policy | Full-mailbox behavior | System design meaning |
| --- | --- | --- |
| `drop` | Reject the new enqueue and increment `totalDropped` | Shed excess work to protect bounded memory |
| `fail` | Raise an explicit mailbox failure and increment `totalFailed` | Force the caller/runtime to handle overload as an error |
| `park` | Return a Promise that settles when dequeueing creates capacity | Apply backpressure by making the producer wait |

The mailbox exposes:

```text
size
capacity
totalEnqueued
totalDequeued
totalDropped
totalFailed
utilizationRatio
```

These are runtime pressure facts. They do not determine which domain command is
safe to drop. Choosing a pressure policy still requires application judgment.

## Actor-Web and Erlang/Elixir

The resemblance is real:

- actors/processes own isolated state
- messages wait in per-identity mailboxes
- behavior is separated from runtime machinery
- supervision makes recovery policy explicit

The scheduling guarantee differs. The BEAM uses multiple scheduler threads and
time-slices lightweight Erlang processes. Actor-Web runs behavior handlers as
JavaScript callbacks on the host isolate. Actor-Web can yield between processing
rounds and across awaited operations, but it cannot preempt arbitrary
synchronous JavaScript inside a handler.

The useful conclusion is not that one runtime is "more actor-like." It is that
the same actor vocabulary sits on different execution substrates and therefore
provides different fault-isolation and fairness guarantees.

## Failure boundary

After reading this chapter, none of these claims are justified:

- Actor-Web actors are BEAM processes.
- A mailbox makes CPU-heavy JavaScript preemptible.
- `await` moves JavaScript computation to another thread.
- A Promise callback always precedes every possible Node callback.
- A zero-millisecond timer runs immediately.
- FIFO within one actor creates global ordering across actors or nodes.
- `send(...)` is durable, acknowledged, or retried.
- A 100-message processing batch is a business transaction.
- A bounded mailbox can decide the product meaning of lost work.

## Maturity ledger

| Claim | Maturity | Evidence |
| --- | --- | --- |
| Actor-Web has a bounded local mailbox with `drop`, `fail`, and `park` | current | `messaging/mailbox.ts` and focused mailbox tests |
| Normal actor processing uses `setImmediate` or a timer fallback | current | `scheduleMacrotask` in `actor-system-impl.ts` |
| One actor delivery is awaited before its next message is dequeued | current | `processActorMessages(...)` |
| Processing yields after at most 100 messages when more remain | current | `processActorMessages(...)` |
| Ordinary send is a durable inbox protocol | deferred | No general transactional mailbox, state, inbox, and outbox guarantee |
| Actor-Web provides BEAM-style preemptive scheduling | deferred | JavaScript host scheduling remains authoritative; VM-level preemption is a non-goal |

## Answer the question

JavaScript's one-stack-at-a-time rule prevents two JavaScript frames from
executing simultaneously in one isolate, but it does not create actor identity,
state ownership, per-actor queues, capacity policy, remote addressing, or
supervision. Actor-Web supplies those application/runtime semantics.

The actor model prevents overlapping mutation of one actor's context by
serializing that actor's messages. It does not prevent event-loop starvation,
because the selected handler still runs as cooperatively scheduled JavaScript.
Fairness depends on short synchronous work, awaited I/O, bounded processing
rounds, and explicit parallel execution boundaries for CPU-heavy work.

## Continue in the workbook

Complete the
[Week 1 workbook](../workbook/01-javascript-concurrency-and-mailboxes.md) and
use the [interactive lab](../labs/week-01-event-loop-and-mailbox.html) to test
each layer of the model.
