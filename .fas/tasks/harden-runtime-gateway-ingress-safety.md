# Harden Runtime Gateway Ingress Safety

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
