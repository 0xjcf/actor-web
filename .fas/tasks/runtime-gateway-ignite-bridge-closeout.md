# Runtime Gateway and Ignite Bridge Closeout

## Summary

Close the current Actor-Web runtime gateway and Ignite bridge slice before starting production transport work. The local gateway implementation, public exports, dependency pinning, browser prove-out, and tests are intended to stay; this task makes the work trackable and documented without claiming that production multi-machine transport is complete.

## Scope

- Track the gateway closeout in `.fas/TASKS.md`.
- Document the runtime gateway API surface and frame behavior.
- Link the Ignite host bridge and external transport roadmap from public docs.
- Clarify the external transport roadmap with explicit done and remaining sections.
- Preserve `MessageTransport` as the only distributed runtime transport seam.

## Out of Scope

- Implementing `NodeWebSocketMessageTransport`.
- Changing runtime gateway frame shapes.
- Adding node identity, membership, auth, durable replay, or production delivery guarantees.
- Modifying unrelated spike docs or cleanup work.

## Acceptance Criteria

- Runtime gateway docs cover `createRuntimeGatewayHub`, `createRuntimeGatewaySource`, client/server frames, scopes, error codes, sequencing, resync, and status behavior.
- Docs frame the service-worker/browser demo as a topology prove-out, not the production cluster model.
- Focused checks pass: `pnpm test:runtime`, `pnpm test:examples`, `pnpm typecheck`, `pnpm lint`, and `pnpm architecture:check`.
- Final `fas verify` passes.

## Review Notes

The remaining production transport gaps are real external WebSocket transport, stable node identity, membership, auth/security, delivery guarantees, durable replay/resync, observability, and multi-process or multi-machine proof.
