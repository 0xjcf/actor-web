# Benchmark Mesh Pong MLX model and server strategy

## Source

Created with `fas create-task` on 2026-07-08.

## Problem

Use the telemetry and decoupled loop to evaluate model-size and server-topology choices for Mesh Pong. Compare the current Qwen3-8B-4bit setup against faster locally available or configurable MLX model options where possible, and decide whether per-player endpoints or two servers are justified. Implement only the minimal configuration, docs, and tests needed for the chosen strategy; if two servers do not improve local play, record that as an explicit deferred option.

## Acceptance criteria

- Benchmark evidence captures per-turn latency, throughput, timeout rate, and visible gameplay effect for the tested MLX setup.
- The example supports the chosen provider/server configuration without coupling Pong functional behaviors to MLX or provider internals.
- Per-side endpoint or model configuration is implemented only if the evidence shows it improves local play; otherwise the decision is documented with follow-up scope.
- The README includes recommended model/server settings and local setup commands for the validated path.
- The MLX provider config keeps API keys env/runtime-only and does not persist API keys through browser storage.
- Post-mesh claim gating remains blocked until this performance strategy is resolved.
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
- examples/mesh-pong/mesh-pong.test.ts
- examples/mesh-pong/ui/main.ts
- examples/mesh-pong/mlx-provider.ts

## Scope Amendments

- Type: scope-refresh
- Added at: implementation
- Trigger: architecture decision
- Reason: `examples/mesh-pong/mlx-provider.ts` was inspected as provider-contract context, but the accepted strategy keeps the existing single-endpoint provider configuration unchanged and defers per-side endpoint or two-server routing until live benchmark evidence justifies it.
- Reference-only paths before code-review follow-up: examples/mesh-pong/mlx-provider.ts
- Evidence source: architect and staff-engineer handoff
- Evidence: `fas_architect` and `fas_staff_engineer` both directed this task to keep `mlx-provider.ts` unchanged and add benchmark summary evidence in the browser shell plus tests.
- Accuracy signal: planner-missed

- Type: scope-refresh
- Added at: code-review
- Trigger: CodeRabbit secret-storage finding
- Reason: CodeRabbit found that the Mesh Pong README and provider allowed MLX API keys to be persisted in browser localStorage; fixing the valid security finding required updating the provider config seam, README guidance, and config test.
- Added paths: examples/mesh-pong/mlx-provider.ts
- Evidence source: CodeRabbit CLI review
- Evidence: CodeRabbit CLI review | examples/mesh-pong/mlx-provider.ts | Removed localStorage API-key resolution and kept VITE_MESH_PONG_MLX_API_KEY env/runtime-only.
- Accuracy signal: reviewer-found

- Type: scope-refresh-promotion
- Added at: code-review
- Trigger: CodeRabbit secret-storage finding
- Reason: Promote examples/mesh-pong/mlx-provider.ts back into implementation scope because fixing the valid CodeRabbit API-key localStorage finding required changing the provider config seam, not just README wording.
- Added paths: examples/mesh-pong/mlx-provider.ts
- Evidence source: CodeRabbit CLI review
- Evidence: CodeRabbit CLI review | examples/mesh-pong/mlx-provider.ts | Commit 065346d7 removed localStorage API-key resolution and kept VITE_MESH_PONG_MLX_API_KEY env/runtime-only.
- Accuracy signal: reviewer-found

## Implementation plan

- Convert the supplied context into a scoped implementation plan before editing.
- Refresh affected-file scope before implementation if the generated hints are incomplete.

## Verification plan

- Run `fas validate-task` for the inner-loop verification gate.
- Run `.fas/scripts/verify.sh --full` at the final release-quality gate when tracked files change.

## Risks

- Validate generated scope, acceptance criteria, and verification evidence before closeout to avoid workflow drift.

## Dependencies

- Depends on task-1783516431222 Decouple Mesh Pong simulation and render loop from MLX inference turns. Blocks task-1781880961715 Post-mesh scoping: membership graduation tier, cross-node supervision boundary, claim gating.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
