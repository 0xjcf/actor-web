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

- packages/cli
- .changeset
- docs
- package.json
- pnpm-lock.yaml

## Scope Amendments

- None.

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
