# Enforce Runtime Gateway Liveness and Replay Security

## Summary

Make gateway connection liveness enforceable and prevent replay resumption from
trusting client-supplied session identifiers without an authenticated binding.

## Audit Evidence

- `packages/actor-core-runtime/src/runtime-gateway.ts:447`
- `packages/actor-core-runtime/src/runtime-gateway.ts:598`
- `packages/actor-core-runtime/src/runtime-gateway.ts:875`
- `packages/actor-core-runtime/src/runtime-gateway.ts:883`
- `packages/actor-core-runtime/src/runtime-gateway.ts:953`
- `packages/actor-core-runtime/src/unit/runtime-gateway.test.ts:868`
- `packages/actor-core-runtime/src/unit/runtime-gateway.test.ts:939`
- `packages/actor-core-runtime/src/unit/runtime-gateway.test.ts:1094`

## Scope

- Track gateway client heartbeat or idle deadlines server-side.
- Disconnect stale clients and clean subscriptions, replay state, and bookkeeping.
- Treat repeated outbound send failures as connection failures.
- Bind replay resume keys to authenticated context, or replace reusable
  `lastConnectionId` inputs with opaque server-issued resume tokens.
- Add tests for stale-client cleanup and cross-client replay isolation.

## Non-Goals

- No broad production auth provider implementation.
- No change to lower transport retry semantics unless required by the gateway.
- No durable replay storage redesign.

## Acceptance Criteria

- Stale or silent gateway clients are evicted deterministically.
- Repeated send failures clean up gateway connection state.
- Replay resumption cannot be reused by a different client context.
- Tests cover idle timeout, send-failure cleanup, and replay isolation.
- Focused runtime tests and the required FAS verification lane pass.

## Suggested Mode

`6-agent`

## Verification

- `pnpm test:runtime`
- Targeted runtime gateway liveness and replay tests
- `pnpm typecheck`
- `pnpm lint`
- `fas validate-task`
