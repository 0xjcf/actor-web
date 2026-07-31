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

Run this CommonJS file several times:

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

```ts
async function blockFor250Ms(): Promise<void> {
  const until = performance.now() + 250;
  while (performance.now() < until) {
    // bounded experiment
  }
}

async function waitFor250Ms(): Promise<void> {
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

Tests to write:

- values dequeue in FIFO order
- enqueue succeeds below capacity
- `drop` returns `false` and increments `totalDropped`
- `fail` throws and increments `totalFailed`
- `park` remains pending while full and settles after a dequeue
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

Create actor A with a bounded 250-millisecond busy loop and actor B with a fast
handler. In this order:

1. schedule a zero timer
2. send the slow message to actor A
3. send the fast message to actor B
4. record completion times
5. replace actor A's busy loop with an awaited 250-millisecond timer
6. repeat

Complete the observation matrix:

| Work | Same actor waits? | Other actor same isolate progresses? | Timer progresses? | True CPU parallelism? |
| --- | --- | --- | --- | --- |
| Actor A synchronous busy loop |  |  |  |  |
| Actor A awaits asynchronous timer |  |  |  |  |
| CPU work in a worker thread |  |  |  |  |
| Actor on a separate process/node |  |  |  |  |

The experiment should prove both:

1. actor B never mutates actor A's private context
2. state isolation does not guarantee CPU isolation inside one JavaScript
   isolate

## The 101-message fairness experiment

Use the lab's **101-message fairness batch** scenario, then reproduce the idea
with a test or trace:

1. queue 101 bounded no-op messages for one actor
2. record the first processing round
3. identify the rescheduling boundary after message 100
4. record message 101 in the next processing round

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

Optional focused Actor-Web verification:

```bash
pnpm --filter @actor-web/runtime exec vitest run \
  src/unit/message-delivery.test.ts \
  src/integration/async-messaging.test.ts
```

<!-- markdownlint-enable MD060 -->
