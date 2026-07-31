# Week 1 Workbook: JavaScript Concurrency and Actor Mailboxes

<!-- markdownlint-disable MD060 -->

## Companion material

- [Guide Chapter 1](../guide/01-javascript-concurrency-and-mailboxes.md)
- [Interactive event-loop and mailbox lab](../labs/week-01-event-loop-and-mailbox.html)
- [Node.js event-loop guide](https://nodejs.org/learn/asynchronous-work/event-loop-timers-and-nexttick)
- [Node.js: do not block the event loop](https://nodejs.org/learn/asynchronous-work/dont-block-the-event-loop)

## Preflight

Estimated time: five to seven hours across three sessions.

You need:

- Node.js 20 or newer for the documented current timer-phase behavior
- working knowledge of functions, arrays, Promises, and `async`/`await`
- a browser for the interactive lab
- a disposable terminal for bounded timing experiments

Safety rules:

- keep every busy loop at or below 250 milliseconds
- bound recursive microtask experiments to a fixed count
- never run an infinite loop to prove starvation
- use fake messages and effects
- stop if a local machine becomes unresponsive

## Prediction sheet

Complete the prediction and confidence columns before opening the guide or
advancing the matching animation.

| Prompt | Prediction | Confidence | Observation | Revised rule |
| --- | --- | --- | --- | --- |
| What is the output order of synchronous logs, a fulfilled Promise reaction, and a zero timer? |  |  |  |  |
| Can a ready timer interrupt a running callback? |  |  |  |  |
| Where does `setImmediate(...)` run in Node? |  |  |  |  |
| What runs first when `setImmediate` and a zero timer are scheduled inside an I/O callback? |  |  |  |  |
| While actor A awaits I/O, can actor B progress in the same isolate? |  |  |  |  |
| While actor A runs synchronous CPU work, can actor B progress in the same isolate? |  |  |  |  |
| What happens to message 1001 in a full default mailbox? |  |  |  |  |
| Does one-message-at-a-time handling make `send(...)` durable? |  |  |  |  |

## Session 1: JavaScript and Node scheduling

### Lab route

Open the [interactive lab](../labs/week-01-event-loop-and-mailbox.html), choose
**JavaScript queues**, and run these scenarios in order:

1. Promise before timer
2. Blocking callback
3. Awaiting I/O yields

Before every **Next** action, say where the work token will move and which
output line will appear next.

Then choose **Node.js phases** and run:

1. I/O through poll, check, and timers
2. `nextTick`, Promise, and macrotask

### Exercise 1A: ordering by prediction

Write the expected output before running:

```js
console.log('script:start');

queueMicrotask(() => console.log('microtask:one'));

Promise.resolve().then(() => {
  console.log('promise:one');
  queueMicrotask(() => console.log('microtask:two'));
});

setTimeout(() => console.log('timer'), 0);

console.log('script:end');
```

Run it in a browser console and Node. Record:

- output order
- which lines run on the initial stack
- which callbacks are microtasks
- which callback requires a later host task
- whether multiple runs differ

### Exercise 1B: Node context changes ordering

Save this as a CommonJS file such as `ordering.cjs` and run it several times:

```js
setTimeout(() => console.log('timeout'), 0);
setImmediate(() => console.log('immediate'));
```

Then move the same pair into an I/O callback:

```js
const fs = require('node:fs');

fs.readFile(__filename, () => {
  setTimeout(() => console.log('timeout'), 0);
  setImmediate(() => console.log('immediate'));
});
```

Explain the difference using `poll`, `check`, and `timers`. Do not describe the
main-module ordering as a stable guarantee.

### Exercise 1C: bounded microtask starvation

```js
let remaining = 10_000;

function continueInMicrotask() {
  remaining -= 1;
  if (remaining > 0) queueMicrotask(continueInMicrotask);
}

setTimeout(() => console.log('timer'), 0);
queueMicrotask(continueInMicrotask);
```

Observe when the timer runs. Then answer:

1. Why does the JavaScript call stack not overflow?
2. Why can the timer still be delayed?
3. What would make the experiment unsafe?

## Session 2: cooperative scheduling and parallelism

### Exercise 2A: measure timer delay

```js
const requestedAt = performance.now();

setTimeout(() => {
  console.log({ actualDelay: performance.now() - requestedAt });
}, 25);

const blockStartedAt = performance.now();
while (performance.now() - blockStartedAt < 250) {
  // Deliberate, bounded failure injection.
}
```

Record the requested threshold and actual delay. Explain the result without
saying the timer is broken.

### Exercise 2B: blocking versus awaiting

Create two small functions:

```js
async function blockFor250Ms() {
  const until = performance.now() + 250;
  while (performance.now() < until) {
    // bounded experiment
  }
}

async function waitFor250Ms() {
  await new Promise((resolve) => setTimeout(resolve, 250));
}
```

For each function, schedule a separate zero timer before calling it. Record
whether the timer can run while the function is unfinished.

Explain the distinction:

```text
unfinished operation != JavaScript thread occupied
```

### Exercise 2C: choose the execution boundary

For each workload, choose one response and state the maximum input and latency
budget behind your decision:

- keep synchronous because work is small and bounded
- partition across event-loop turns
- use asynchronous I/O
- use a worker-thread pool
- use a separate process or remote worker
- reject or shed work before it grows

| Workload | Choice | Maximum input | Latency budget | Why |
| --- | --- | --- | --- | --- |
| Parse a 2 KB command payload |  |  |  |  |
| Hash a multi-gigabyte file |  |  |  |  |
| Wait for a database response |  |  |  |  |
| Apply 50 deterministic FSM transitions |  |  |  |  |
| Render an unbounded recursive template |  |  |  |  |

## Session 3: build and inspect a mailbox

### Exercise 3A: implement a bounded FIFO

Implement the smallest queue that satisfies this contract before reading
Actor-Web's mailbox implementation:

```ts
interface QueueStats {
  readonly size: number;
  readonly capacity: number;
  readonly totalEnqueued: number;
  readonly totalDequeued: number;
  readonly totalDropped: number;
  readonly totalFailed: number;
}

type OverflowPolicy = 'drop' | 'fail' | 'park';

interface BoundedFifo<T> {
  enqueue(value: T): boolean | Promise<boolean>;
  dequeue(): T | undefined;
  readonly stats: QueueStats;
}
```

Build in four passes:

1. A roughly 20-line FIFO with a fixed capacity and `drop`.
2. Add `fail` with an explicit error.
3. Add `park` by retaining a bounded waiter and settling it when dequeueing
   creates capacity.
4. Add the statistics without changing queue ordering.

For `park`, increment `totalEnqueued` only when the waiting value is actually
inserted into the FIFO and its Promise settles. A pending waiter is not yet an
enqueued value.

Tests to write:

- values dequeue in FIFO order
- enqueue succeeds below capacity
- `drop` returns `false` and increments `totalDropped`
- `fail` throws and increments `totalFailed`
- `park` remains pending while full and settles after a dequeue
- statistics remain unchanged while a sender is parked, then
  `totalEnqueued` increments exactly once when dequeueing admits it
- one dequeue admits at most one parked sender
- statistics remain internally consistent

Do not copy Actor-Web first. The comparison is valuable only if you encounter
the design choices yourself.

### Exercise 3B: compare with Actor-Web

Read
[`mailbox.ts`](../../../packages/actor-core-runtime/src/messaging/mailbox.ts)
and its adjacent tests. Locate:

- `MailboxConfig`
- `OverflowStrategy`
- `enqueue(...)`
- `dequeue(...)`
- `parkSender(...)`
- `tryUnparkSender(...)`
- mailbox statistics

Complete the comparison:

| Concern | Your queue | Actor-Web `BoundedMailbox` | Why the difference matters |
| --- | --- | --- | --- |
| Default capacity |  |  |  |
| Default policy |  |  |  |
| FIFO storage |  |  |  |
| Parked senders |  |  |  |
| Stop behavior |  |  |  |
| Metrics |  |  |  |
| Error representation |  |  |  |

### Exercise 3C: trace Actor-Web scheduling

Read:

1. [`actor-ref.ts`](../../../packages/actor-core-runtime/src/actor-ref.ts)
2. [`actor-system-impl.ts`](../../../packages/actor-core-runtime/src/actor-system-impl.ts)
3. [`message-delivery.test.ts`](../../../packages/actor-core-runtime/src/unit/message-delivery.test.ts)
4. [`async-messaging.test.ts`](../../../packages/actor-core-runtime/src/integration/async-messaging.test.ts)

Find and annotate:

- the public `send(...)` delegation
- the local enqueue path
- `scheduleMacrotask`
- `startMessageProcessingLoop(...)`
- `processActorMessages(...)`
- the `await` around local delivery
- the 100-message batch limit
- rescheduling when messages remain

Draw your own version of this path from memory:

```text
send -> route -> mailbox -> schedule -> dequeue -> await handler -> yield
```

Label each arrow as JavaScript, Node/browser host, Actor-Web runtime, or
application behavior.

### Exercise 3D: pressure policies in the lab

Choose **Actor-Web overlay** in the interactive lab. Run **Mailbox overflow**
three times, selecting `drop`, `fail`, and `park` before advancing.

Use capacity three and messages A through E. Record:

| Policy | A-C | D | E | Producer outcome | Stats changed |
| --- | --- | --- | --- | --- | --- |
| `drop` |  |  |  |  |  |
| `fail` |  |  |  |  |  |
| `park` |  |  |  |  |  |

Then answer: which policy would you choose for telemetry, an approval command,
and a replaceable pointer-move update? The mailbox cannot answer this for you;
state the domain reasoning.

## Failure experiment: two actors, one isolate

Place actor A and actor B in the same local Actor-Web runtime and JavaScript
isolate. Give actor A a primary work message, a `FOLLOW_UP` message, and a
`READ_STATE` request. Give actor B a fast message.

Record these completion events with timestamps:

```text
A_PRIMARY_STARTED
A_PRIMARY_DONE
A_FOLLOW_UP_DONE
B_DONE
TIMER_FIRED
CPU_RESULT
```

For every variant, use this order:

1. schedule a zero timer
2. send the primary work message to actor A
3. immediately send `FOLLOW_UP` to actor A
4. send the fast message to actor B
5. wait for all expected completion events with a fixed five-second deadline
6. if the deadline expires, record every missing event and cleanly terminate
   actors, worker threads, child processes, and outstanding timers before the
   variant fails
7. compare timestamps rather than relying on log order alone

Run these variants:

- **Synchronous CPU:** actor A performs a bounded 250-millisecond busy loop.
- **Asynchronous wait:** actor A awaits a 250-millisecond timer.
- **Worker thread:** actor A remains in the local runtime and awaits a Promise
  settled by a worker-thread result. The worker owns the CPU-heavy JavaScript.
- **Child process:** actor A remains local and awaits a correlated result from a
  separate process. Record process completion separately from actor A's
  `A_PRIMARY_DONE` event.

Complete the observation matrix:

| Work | `A_FOLLOW_UP_DONE` waits? | `B_DONE` progresses? | `TIMER_FIRED` progresses? | Parallel CPU? | Completion evidence |
| --- | --- | --- | --- | --- | --- |
| Actor A synchronous busy loop |  |  |  |  |  |
| Actor A awaits asynchronous timer |  |  |  |  |  |
| Actor A awaits worker-thread result |  |  |  |  |  |
| Actor A awaits child-process result |  |  |  |  |  |

Keep state isolation as a separate assertion from timing:

1. Confirm that actor B receives no supported public reference to actor A's
   context. An `ActorRef` can send or ask; it does not expose `actorA.context`.
2. Have actor A answer `READ_STATE` with a detached JSON-safe snapshot.
3. Let actor B mutate its local copy of that snapshot.
4. Ask actor A for state again and assert that actor A's state is unchanged.

The detached copy in step 2 is an application discipline, not automatic deep
cloning by Actor-Web. Passing shared mutable object references in local messages
would reintroduce shared-state hazards and should be recorded as a deliberate
failure of the actor boundary.

The experiment should prove both:

1. actor B cannot access actor A's private context through the supported public
   actor reference, and mutating a detached reply does not change actor A
2. state isolation does not guarantee CPU isolation inside one JavaScript
   isolate

## The 101-message fairness experiment

Use the lab's **101-message fairness batch** scenario, then reproduce the idea
with a test or trace. Separate admission evidence from processing evidence:

1. Create a direct `BoundedMailbox` fixture with capacity at least `101` and a
   non-dropping policy such as `fail`.
2. Enqueue 101 sequence-numbered no-op messages and track every enqueue result.
3. Before measuring processing, assert `totalEnqueued === 101`,
   `totalDropped === 0`, and `totalFailed === 0`.
4. In the actor-processing trace, count handled sequence numbers rather than
   treating resolved `send(...)` Promises as proof of admission. The current
   drop path can resolve without accepting the message.
5. Record the first processing round and identify the rescheduling boundary
   after message 100.
6. Record message 101 in the next processing round and assert that every
   sequence number from 1 through 101 was handled exactly once in this local
   experiment.

Explain why the boundary improves cooperative fairness but is not:

- a CPU preemption point inside a handler
- a durable checkpoint
- an acknowledgement of all 100 messages
- a business transaction

## Exit assessment

Answer without opening the guide:

1. Why does a fulfilled Promise reaction precede a later timer in the
   introductory example?
2. Why is `process.nextTick(...)` absent from Node's phase diagram?
3. What are the two jobs of the poll phase?
4. Where does `setImmediate(...)` run?
5. Why can `setImmediate` and a zero timer change order depending on context?
6. What must happen before a queued callback executes?
7. Can a ready timer interrupt an actor handler?
8. What changes when an actor handler awaits I/O?
9. What does one-message-at-a-time handling protect?
10. Which shared resource still lets one actor delay another?
11. Why does Actor-Web yield after a 100-message batch?
12. Compare `drop`, `fail`, and `park` as system-design decisions.
13. What execution boundary enables parallel CPU-intensive JavaScript?
14. Why does a mailbox not make `send(...)` durable?

### Teach-back prompt

Explain this statement to another JavaScript developer:

> Actor serialization solves ownership and ordering for one actor. Cooperative
> event-loop scheduling solves neither CPU isolation nor preemption.

Your explanation must use one code example, one Actor-Web source symbol, and one
failure observation.

## Completion evidence

Copy the [learning-record template](./learning-record-template.md) and include:

- the completed prediction sheet
- your bounded FIFO implementation and policy tests
- the blocking-versus-awaiting observation matrix
- the Actor-Web source trace
- one screenshot or written trace from each lab projection
- your exit-assessment answers
- the teach-back explanation

You are ready for Week 2 when you can trace a message from `send(...)` to the
handler and explain, without contradiction, why actor state is serialized while
the JavaScript isolate can still be starved.

Required learning-product verification:

```bash
pnpm test:learning
pnpm exec markdownlint-cli2 --config .markdownlint.jsonc \
  "docs/learning/**/*.md" \
  "docs/actor-web-architecture-study-guide.md" \
  "README.md"
pnpm test:docs
```

This repository does not expose a root `verify.sh`; do not substitute a
nonexistent command for the real project scripts above.

Supplementary focused Actor-Web runtime evidence:

```bash
pnpm --filter @actor-web/runtime exec vitest run \
  src/unit/message-delivery.test.ts \
  src/integration/async-messaging.test.ts
```

<!-- markdownlint-enable MD060 -->
