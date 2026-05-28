# Improve Actor-Web tool-port execution ergonomics

## Source

Created with `fas create-task` on 2026-05-28.

## Problem

Make declared Actor-Web tool ports the natural way to call product adapters from actor behaviors. Freedom Air currently demonstrates the friction: tools are declared on topology actors, but behavior closures still call product adapters directly. Improve types, examples, and docs so tools.execute is ergonomic, typed, and clearly preferred for side-effect ports.

## Acceptance criteria

- Actor behavior examples use tools.execute for website scan, snapshot store, recommendation classification, or equivalent side-effect ports instead of closure-captured adapters.
- Type inference makes declared tool names and payload/result shapes discoverable without manual app-level helper types where possible.
- Docs clarify that tool ports are the side-effect boundary and product adapters are supplied by runtime runners.
- Focused tests cover least-privilege tool access and expected error behavior for unavailable tools.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- packages/actor-core-runtime/src/actor-tools.ts
- packages/actor-core-runtime/src/actor-system.ts
- packages/actor-core-runtime/src/unified-actor-builder.ts
- packages/actor-core-runtime/src/unit
- docs/API.md
- examples/fas-agent-loop

## Scope Amendments

- Type: scope-repair
- Added at: 2026-05-28
- Trigger: typed tool execution implementation
- Reason: `defineActor()` is implemented by `unified-actor-builder.ts`, so adding `withTools<TRegistry>()` requires changing that builder even though the initial generated scope named the older create-actor surface.
- Added paths: packages/actor-core-runtime/src/unified-actor-builder.ts
- Evidence source: implementation dependency trace
- Evidence: FAS example behaviors import `defineActor` from the runtime public API; the exported implementation path is `packages/actor-core-runtime/src/unified-actor-builder.ts`.
- Accuracy signal: `pnpm typecheck` passed after adding the typed builder method.

- Type: scope-narrowing
- Added at: 2026-05-28
- Trigger: validate-task closeout readiness
- Reason: The typed toolbox change did not require edits to the legacy create-actor builder or topology descriptor validation; topology already enforces declared tool names and node runners already enforce least-privilege access.
- Removed paths: packages/actor-core-runtime/src/create-actor.ts, packages/actor-core-runtime/src/topology.ts
- Evidence source: implementation and focused tests
- Evidence: Changes landed in actor-tools, actor-system, unified-actor-builder, examples, docs, and unit tests; focused runtime tests covered topology/start/serve behavior without topology source edits.
- Accuracy signal: `fas validate-task` passed verification and reported only missing planned files for the untouched create-actor/topology paths.

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
