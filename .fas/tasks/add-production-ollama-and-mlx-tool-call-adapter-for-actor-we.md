# Add production Ollama and MLX tool-call adapter for @actor-web/agent

## Source

Created with `fas create-task` on 2026-08-03.

## Problem

Productionize the local-model inference edge proven by Mesh Pong into a provider-neutral @actor-web/agent adapter suitable for Ollama and OpenAI-compatible MLX endpoints. Carry JSON Schema tool declarations into provider requests, normalize assistant tool calls and tool-result turns, and return bounded timeout, cancellation, malformed-output, unavailable-server, and unsupported-tool facts as data. Keep FAS workflow policy and filesystem authority outside Actor-Web. Include deterministic CI doubles plus an opt-in live local conformance lane; never persist or log provider credentials.

## Acceptance criteria

- The provider-neutral agent request contract carries JSON Schema tool definitions and structured assistant/tool-result history without importing provider SDK types into the functional core.
- A configurable OpenAI-compatible local-model adapter supports Ollama and MLX endpoints and translates structured tool calls into the existing Actor-Web agent loop.
- Malformed arguments, unsupported tools, endpoint unavailability, timeout, and cancellation return deterministic reason-coded facts instead of expected throws.
- Focused deterministic tests cover no-tool completion, one and multiple tool calls, tool results, cancellation, malformed JSON, and unavailable endpoints without requiring installed model weights.
- An opt-in live conformance command documents and verifies a locally installed Ollama or MLX model without making live inference part of CI.
- Actor-Web remains free of FAS workflow semantics; tool authorization stays with the existing runtime admission/tool-access boundary.
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

- packages/actor-agent/src
- packages/actor-agent/tests
- packages/actor-agent/README.md
- packages/actor-agent/package.json

## Scope Amendments

- Type: scope-correction
- Added at: 2026-08-03
- Trigger: Architect and staff-engineer package-layout inspection
- Reason: The generated packages/actor-agent/test path does not exist; implementation requires the real src/tests surfaces plus README and package script for the accepted opt-in live conformance criterion.
- Added paths: packages/actor-agent/src, packages/actor-agent/tests, packages/actor-agent/README.md, packages/actor-agent/package.json
- Evidence source: delegated architecture and execution handoffs
- Evidence: delegated architecture and execution handoffs | packages/actor-agent/vitest.config.ts | Tests are colocated in src and package setup/live fixtures belong under tests; README/package.json are required to expose the live command.
- Accuracy signal: git and rg confirmed the current package layout before code-writing delegation

## Implementation plan

- Write failing contract tests for additive JSON Schema tool definitions and loop passthrough.
- Write failing adapter tests for OpenAI-compatible completion, tool-call normalization, malformed output, unsupported tools, timeout, cancellation, and endpoint failures.
- Implement the provider-neutral contract extension and createOpenAiCompatibleLlmProvider without changing runtime authorization ownership.
- Add a skipped-by-default live local conformance command and document the public API, configuration, and non-goals.

## Verification plan

- Run fas tdd-red after the failing tests and before production implementation.
- Run pnpm --filter @actor-web/agent test and pnpm --filter @actor-web/agent typecheck during implementation.
- Run the opt-in live conformance command only against an explicitly configured, already-running local Ollama or MLX endpoint.
- Run fas validate-task before review and .fas/scripts/verify.sh --full at the final release-quality gate.

## Risks

- Ollama and MLX OpenAI-compatible dialects may diverge; normalize only the shared contract and return unsupported shapes as data.
- Provider-specific wire parsing must remain in the adapter and not leak into the functional loop or runtime.
- Caller-supplied credentials and headers must never be logged or persisted.

## Dependencies

- Depends on completed task-1781123183558 for the @actor-web/agent loop and provider boundary.
- Depends on completed task-1781123181914 for bounded tool timeout and cancellation behavior.
- Depends on completed task-1785250528660 for provider-neutral execution trace and receipt semantics.
- Blocks task-1785250620026 so CLI v3 FAS conformance consumes a production-capable local-model adapter.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
