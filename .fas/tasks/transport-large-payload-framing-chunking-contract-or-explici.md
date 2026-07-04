# Transport: large-payload framing/chunking contract or explicit max-payload with blob-externalization

## Source

Created with `fas create-task` on 2026-06-19.

## Problem

Location-transparency audit L5 (agent-payload gap, UNOWNED). The transport bounds outbound queues and REJECTS on overflow (external-transport-design.md:521-525) with no chunking. LLM agents ship large prompts/results/context blobs. Define a framing/chunking and reassembly contract at the transport seam, OR an explicit max-payload contract plus guidance to externalize blobs. Prerequisite for streaming large agent output.

## Acceptance criteria

- The change is verified and does not introduce regressions.
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

- packages/actor-core-runtime/src/runtime-transport-contract.ts
- packages/actor-core-runtime/src/transport/transport-core.ts
- packages/actor-core-runtime/src/runtime-transport-telemetry.ts
- packages/actor-core-runtime/src/index.ts
- packages/actor-core-runtime/src/browser.ts
- packages/actor-core-runtime/src/browser-websocket-message-transport.ts
- packages/actor-core-runtime/src/node-websocket-message-transport.ts
- packages/actor-core-runtime/src/unit/runtime-transport-contract.test.ts
- packages/actor-core-runtime/src/unit/transport-core.test.ts
- docs/API.md
- docs/spikes/actor-web-external-transport-design.md
- packages/actor-core-runtime/src/unit/browser-websocket-message-transport.test.ts
- packages/actor-core-runtime/src/unit/node-websocket-message-transport.test.ts

## Scope Amendments

- Type: explicit-scope
- Added at: 2026-07-04T18:20:00.000Z
- Trigger: implementation scope refresh
- Reason: Implement explicit max-frame-byte validation at the shared runtime transport contract/core seam, expose the limit through public transport options/exports, and document blob externalization guidance instead of adding chunking/reassembly in this release slice.
- Added paths: packages/actor-core-runtime/src/runtime-transport-contract.ts, packages/actor-core-runtime/src/transport/transport-core.ts, packages/actor-core-runtime/src/runtime-transport-telemetry.ts, packages/actor-core-runtime/src/index.ts, packages/actor-core-runtime/src/browser.ts, packages/actor-core-runtime/src/browser-websocket-message-transport.ts, packages/actor-core-runtime/src/node-websocket-message-transport.ts, packages/actor-core-runtime/src/unit/runtime-transport-contract.test.ts, packages/actor-core-runtime/src/unit/transport-core.test.ts, docs/API.md, docs/spikes/actor-web-external-transport-design.md
- Evidence source: task-packet
- Evidence: task-packet | .fas/state/task-packet.json | Low-confidence hints pointed at the runtime transport contract and WebSocket transport surface; source inspection showed enforcement belongs in TransportCore.
- Accuracy signal: validated against transport-core/WebSocket adapter ownership before editing
- Follow-up needed: Streaming/chunking remains in the downstream streaming task blocked by this contract.

- Type: explicit-scope
- Added at: 2026-07-04T18:24:00.000Z
- Trigger: public option test coverage
- Reason: Added focused tests proving maxFrameBytes is forwarded from the Node and browser WebSocket public options into the shared transport core.
- Added paths: packages/actor-core-runtime/src/unit/browser-websocket-message-transport.test.ts, packages/actor-core-runtime/src/unit/node-websocket-message-transport.test.ts
- Evidence source: diff
- Evidence: diff | packages/actor-core-runtime/src/unit/browser-websocket-message-transport.test.ts | Public WebSocket option pass-through is production surface and needs test coverage.
- Accuracy signal: tests are no-socket white-box checks of the shared core configuration
- Follow-up needed: None.

- Type: scope-refresh-promotion
- Added at: 2026-07-04
- Trigger: dirty-low-confidence-scope
- Reason: Promoted dirty low-confidence or dependency-reachable task-packet path(s) into affected scope.
- Added paths: packages/actor-core-runtime/src/browser.ts, packages/actor-core-runtime/src/index.ts, packages/actor-core-runtime/src/runtime-transport-contract.ts
- Evidence source: task-packet dirty scope promotion
- Evidence: task-packet dirty scope promotion | .fas/state/task-packet.json | Promoted dirty path(s): packages/actor-core-runtime/src/browser.ts, packages/actor-core-runtime/src/index.ts, packages/actor-core-runtime/src/runtime-transport-contract.ts
- Accuracy signal: Path was dirty in git status and present in task-packet low-confidence/dependency-reachable scope.

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
