# Normalize Runtime Gateway Inbound Queue Limit Options

## Summary

Harden the runtime gateway queue-limit option so invalid configured values cannot
silently disable or distort the inbound queue bound added by the ingress safety
work.

## Source

Created from final reviewer and SRE follow-up findings for `Harden runtime
gateway ingress safety` on 2026-05-13.

## Problem

`inboundQueueLimit` is currently passed through as configured. Invalid values
such as `NaN`, `Infinity`, zero, or negative numbers can weaken the protection:
`NaN` and `Infinity` can effectively disable the bound, while negative values can
fail closed on the first frame.

## Scope

- Normalize or reject invalid `inboundQueueLimit` values at the runtime gateway
  boundary.
- Preserve the current default safe limit for unspecified values.
- Keep valid positive finite values working as explicit overrides.
- Add regression coverage for invalid values and normal overflow behavior.

## Non-Goals

- No replay, auth, or durable storage changes.
- No lower node/browser transport rewrite.
- No new observer sink or metrics product surface.

## Acceptance Criteria

- `NaN`, `Infinity`, zero, and negative limits normalize to a safe positive
  default or fail deterministically before they can disable the bound.
- Valid positive finite limits preserve existing overflow behavior and observer
  evidence.
- Runtime gateway tests cover normalization and overflow behavior.
- FAS validation passes for the changed runtime gateway surface.

## Suggested Mode

`4-agent`

## Affected Files

- `packages/actor-core-runtime/src/runtime-gateway.ts`
- `packages/actor-core-runtime/src/unit/runtime-gateway.test.ts`
- `packages/actor-core-runtime/src/unit/serve-actor-web-node.test.ts`

## Scope Amendments

- Type: scope-tightening
- Added at: 2026-05-15
- Removed paths: packages/actor-core-runtime/src/serve-actor-web-node.ts
- Reason: verifier and reviewer confirmed the node wrapper already forwards
  `gateway.inboundQueueLimit`; hub-level normalization plus served-node
  regression coverage satisfies the brief without a no-op source edit.

## Verification

- `pnpm --filter @actor-core/runtime exec vitest run src/unit/runtime-gateway.test.ts src/unit/serve-actor-web-node.test.ts`
- `pnpm --filter @actor-core/runtime typecheck`
- `pnpm test:runtime`
- `fas validate-task`
