# Full Server Runtime Plus Worker Runtime Demo

## Summary

Update the Ignite headless host example so it can demonstrate a thin browser host consuming server gateway projections while a browser/WebWorker runtime participates as a real Actor-Web runtime peer over WebSocket transport.

## Scope

- Extend the checkout gateway server with a Node WebSocket runtime transport listener.
- Add a worker-owned checkout actor address/scope so the gateway can project and command a remote worker-owned actor through the server runtime.
- Add a WebWorker runtime entry that uses `createBrowserWebSocketMessageTransport`.
- Add example/test harness support for a server runtime plus browser-style worker runtime.
- Keep the existing server gateway, service-worker topology proof, and in-memory fallback intact.
- Update docs to distinguish gateway traffic from runtime-to-runtime transport traffic.

## Out of Scope

- Auth/security.
- Dynamic membership/discovery.
- Durable replay.
- Browser listener support.
- Production backpressure.

## Verification

- `pnpm test:examples`
- `pnpm test:runtime`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm architecture:check`
- `fas verify`
