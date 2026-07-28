# actor-web CLI v3: FAS control-plane integration

## Source

Created with `fas create-task` on 2026-06-10.

## Problem

Promote the existing v3 design into consumer-owned conformance between a FAS control plane and the neutral Actor-Web runtime host. Prove the loop observe -> propose -> admit -> execute -> reconcile -> project -> audit: FAS supplies workflow policy, capability boundaries, and evidence interpretation; Actor-Web supplies topology, lifecycle, authorization ports, scheduling, effect receipts, reconciliation facts, and authoritative runtime state; Ignite or other consumers project read models. Actor-Web must not import FAS or Ignite, and FAS must consume a versioned adapter/fixture instead of becoming a runtime dependency.

## Acceptance criteria

- A versioned neutral fixture runs a FAS-defined workflow through authenticated admission, supervised execution, effect receipts, checkpoint/restart recovery, reconciliation, and read-model projection.
- Actor-Web packages have no FAS or Ignite runtime dependency; consumer adapters own FAS policy/evidence mappings and Ignite source bindings.
- Tool/capability boundaries rejected by FAS-supplied policy are enforced at Actor-Web command admission and visible as reason-coded audit facts.
- Conformance proves success, rejection, interruption/resume, duplicate effect suppression, stale projection detection, and operator reconciliation.
- The adapter contract, compatibility/versioning rules, local dogfood instructions, and responsibility matrix are documented and testable without provider-specific assumptions.
- TDD: a failing conformance test that captures the new or changed behavior is written before implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: keep consumer policy interpretation outside Actor-Web, keep runtime facts provider-neutral, confine effects to adapters and the imperative shell, and return facts instead of throwing.
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
- docs
- examples

## Scope Amendments

- Type: scope-refresh
- Added at: 2026-07-28
- Added paths: packages/cli/src, packages/runtime/src, packages/agent/src, packages/testing/src, docs, examples

## Implementation plan

- Define the neutral consumer adapter and conformance fixture without adding FAS or Ignite dependencies to Actor-Web packages.
- Run a representative FAS-defined workflow against CLI v2 through admission, execution, receipt, restart, reconciliation, and projection.
- Document ownership, compatibility, dogfood operation, and how other consumers implement the same ports.

## Verification plan

- Assert package dependency boundaries and consumer-owned adapter placement.
- Exercise success, rejection, interruption/resume, duplicate suppression, stale projection, and reconciliation scenarios end to end.
- Run CLI/runtime/agent/testing package tests and the repository full verification lane.

## Risks

- Embedding FAS policy vocabulary in Actor-Web would collapse the control-plane/data-plane boundary.
- Treating a projection as runtime truth would make audit and recovery unsafe.
- A happy-path-only demo would overstate autonomous readiness; interruption and reconciliation evidence are mandatory.

## Dependencies

- task-1785250582987 - recoverable distributed Actor-Web runtime host with trace and checkpoint support.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
