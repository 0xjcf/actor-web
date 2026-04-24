# Logistics Control Tower Demo

## Summary

Replace the checkout-themed Ignite headless host example with a logistics tracker that demonstrates REST ingress, WebSocket gateway live updates, Actor-Web runtime transport to a WebWorker routing actor, and the existing service-worker topology proof.

## Scope

- Rework the example domain types from checkout/orders to shipment/logistics.
- Add built-in Node HTTP REST endpoints beside the gateway WebSocket server.
- Route server shipment creation through the server actor and ask the worker routing actor for deterministic route planning over Actor-Web transport.
- Update the Ignite UI labels and route log to show the runtime boundaries.
- Preserve the existing example path and service-worker fallback.

## Verification

- `pnpm test:examples`
- `pnpm test:runtime`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm architecture:check`
- `fas verify`

## Review Summary

- Replaced the checkout example language with logistics shipments while preserving the example path and compatibility aliases.
- Added REST command ingress, gateway live projection updates, and worker-owned route planning over Actor-Web WebSocket transport.
- Kept service-worker mode framed as a browser-local topology proof; auth, durable replay, dynamic discovery, and production backpressure remain future transport hardening work.
- Verification passed with the full FAS lane.
