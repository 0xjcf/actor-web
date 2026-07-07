# Mesh Pong MLX LLM controller adapter and player modes

## Source

Created with `fas create-task` on 2026-07-07.

## Problem

Follow-up from the Mesh Pong session lobby. Add a real LLM controller path for Mesh Pong using the existing @actor-web/agent/provider boundary and MLX runtime-host substrate. Support human vs MLX and MLX vs MLX modes through the same controller-slot protocol as human sessions. Do not put MLX or prompt logic in Pong functional behaviors, and do not invent Ignite-specific wrappers. If existing provider/session APIs are insufficient, scope the public contract change explicitly before implementation.

## Acceptance criteria

- One-player mode assigns one human session to one side and an MLX LLM controller to the other side.
- LLM-vs-LLM mode runs both sides through controller actors while the browser acts as an observer/control panel.
- The MLX controller emits bounded paddle-intent commands from game snapshots through Actor-Web agent/provider ports, with errors represented as data.
- The example documents and tests the supported local MLX prerequisites and provides a deterministic fake-provider path for CI.
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

- examples/mesh-pong/README.md
- examples/mesh-pong/pong-contract.ts
- examples/mesh-pong/pong-topology.ts
- examples/mesh-pong/ui/main.ts
- examples/mesh-pong/mesh-pong.test.ts
- packages/actor-agent/src/index.ts
- packages/actor-core-runtime/src/testing/provider-actor-conformance.ts

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

- Depends on task-1783452020274 Mesh Pong session lobby and human controller slots. Blocks task-1781880961715 post-mesh claim gating.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
