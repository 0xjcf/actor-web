# Publish @actor-web/cli to npm (deferred until the runtime ho

## Source

Created with `fas create-task` on 2026-06-10.

## Problem

Supersedes the stale 'Publish the first npm release of @actor-web/*' task. STATUS: @actor-web/runtime and @actor-web/testing are ALREADY published at 0.1.0 (latest, public) as of 2026-06-09; the old @franchise/shared-contracts blocker was resolved by the decoupling. The ONLY remaining package is @actor-web/cli, which is currently a private stub (see docs/actor-web-cli-runtime-host-design.md) with no real command surface. DEFER publishing cli until the runtime-host v0+ gives it something worth shipping. When publishing: remove private:true; remove @actor-web/cli from .changeset/config.json ignore and decide fixed-group membership; align version (0.1.0-alpha -> match runtime/testing or its own line); ensure workspace:* deps rewrite on publish; files allowlist already present. SEQUENCE AFTER CLI v0 (at minimum).

## Automation admission

- Expected operator value: Improves operator leverage around "Publish @actor-web/cli to npm (deferred until the runtime host has a real surface)" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- @actor-web/cli is only published once it has a real command surface (v0+)
- private:true removed and the package removed from changeset ignore at publish time
- published version and changeset fixed-group membership are reconciled with runtime/testing
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

- Scope unknown.

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
