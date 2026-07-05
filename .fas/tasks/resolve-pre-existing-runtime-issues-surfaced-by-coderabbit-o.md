# Resolve pre-existing runtime issues surfaced by CodeRabbit on the opaque-address PR (mailbox drain, UPDATE_DEPENDENCIES

## Source

Created with `fas create-task` on 2026-06-24.

## Problem

Pre-existing / address-model-orthogonal issues surfaced by the CodeRabbit pre-MR review of the
opaque-address PR (task-1781964585809). Deferred from that task to keep its scope to the address
collapse. Each must be verified against current code, fixed with a regression test, and gated on
`verify.sh --full`.

1. **Mailbox not drained at the batch limit** — `packages/actor-core-runtime/src/actor-system-impl.ts`
   (~L1935, blame `24c28956`, pre-existing on main). When `processed >= maxMessages`, the loop logs the
   limit, marks the actor idle (`actorProcessingActive.set(address, false)`) and returns WITHOUT
   scheduling a continuation — queued mailbox messages are left undrained until the next external nudge.
   Fix: if `!mailbox.isEmpty()` and the processing loop is still owned, schedule the next batch
   (`scheduleMacrotask(() => this.processActorMessages(address, behavior))`) instead of stopping.

2. **`UPDATE_DEPENDENCIES` sender/receiver field mismatch** — `create-component.ts` (~L638) builds and
   sends `{ type: 'UPDATE_DEPENDENCIES', dependencyRefs: {...} }`, but the receiver in `component-actor.ts`
   reads `message.dependencies` (L543/826/831). The two never agree, so dependency updates are silently
   dropped. Fix: align the field name/shape on both sides (or resolve refs before dispatch). Orthogonal to
   the address change (the address-model edit on that line — `actor.address` instead of `.address.path` —
   is correct).

3. **Receive-side metrics never recorded** — `interceptors/metrics-interceptor.ts` `beforeReceive` (~L102).
   `afterProcess`/`onError` key metrics off the actor address (correct post-address-model), but
   `beforeReceive` relies on `context.metadata.actorPath`, which is not set before the interceptor chain
   runs, so receive metrics are never recorded. Fix: pass/derive the receiver address into `beforeReceive`
   (or set `actorPath` on context before the chain). The address-model `.path`→identity change itself is
   correct; this is a pre-existing metrics-architecture gap.

Provenance: surfaced by `coderabbit review --agent --base main` on branch `fas/opaque-address-string`;
triaged as out-of-scope-but-real during that task's pre-MR gate.

## Automation admission

- Expected operator value: Improves operator leverage around "Resolve pre-existing runtime issues surfaced by CodeRabbit on the opaque-address PR (mailbox drain, UPDATE_DEPENDENCIES mismatch, receive metrics)" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- batch-limit branch schedules a continuation when the mailbox is non-empty (no undrained messages); regression test
- UPDATE_DEPENDENCIES sender/receiver use the same field name+shape; dependency updates apply; regression test
- receive-side metrics are recorded (beforeReceive keys off the receiver address); regression test
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- packages/actor-core-runtime/src/actor-system-impl.ts
- packages/actor-core-runtime/src/create-component.ts
- packages/actor-core-runtime/src/component-actor.ts
- packages/actor-core-runtime/src/interceptors/metrics-interceptor.ts
- packages/actor-core-runtime/src/messaging/interceptor-chain.ts
- packages/actor-core-runtime/src/messaging/interceptors.ts

## Scope Amendments

- Type: implementation-scope
- Added at: 2026-07-05
- Trigger: receive metrics root-cause analysis
- Reason: MetricsInterceptor cannot observe actorPath until InterceptorChain preserves the initial MessageContext passed by ActorSystemImpl.
- Added paths: packages/actor-core-runtime/src/messaging/interceptor-chain.ts
- Evidence source: source-read
- Evidence: source-read | packages/actor-core-runtime/src/messaging/interceptor-chain.ts | composePipeline creates a fresh context and drops metadata from execute(initialContext).
- Accuracy signal: confirmed by source inspection
- Follow-up needed: none

- Type: implementation-scope
- Added at: 2026-07-05
- Trigger: receive metrics red test
- Reason: InterceptorChain must accept and preserve the initial MessageContext in its composed pipeline type for actorPath metadata to reach beforeReceive.
- Added paths: packages/actor-core-runtime/src/messaging/interceptors.ts
- Evidence source: focused-test
- Evidence: focused-test | packages/actor-core-runtime/src/unit/message-delivery.test.ts | MetricsInterceptor received no actor metrics and class hook invocation also lost this binding.
- Accuracy signal: red regression test
- Follow-up needed: none

## Implementation plan

- Convert the supplied context into a scoped implementation plan before editing.
- Refresh affected-file scope before implementation if the generated hints are incomplete.

## Verification plan

- Run `fas validate-task` for the inner-loop verification gate.
- Run `.fas/scripts/verify.sh --full` at the final release-quality gate when tracked files change.

## Risks

- Validate generated scope, acceptance criteria, and verification evidence before closeout to avoid workflow drift.

## Dependencies

- None known at task creation.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
