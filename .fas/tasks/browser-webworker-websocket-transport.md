# Browser/WebWorker WebSocket Transport

## Summary

Add a browser-safe outbound WebSocket `MessageTransport` for browser and WebWorker runtimes. This slice reuses the runtime handshake/wire contract, keeps `MessageTransport` unchanged, and proves a browser-style runtime peer can interoperate with the Node WebSocket transport.

## Scope

- Add `createBrowserWebSocketMessageTransport` exported from `@actor-core/runtime/browser`.
- Reuse `RuntimeNodeIdentity`, runtime handshakes, and `RuntimeTransportFrame`.
- Add app-level runtime transport heartbeat frames because browser WebSockets cannot send low-level ping frames.
- Keep the browser transport outbound-only; no browser listener.
- Update Node WebSocket transport to accept and respond to app-level heartbeat frames.
- Update API and transport roadmap docs.

## Out of Scope

- Browser listener support.
- Auth/security.
- Durable replay, idempotency, delivery guarantees beyond current at-most-once send.
- Dynamic discovery or membership store.
- Production backpressure.
- Exporting the Node-only transport from `@actor-core/runtime/browser`.

## Verification

- `pnpm test:runtime`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm architecture:check`
- `fas verify`
