# actor-web CLI v2: distributed hosting (--gateway/--transport/connect)

## Source

Created with `fas create-task` on 2026-07-28.

## Problem

Promote the existing v2 design into the recoverable distributed runtime host for evidence-governed agents. Extend CLI v1 with authenticated remote operation, directory readiness distinct from transport membership, supervision and lifecycle status, checkpoint storage injection, trace/receipt streaming, graceful interruption, restart recovery, and operator diagnostics. Keep deployment topology neutral and localhost-safe by default; production exposure requires explicit authentication, transport, storage, and policy configuration.

## Acceptance criteria

- CLI can host and operate supervised actors across processes using explicit gateway and transport configuration with authenticated send, ask, watch, and status paths.
- Host readiness distinguishes process, transport, directory, checkpoint-store, and policy-admission readiness and fails closed when required dependencies are unavailable.
- A crash/restart conformance fixture rehydrates an agent session and reconciles an in-flight effect without duplicate non-idempotent execution.
- Trace and receipt streaming supports bounded backpressure, redaction, reconnect cursors, and operator-visible failure reasons.
- Localhost defaults, remote exposure safeguards, shutdown semantics, recovery runbook, and compatibility are documented and tested.
- TDD: a failing test that captures the new or changed behavior is written before implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: keep host readiness, admission, and reconciliation decisions deterministic where possible, confine network/storage/process effects to adapters and the imperative shell, and return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- docs/actor-web-cli-runtime-host-design.md
- packages/actor-agent/src
- packages/agent-workflow-cli/vitest.config.ts
- packages/agent-workflow-cli/src
- packages/actor-core-runtime/src
- .fas/memory/pr-feedback.md

## Scope Amendments

- Type: plan correction
- Added at: 2026-07-30
- Trigger: FAS architect found stale package-root aliases in the generated write envelope before implementation.
- Reason: Use the live Actor-Web package roots so the implementation and verification scope matches the repository without widening product ownership.
- Added paths: the live CLI, runtime, agent, testing, and runtime-host design-document roots recorded by the original orchestration generation
- Evidence source: fas_architect handoff
- Evidence: fas_architect handoff | .fas/state/agent-orchestration-execution.json | missingPlannedFileCount=4 for packages/cli, packages/runtime, packages/agent, and packages/testing; live roots are agent-workflow-cli, actor-core-runtime, actor-agent, and actor-core-testing.
- Accuracy signal: Confirmed by live tree and domain map before source edits.
- Follow-up needed: Refresh task scope and replan before fas_staff_engineer.

- Type: recovered-generation scope adoption
- Added at: 2026-07-30
- Trigger: The FAS runtime auto-requeued the active task after the original current-task binding disappeared during delegated SRE review.
- Reason: The recovered generation starts at `da665259`, after the agent, testing, and design-doc slices were already committed and verified. Keep those commits as authoritative task evidence while limiting the recovered change envelope to the remaining runtime and CLI fixes instead of adding artificial churn.
- Added paths: packages/agent-workflow-cli/src, packages/actor-core-runtime/src
- Evidence source: git history and prior orchestration receipts
- Evidence: `0ba48577..da665259` contains the accepted agent checkpoint, recovery fixture, distributed host, trace/receipt, tests, and design-doc work; `.fas/state/agent-orchestration-execution.json` preserves the original generation receipts.
- Accuracy signal: Current recovered-generation commits are `aec42966` and `b7dc74f8`; full PR review still covers `0ba48577..b7dc74f8`.
- Follow-up needed: Refresh task scope and replan, then reconfirm current-head full verification and review receipts.

- Type: external-review hardening
- Added at: 2026-07-30
- Trigger: Local CodeRabbit review against `main` returned correctness, security, redaction, recovery, trace-buffer, and public-surface findings after the first full gate.
- Reason: Reopen the writer lifecycle and address every justified finding before push, including fail-closed checkpoint writes, retryable recovery gates, redacted checkpoint receipts, transport authentication, trace semantics, malformed input handling, public exports, and stale roadmap statements.
- Added paths: docs/actor-web-cli-runtime-host-design.md, packages/actor-agent/src, packages/agent-workflow-cli/src, packages/actor-core-runtime/src
- Evidence source: local CodeRabbit committed-diff review
- Evidence: `coderabbit review --agent -t committed --base main -c AGENTS.md` completed with 17 findings on `488b9f94`.
- Accuracy signal: Each finding must be reproduced or inspected against current source; invalid or duplicate findings remain documented as skipped rather than implemented blindly.
- Follow-up needed: Replan, run TDD/focused verification, repeat QA/SRE/reviewer, rerun the full gate, and repeat CodeRabbit before push.

- Type: scope clarification
- Added at: 2026-07-30
- Trigger: Replacing CLI deep source imports with the public `@actor-web/runtime/node` subpath requires the CLI package's existing Vitest alias table to resolve that public workspace entrypoint.
- Reason: Add the minimal two-line node-subpath alias beside the existing runtime root and browser aliases; this keeps tests on public package boundaries instead of stale build output or forbidden source imports.
- Added paths: packages/agent-workflow-cli/vitest.config.ts
- Evidence source: focused CLI public-entrypoint red test
- Evidence: `src/index.test.ts` proves `runtime-host.ts` no longer imports `../../../actor-core-runtime/src/`; the package test runner must resolve `@actor-web/runtime/node` to the live workspace source.
- Accuracy signal: This is test-runner wiring only and does not broaden runtime product semantics.
- Follow-up needed: Refresh task scope before committing the alias.

- Type: PR babysit review memory
- Added at: 2026-07-30
- Trigger: The invoked fas-babysit workflow requires reusable PR feedback to be persisted before closeout.
- Reason: Record reusable checkpoint, trace replay, redaction, buffer, reconnect, source recovery, and public-entrypoint lessons from PR 56 without widening product ownership.
- Added paths: .fas/memory/pr-feedback.md
- Evidence source: fas-babysit review triage and local CodeRabbit committed-diff passes
- Evidence: fas-babysit review triage and local CodeRabbit committed-diff passes | .fas/memory/pr-feedback.md | Review lessons are project-local FAS memory required by the babysit workflow; product implementation remains within the existing agent, runtime, and CLI roots.
- Accuracy signal: All product changes have focused tests; the memory file contains reusable patterns only.
- Follow-up needed: Refresh scope, replan closeout artifacts, and reconfirm current-head full verification.

## Implementation plan

- Refresh the CLI v2 design against the accepted trace, command-admission, checkpoint, and directory-readiness contracts.
- Implement distributed host configuration and operator commands through existing runtime ports with secure localhost defaults.
- Add lifecycle/readiness/trace/recovery diagnostics and end-to-end restart conformance fixtures.

## Verification plan

- Test local and remote send, ask, watch, status, readiness, authentication rejection, shutdown, and reconnect paths.
- Run crash/restart plus in-flight effect reconciliation tests with a durable checkpoint adapter.
- Run packed CLI smoke tests and the repository full verification lane.

## Risks

- Distributed exposure can widen the attack surface if authentication or bind defaults are permissive.
- Readiness can lie if transport membership is conflated with directory or storage availability.
- Restart can duplicate non-idempotent effects if checkpoint and journal ordering is wrong.

## Dependencies

- task-1785250545761 - authenticated command-admission facts.
- task-1785250562339 - durable agent-session checkpoint and rehydration.
- task-1783703419711 - completed directory-readiness distinction.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
