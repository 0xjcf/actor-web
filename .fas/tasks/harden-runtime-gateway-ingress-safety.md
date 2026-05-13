# Harden runtime gateway ingress safety

## Summary

Harden runtime gateway WebSocket ingestion so malformed frames and noisy clients
cannot bypass hub validation or grow unbounded in-memory queues.

## Audit Evidence

- `packages/actor-core-runtime/src/serve-actor-web-node.ts:146`
- `packages/actor-core-runtime/src/serve-actor-web-node.ts:156`
- `packages/actor-core-runtime/src/runtime-gateway.ts:425`
- `packages/actor-core-runtime/src/runtime-gateway.ts:844`
- `packages/actor-core-runtime/src/runtime-gateway.ts:924`
- `packages/actor-core-runtime/src/runtime-gateway.ts:950`
- `packages/actor-core-runtime/src/node-websocket-message-transport.ts:1122`
- `packages/actor-core-runtime/src/browser-websocket-message-transport.ts:970`

## Scope

- Catch malformed JSON frames at the Node gateway adapter boundary.
- Translate parse failures into deterministic `invalid_frame` handling.
- Close or quarantine malformed connections without uncaught process exceptions.
- Add a per-connection inbound queue limit for gateway `pendingFrames`.
- Expose queue saturation through operator-visible telemetry or status.
- Add targeted gateway tests for malformed JSON and queue saturation.

## Non-Goals

- No rewrite of the lower node/browser transport backpressure implementation.
- No durable replay storage changes.
- No auth/session model changes.

## Acceptance Criteria

- Malformed client frames do not throw uncaught exceptions from the WebSocket
  message callback.
- The gateway emits or records an `invalid_frame` outcome for malformed input.
- Gateway inbound queues have an explicit bounded limit and overflow policy.
- Queue saturation behavior is covered by regression tests.
- Focused runtime tests and the required FAS verification lane pass.

## Suggested Mode

`6-agent`

## Verification

- `pnpm test:runtime`
- Targeted runtime gateway tests for malformed frames and queue overflow
- `pnpm typecheck`
- `pnpm lint`
- `fas validate-task`

## Scope Amendments

- Type: audit-scope-correction
- Added at: 2026-05-13T19:38:00Z
- Trigger: fas_architect handoff found generated commit-plan paths pointed at FAS verification pipeline files instead of runtime gateway ingress surfaces
- Reason: Limit implementation to Actor-Web runtime gateway ingress safety surfaces before code writing
- Added paths: packages/actor-core-runtime/src/serve-actor-web-node.ts, packages/actor-core-runtime/src/runtime-gateway.ts, packages/actor-core-runtime/src/unit/runtime-gateway.test.ts, packages/actor-core-runtime/src/unit/serve-actor-web-node.test.ts
- Evidence source: fas_architect handoff
- Evidence: fas_architect handoff | .fas/state/commit-plan.json | planned paths were unrelated to .fas/tasks/harden-runtime-gateway-ingress-safety.md
- Accuracy signal: high
- Follow-up needed: Regenerate commit plan before fas_staff_engineer and fas_senior_engineer steps

## Affected files

- packages/actor-core-runtime/src/serve-actor-web-node.ts
- packages/actor-core-runtime/src/runtime-gateway.ts
- packages/actor-core-runtime/src/unit/runtime-gateway.test.ts
- packages/actor-core-runtime/src/unit/serve-actor-web-node.test.ts
