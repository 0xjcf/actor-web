# Actor-Web Workbook and Labs

## Practice is the product

The workbook turns each learning-guide chapter into observable work. Reading
creates familiarity; prediction and failure injection reveal whether the mental
model can actually explain runtime behavior.

Every workbook module uses this loop:

1. **Predict** before running code or advancing an animation.
2. **Observe** output, ordering, timing, state, and receipts.
3. **Explain** the result using the guide's vocabulary.
4. **Change one variable** and predict again.
5. **Inject a bounded failure** the abstraction should contain.
6. **Trace evidence** into Actor-Web source and tests.
7. **Record the guarantee and non-guarantee.**

## Available modules

| Week | Workbook | Interactive lab | Status |
| --- | --- | --- | --- |
| 1 | [JavaScript concurrency and actor mailboxes](./01-javascript-concurrency-and-mailboxes.md) | [Event loop and mailbox lab](../labs/week-01-event-loop-and-mailbox.html) | Available |
| 2-10 | Planned | Planned | Not yet available |

## What to record

Copy the [learning-record template](./learning-record-template.md) for each
week. Store your completed record anywhere convenient; it does not need to
enter the Actor-Web repository or the FAS evidence chain.

A useful record contains:

- one incorrect prediction and why it was wrong
- one source path and one test that changed your understanding
- the failure you reproduced
- the guarantee the abstraction provides
- the adjacent guarantee it does not provide
- one design decision you can now defend

## Safety

Failure experiments are bounded demonstrations. Do not add infinite loops,
unbounded queue growth, uncontrolled recursive microtasks, real destructive
effects, or production credentials.

The interactive labs simulate blocking and nondeterministic outcomes rather
than executing unsafe versions. When the workbook asks you to run a real busy
loop, use the stated upper bound and a disposable local process.

## Workbook module contract

New modules should follow the [workbook template](./week-template.md) and
include:

- a preflight and prediction table
- a guided interactive-lab route when visualization materially helps
- at least one implementation exercise
- at least one failure experiment
- an Actor-Web source and test trace
- an observation table
- an exit assessment with a teach-back prompt
- explicit completion evidence

Return to the [learning guide](../guide/README.md) or the
[learning-product home](../README.md).
