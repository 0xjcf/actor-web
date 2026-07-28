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

- packages/cli/src
- packages/runtime/src
- packages/agent/src
- packages/testing/src
- docs/actor-web-cli-runtime-host-design.md

## Scope Amendments

- None.

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
