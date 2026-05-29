# Make Actor-Web browser entrypoint free of Node crypto shims

## Source
Created with `fas create-task` on 2026-05-28.

## Problem
Freedom Air currently needs a Vite alias for crypto/node:crypto plus a local browser crypto shim because @actor-core/runtime/browser can reach runtime-gateway.ts, which imports node:crypto for randomUUID and SHA-256 base64url replay owner keys. Fix Actor-Web upstream without adding a hashing dependency as the first pass: split browser-safe gateway contracts/source-handle helpers away from the Node-owned gateway hub implementation, keep hashing/replay owner key generation in the server gateway path, and prove browser imports do not resolve node:crypto. This should let browser consumers import @actor-core/runtime/browser without app-level crypto aliases or browser-crypto shims.

## Acceptance criteria
- @actor-core/runtime/browser can be imported/bundled for browser consumers without resolving node:crypto or crypto.
- Browser-facing source APIs import browser-safe gateway contracts/source-handle helpers rather than the Node-owned createRuntimeGatewayHub implementation.
- createRuntimeGatewayHub retains existing replay owner key behavior and Node parity tests for auth:<sha256 base64url> values.
- No new hashing dependency is added for the package-boundary fix; document any future need separately if a browser-hosted gateway hub becomes an explicit target.
- Freedom Air-style consumer guidance no longer requires a Vite crypto alias for Actor-Web browser APIs.
- The task has a browser import/bundle regression test plus focused runtime gateway tests before full verification.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution
- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered
- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files
- packages/actor-core-runtime/src/runtime-gateway.ts
- packages/actor-core-runtime/src/browser.ts
- packages/actor-core-runtime/src/actor-web-source.ts
- packages/actor-core-runtime/src/actor-web-client.ts
- packages/actor-core-runtime/src/topology.ts
- packages/actor-core-runtime/src/unit/runtime-gateway.test.ts
- packages/actor-core-runtime/src/unit/actor-web-source.test.ts
- packages/actor-core-runtime/src/unit/topology.test.ts
- packages/actor-core-runtime/package.json
- docs/API.md
- docs/actor-web-topology-source-dx-design.md

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
