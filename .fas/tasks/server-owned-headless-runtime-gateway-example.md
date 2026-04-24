# Server-Owned Headless Runtime Gateway Example

## Summary

Promote the runtime gateway from projection-only to a command-capable host gateway and update the Ignite headless example so a browser/Ignite host can consume a server-owned Actor-Web runtime over a WebSocket gateway.

## Scope

- Add gateway `send` and `ask` frames with `ack`, `reply`, and command error handling.
- Keep the gateway separate from distributed `MessageTransport`.
- Add a Node checkout runtime gateway server example.
- Add a browser gateway client source that implements the existing headless host source contract.
- Prefer the server gateway runtime when `VITE_ACTOR_WEB_GATEWAY_URL` is configured.

## Out of Scope

- Browser/WebWorker runtime peer transport.
- Auth/security.
- Durable replay/resync beyond existing gateway resync.
- Dynamic discovery and production backpressure.

## Acceptance Criteria

- Runtime gateway command frames are unit tested.
- The headless host example can submit/reset through a server-owned runtime gateway source.
- Existing service-worker and in-memory fallbacks remain intact.
- Full verification passes, including example tests with localhost socket permission.
