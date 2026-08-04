# Publish @actor-web/cli after evidence-governed runtime-host conformance

## Source

Created with `fas create-task` on 2026-07-28.

## Problem

The CLI now has v0/v1 implementation, so the remaining publication gate is no longer wait for any real surface. Publish only after the evidence-governed v2 distributed host and v3 FAS control-plane conformance are complete. The release must expose a coherent, recoverable operator surface for authenticated command admission, trace/receipt inspection, checkpoint-backed resume, readiness, reconciliation, and neutral consumer adapters. Keep publication terminal and human-approved; do not let package release become a prerequisite for implementing the runtime contract.

## Automation admission

- Expected operator value: Improves operator leverage around "Publish @actor-web/cli after evidence-governed runtime-host conformance" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- CLI v2 and v3 queue prerequisites are complete with current verification and review receipts.
- Package metadata, public exports, version policy, Changesets configuration, workspace dependency rewriting, files allowlist, license, provenance, and npm access are release-ready.
- Packed-artifact smoke tests install and exercise local serve, authenticated remote operation, status/readiness, trace watch, checkpoint resume, and graceful shutdown outside the monorepo.
- Documentation states security defaults, compatibility, recovery, FAS adapter ownership, and which behaviors remain experimental.
- Publication requires explicit final human approval and follows the Actor-Web release skill; no automatic merge or npm publish is introduced by this task.
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

- .changeset
- docs
- packages/agent-workflow-cli
- packages/actor-core-runtime/src/pure-xstate-utilities.ts
- packages/actor-core-runtime/src/unit/correlation-manager.test.ts
- packages/actor-core-runtime/src/actor-system-impl.ts
- packages/actor-core-runtime/src/unit/actor-system-lifecycle.test.ts

## Scope Amendments

- Type: path-correction
- Added at: 2026-08-03T20:58:38.511Z
- Trigger: Release-readiness audit found the real @actor-web/cli package path differs from the stale brief path.
- Reason: Authorize package metadata, README, build hygiene, and packed-consumer tests in the actual CLI package.
- Added paths: packages/agent-workflow-cli
- Evidence source: live repository inspection
- Evidence: live repository inspection | packages/agent-workflow-cli/package.json | packages/cli does not exist; packages/agent-workflow-cli declares name @actor-web/cli.
- Accuracy signal: high
- Follow-up needed: Regenerate planning and delegated write envelopes before implementation.

- Type: release-blocking runtime cleanup correction
- Added at: 2026-08-03T21:56:00Z
- Trigger: Privileged packed-consumer smoke completed authenticated remote commands but the process stayed alive after remote.stop and server.stop.
- Reason: Resolved correlation requests delete pending entries without cancelling their PureXStateTimeoutManager actors, leaving one live timeout per completed ask and preventing clean consumer process exit.
- Added paths: packages/actor-core-runtime/src/pure-xstate-utilities.ts, packages/actor-core-runtime/src/unit/correlation-manager.test.ts
- Evidence source: root privileged packed-consumer active-resource diagnostic
- Evidence: root privileged packed-consumer active-resource diagnostic | packages/actor-core-runtime/src/pure-xstate-utilities.ts | async_hooks showed six persistent XState scheduler Timeout resources for six completed asks after both hosts stopped; isolated PureXStateTimeoutManager cancellation succeeds, localizing the gap to PureXStateCorrelationManager response/error settlement.
- Accuracy signal: high: repeated privileged reproduction plus timer creation stacks
- Follow-up needed: Add active regression for timeout cancellation on response/error, track timeout ids per correlation request, rerun packed consumer without forced process exit, and include runtime patch release note.

- Type: release-blocking dead-letter lifecycle correction
- Added at: 2026-08-03T22:10:50Z
- Trigger: Privileged packed-consumer async_hooks diagnostic isolated the final 60-second XState timer after both runtime hosts stopped.
- Reason: ActorSystemImpl constructs a DeadLetterQueue with a cleanup interval but stopSystem never stops that queue, preventing natural process exit.
- Added paths: packages/actor-core-runtime/src/actor-system-impl.ts, packages/actor-core-runtime/src/unit/actor-system-lifecycle.test.ts
- Evidence source: root privileged packed-consumer async_hooks diagnostic
- Evidence: root privileged packed-consumer async_hooks diagnostic | packages/actor-core-runtime/src/actor-system-impl.ts | The only surviving timer had delay 60000 and an XState scheduler stack; DistributedActorDirectory cleanup stopped its intervals, while DeadLetterQueue.stop was never invoked from ActorSystemImpl.stopSystem.
- Accuracy signal: high: repeated privileged reproduction, exact delay match, and lifecycle call-site inspection
- Follow-up needed: Add a failing lifecycle regression, stop DeadLetterQueue during system shutdown, rerun focused runtime verification, and prove the packed CLI smoke exits naturally.

- Type: closeout scope reconciliation
- Added at: 2026-08-03T22:50:00Z
- Trigger: Current closeout readiness reported three missing planned paths after implementation and full verification completed.
- Reason: Remove obsolete discovery placeholders that were not required by the release implementation: packages/cli does not exist, and the root package.json and pnpm-lock.yaml required no changes.
- Removed paths: packages/cli, package.json, pnpm-lock.yaml
- Evidence source: current ChangeSet, package manifests, and stable release dry-run
- Evidence: packages/agent-workflow-cli/package.json is the actual @actor-web/cli manifest; Changesets rewrote workspace dependencies in the temporary versioned worktree without root manifest or lockfile edits.
- Accuracy signal: high
- Follow-up needed: Replan and refresh closeout readiness so the execution envelope reflects the implemented release surface.

## Implementation plan

- Refresh the release surface and Changesets/package metadata after v3 conformance lands.
- Run packed-artifact and clean-consumer smoke tests against the actual tarball.
- Complete release review, obtain final human approval, publish, and verify registry/install health.

## Verification plan

- Run the repository full verification lane and package-specific CLI tests.
- Run npm pack and install the tarball into a clean temporary consumer.
- Verify public registry metadata and a post-publish install/smoke only after approval.

## Risks

- Publishing an incomplete security or recovery contract would make unstable behavior public.
- Workspace-only tests can hide missing files or dependency rewrite failures; packed-artifact tests are mandatory.
- Release credentials and npm publication remain explicit human-controlled external actions.

## Dependencies

- task-1781123183558 - completed CLI v1 agent hosting foundation.
- task-1781273347595 - completed 0.2 release/package facade foundation.
- task-1785250620026 - evidence-governed FAS control-plane conformance; terminal prerequisite.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
