# Implement @actor-web/lattice: LatticeActor, topology lattice()/dependsOn, activation protocol

## Source

Created with `fas create-task` on 2026-06-12.

## Problem

RELEASE FEATURE (decided 2026-06-12: lattice ships in the official release — it is the differentiator vs other actor libraries and the foundation for fas-studio multi-agent coordination). Implements the contract locked by the lattice design doc task (must complete first). Scope per spike direct-1781143982247 and .fas/artifacts/stigmergic-lattice-spike/analysis.md: LatticeActor behavior (artifact store: typed/keyed/versioned, latest-per-key head, content-hash idempotent re-publish; dependency registrations; activation state machine pending->delivered->acknowledged with activationId idempotency and timeout re-emit via pure XState timers), protocol messages (PUBLISH_ARTIFACT, REGISTER_DEPENDENCY, WITHDRAW_DEPENDENCY, ACK_ACTIVATION, QUERY_ARTIFACTS in; ARTIFACT_PUBLISHED, DEPENDENCY_SATISFIED, ACTIVATION_TIMED_OUT out), topology surface (lattice() helper analogous to supervisor(); per-actor dependsOn with serializable matchers — no closures; once vs everyVersion modes), runtime wiring of registrations on node start (same durability pattern as declarative subscriptions), in-memory journal first behind an interface shaped per the event-sourcing decision task. Packaging: separate entry point/package (@actor-web/lattice or @actor-web/runtime/lattice) built ONLY on public primitives — building it without touching core is the test of the framework's extensibility. Pure satisfaction evaluation in the deterministic layer; journal I/O in the execution boundary.

## Acceptance criteria

- The new functionality works as described.
- Existing behavior is not broken.
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

- packages/actor-lattice/package.json
- packages/actor-lattice/tsconfig.json
- packages/actor-lattice/vitest.config.ts
- packages/actor-lattice/src/index.ts
- packages/actor-lattice/src/protocol.ts
- packages/actor-lattice/src/artifact.ts
- packages/actor-lattice/src/dependency.ts
- packages/actor-lattice/src/lattice-actor.ts
- packages/actor-lattice/src/topology.ts
- packages/actor-lattice/src/runtime.ts
- packages/actor-lattice/src/unit/lattice-artifact.test.ts
- packages/actor-lattice/src/unit/lattice-dependency.test.ts
- packages/actor-lattice/src/unit/lattice-activation.test.ts
- packages/actor-lattice/src/unit/lattice-topology.test.ts
- packages/actor-lattice/src/unit/lattice-journal.test.ts
- packages/actor-core-runtime/src/event-sourcing-entry.ts
- packages/actor-core-runtime/package.json
- package.json
- tsconfig.json
- docs/actor-web-lattice-contract-design.md
- .fas-config.json

## Scope Amendments

- Type: scope-expansion
- Added at: 2026-07-03T21:15:00.000Z
- Trigger: Architect and staff handoffs found generated single-file scope under-scoped for @actor-web/lattice implementation.
- Reason: Implement lattice as optional @actor-web/lattice package with only a narrow @actor-web/runtime/event-sourcing subpath export; keep core runtime host/topology files reference-only unless compiler forces a minimal type gap.
- Added paths: packages/actor-lattice/package.json, packages/actor-lattice/tsconfig.json, packages/actor-lattice/vitest.config.ts, packages/actor-lattice/src/index.ts, packages/actor-lattice/src/protocol.ts, packages/actor-lattice/src/artifact.ts, packages/actor-lattice/src/dependency.ts, packages/actor-lattice/src/lattice-actor.ts, packages/actor-lattice/src/topology.ts, packages/actor-lattice/src/runtime.ts, packages/actor-lattice/src/unit/lattice-artifact.test.ts, packages/actor-lattice/src/unit/lattice-dependency.test.ts, packages/actor-lattice/src/unit/lattice-activation.test.ts, packages/actor-lattice/src/unit/lattice-topology.test.ts, packages/actor-lattice/src/unit/lattice-journal.test.ts, packages/actor-core-runtime/src/event-sourcing-entry.ts, packages/actor-core-runtime/package.json, package.json, tsconfig.json
- Evidence source: fas_architect and fas_staff_engineer delegated handoffs
- Evidence: fas_architect and fas_staff_engineer delegated handoffs | .fas/state/agent-orchestration-execution.json | Promote packages/actor-lattice package files, root build/type wiring, and packages/actor-core-runtime event-sourcing subpath export; keep topology/runtime host files reference-only.
- Accuracy signal: high: architecture and staff execution briefs agree and cite locked design doc/spike evidence
- Follow-up needed: If code writer proves a hard TypeScript gap in core topology metadata, promote the minimum topology path with a new amendment before editing.
- Type: scope-correction
- Added at: 2026-07-03T21:49:00.000Z
- Trigger: Implementation completed without a core topology type gap.
- Reason: `packages/actor-core-runtime/src/topology.ts` was an initial generated hint but remained reference-only by architecture decision; keeping it in planned scope creates a false missing-file closeout blocker.
- Removed paths: packages/actor-core-runtime/src/topology.ts
- Evidence source: fas_senior_engineer implementation handoffs
- Evidence: `.fas/state/agent-orchestration-execution.json` records repeated confirmation that core topology remained untouched while package-owned lattice helpers passed test/build/export verification.
- Accuracy signal: high: package-owned `dependsOn` overloads satisfy the DX without core runtime changes.
- Follow-up needed: None for this task; any future core `actor().dependsOn()` fluent API requires a separate architecture decision.

- Type: api-contract-lock
- Added at: 2026-07-03T21:54:00.000Z
- Trigger: Operator clarified lattice dependsOn API and stigmergy coordinate semantics before QA.
- Reason: Lock dependsOn as the sole public dependency helper that bakes in runtime actor creation; clarify lattice as the coordination environment topology key and artifact key as a separate durable artifact coordinate.
- Added paths: docs/actor-web-lattice-contract-design.md
- Evidence source: operator API review
- Evidence: operator API review | docs/actor-web-lattice-contract-design.md | Update contract examples/tests so lattice and artifact key are not conflated, preserving multi-environment stigmergy coordination.
- Accuracy signal: high: operator approved design direction before implementation closeout
- Follow-up needed: Any future actor().dependsOn fluent runtime API requires a separate core-runtime architecture decision.

- Type: verification-scope-expansion
- Added at: 2026-07-03T22:18:00.000Z
- Trigger: fas validate-task closeout readiness detected @actor-web/lattice package tests outside configured FAS test command.
- Reason: Adding a new release package requires FAS verification to run its package test lane during full verification and closeout gates.
- Added paths: .fas-config.json
- Evidence source: .fas/state/closeout-readiness/latest.json
- Evidence: .fas/state/closeout-readiness/latest.json | .fas-config.json | PACKAGE_TESTS_COVERED_BY_VERIFICATION recommended adding pnpm --filter @actor-web/lattice test to the configured test command.
- Accuracy signal: high: closeout readiness directly cites changed @actor-web/lattice test files and package test script.
- Follow-up needed: None; keep future package additions covered by FAS testCommand or a test-lane manifest.

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
