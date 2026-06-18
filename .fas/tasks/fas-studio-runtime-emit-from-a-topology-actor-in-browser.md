# [fas-studio] Runtime: emit from a topology actor in browser-

## Source

Created with `fas create-task` on 2026-06-17.

## Problem

[fas-studio] Found while shipping fas-studio Task-3 (first real consumer of topology-declared cross-actor emit/subscriptions from ignite-bound command-source actors in the browser-local single-node startRuntime).

SYMPTOM (normal operation, NOT shutdown; distinct from 'Runtime: silence system-event dead letters during startRuntime stop()' which is about the system-event-actor during stop()): a topology actor whose .withMachine() handler returns {emit:[...]} (e.g. compare ACCEPT_FORK -> {emit:[{type:'ACTIVATE',role:'engineer'},{type:'ADVANCE'}]}) DELIVERS correctly to subscribers (verified: subscriber machines transition), but the same emit path ALSO resolves the PUBLISHER's own address via directory.lookup() and fails, printing console.error('Actor not found',{path:`actor://<node>/actor/<publisherId>`}) and dead-lettering a redundant copy on EVERY cross-actor emit. Paired warning: '[AUTO_PUBLISHING] No metadata found for actor when tracking event'. ~8 console.errors per cross-actor user action; dead-letter queue grows steadily over a session.

ROOT CAUSE (installed @actor-web/runtime@0.1.0 dist): topology/ignite command-source actors are reachable via `runtime.actors.<key>.commandSource().send()` (UI sends are clean) and as subscriber mailboxes (delivery works), but are NOT registered in the directory/AutoPublishingRegistry the emit path consults for the PUBLISHER. emitEventToSubscribers (chunk-5FIVELQM.js:5351) -> enqueueMessage -> directory.lookup(publisherAddress) returns null -> log.error('Actor not found') + deadLetterQueue.add (chunk-5FIVELQM.js:4612-4617). No public StartActorWebLocalRuntimeOptions toggle (only nodes/tools/network) to suppress or register. The actor-web reference example (examples/fas-agent-loop) avoids this by coordinating cross-actor via imperative .ask()/.send() and declares no topology.subscriptions, so the declarative emit+subscriptions path is under-exercised end-to-end through a directory-backed runtime.

REPRO: a 2-actor single-node topology (defineActorWebTopology) with one subscriptions:[{from:'a',to:'b',events:['PING']}] entry; start via the browser-local startRuntime; actor a's handler returns {emit:[{type:'PING'}]}; observe b receives PING (good) AND console.error('Actor not found',{path:a}) + a dead-letter (bad).

ACCEPTANCE (must clear BOTH symptoms): after the fix, emitting cross-actor events from a topology actor in browser-local startRuntime produces (a) ZERO 'Actor not found' / zero console.error, AND (b) the dead-letter queue size stays 0 across N emits (no steady accumulation). Add a regression test asserting both against a real directory-backed local runtime (not an in-memory stub). Fix likely: register topology actors in the directory/AutoPublishingRegistry under their canonical address at startRuntime, OR skip the publisher directory lookup on the emit-to-subscribers delivery path. Downstream: fas-studio currently ships Task-3's cross-actor reaction via imperative app-state coordination as an interim and will revert to declarative emit/subscriptions once this lands (fas-studio carries a // TODO referencing this task id).

## Automation admission

- Expected operator value: Improves operator leverage around "[fas-studio] Runtime: emit from a topology actor in browser-local startRuntime logs 'Actor not found' for the publisher + dead-letters on every cross-actor emit" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- The change is verified and does not introduce regressions.
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

- src/actor-system-impl.ts
- src/auto-publishing.ts
- src/actor-web-client.ts

## Scope Amendments

- None.

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
