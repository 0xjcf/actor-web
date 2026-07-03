# actor-web CLI v1: @actor-web/agent package (llm tool + agent-loop) + agent hosting

## Source

Created with `fas create-task` on 2026-06-10.

## Problem

Design: docs/actor-web-cli-runtime-host-design.md (Phase v1). SEQUENCE AFTER CLI v0 (do not start until v0 lands). Introduce the dedicated @actor-web/agent package. One-way deps: cli -> agent -> runtime; the runtime carries NO LLM dependency and @actor-web/agent owns the LLM vendor SDK. Provides: an llm tool (registered in ActorToolRegistry), an agent-loop behavior (prompt -> tool-call -> observe -> repeat), and context/memory. The cli registers it only when hosting agents; toolAccess enforced per agent. Single-node multi-agent choreography via emit/subscribe (no central conductor).

## Automation admission

- Expected operator value: Improves operator leverage around "actor-web CLI v1: @actor-web/agent package (llm tool + agent-loop) + agent hosting" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- @actor-web/agent is a separate package depending on @actor-web/runtime (cli -> agent -> runtime, one-way)
- the runtime package gains no LLM dependency
- an agent behavior can run on the v0 host and call the llm tool, gated by toolAccess
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- `packages/actor-agent/package.json`
- `packages/actor-agent/tsconfig.json`
- `packages/actor-agent/vitest.config.ts`
- `packages/actor-agent/tests/setup.ts`
- `packages/actor-agent/src/index.ts`
- `packages/actor-agent/src/agent-loop.test.ts`
- `src/actor-agent-package.test.ts`
- `packages/agent-workflow-cli/package.json`
- `packages/agent-workflow-cli/tsconfig.json`
- `packages/agent-workflow-cli/vitest.config.ts`
- `packages/agent-workflow-cli/src/host/runtime-host.ts`
- `packages/agent-workflow-cli/src/host/runtime-host.test.ts`
- `package.json`
- `tsconfig.json`
- `architecture.boundaries.json`
- `docs/actor-web-cli-runtime-host-design.md`

## Scope Amendments

- 2026-07-03: Promote package and host-integration paths from generated
  unknown scope. The smallest v1 slice is a dedicated `@actor-web/agent`
  workspace package with an injected LLM-provider port, an `llm` tool
  registry helper, and a deterministic agent-loop behavior. The CLI v0 host
  gets a typed registration seam that can install those agent tools when
  hosting agent topologies; no LLM code or dependency is added to
  `@actor-web/runtime`.

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
