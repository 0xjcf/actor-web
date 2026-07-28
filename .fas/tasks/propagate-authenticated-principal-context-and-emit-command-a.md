# Propagate authenticated principal context and emit command admission facts

## Source

Created with `fas create-task` on 2026-07-28.

## Problem

Gateway authentication already resolves an auth context, but send and ask do not carry a uniform principal, capability, policy, and admission record through local and remote command paths. Introduce a credential-free principal context and deterministic command-admission decision at the runtime boundary, then emit accepted or rejected facts into the provider-neutral trace contract. Preserve local ergonomics, prevent bypass through alternate ingress paths, and keep authorization policy supplied through neutral Actor-Web ports rather than FAS-specific rules.

## Acceptance criteria

- Every external send, ask, gateway, CLI, and remote-client command path reaches one command-admission seam with the same principal, capability request, target, command id, and policy-version shape.
- Accepted and rejected decisions emit durable, reason-coded trace facts; raw credentials and secrets never enter actor messages, logs, snapshots, or projections.
- Local and system-internal messages have explicit principals and bypass rules that cannot be confused with unauthenticated external commands.
- Tests prove allowed, denied, expired, malformed, duplicate, local, remote, ask, and send paths plus policy-adapter failure behavior.
- Compatibility and migration for existing gateway auth hooks and clients is versioned and documented.
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

- packages/runtime/src
- packages/testing/src
- packages/cli/src
- docs

## Scope Amendments

- None.

## Implementation plan

- Inventory local, gateway, remote-client, CLI, send, and ask ingress paths and define the credential-free principal/capability context shared by all of them.
- Introduce one neutral admission port and thread its decision facts through the accepted trace contract without putting raw credentials in actor messages.
- Migrate adapters compatibly, close bypass paths, and document internal/system principal semantics.

## Verification plan

- Test allowed, denied, expired, malformed, duplicate, local, remote, send, ask, gateway, CLI, and policy-adapter failure cases.
- Assert redaction and prove raw credentials never reach messages, snapshots, logs, receipts, or projections.
- Run runtime, CLI, testing, gateway integration, boundary, and full verification lanes.

## Risks

- Parallel ingress paths can accidentally bypass admission if the seam is applied only at the gateway.
- Principal context can become a credential leak if authentication material is not reduced before runtime propagation.
- Changing send/ask contracts without compatibility staging can break existing consumers.

## Dependencies

- task-1785250528660 - provider-neutral execution trace and admission-decision fact contract.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
