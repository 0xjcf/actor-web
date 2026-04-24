# Ignite-Element Host Bridge Example

The `examples/ignite-headless-host/` example is now the Actor-Web Logistics
Control Tower. It keeps the same path for continuity, but the visible domain is
shipment tracking rather than checkout.

The example demonstrates four boundaries:

- **REST ingress:** browser or API clients submit shipments through
  `POST /shipments`.
- **WebSocket gateway:** the thin Ignite host receives live shipment snapshots,
  events, status, and replies.
- **Actor-Web transport:** the server runtime asks a WebWorker-owned routing
  actor for carrier and ETA planning over WebSocket `MessageTransport`.
- **Service worker topology proof:** browser host and service worker runtime
  still communicate through the example-local MessagePort transport.

Runnable prove-out: [`examples/ignite-headless-host/`](/Users/joseflores/Development/actor-web/examples/ignite-headless-host)

## Runtime Owners

- Browser host: Ignite custom element, projection consumer only.
- Server runtime: owns
  `actor://logistics-server-runtime/actor/logistics-shipment`.
- WebWorker runtime: owns
  `actor://logistics-worker-runtime/actor/logistics-routing`.
- Service worker runtime: browser-local fallback/topology proof.

## Demo Flow

1. A client submits a shipment through REST or the gateway source.
2. The server shipment actor emits `SHIPMENT_CREATED` and `ROUTE_REQUESTED`.
3. When the worker runtime is connected, the server asks the worker routing
   actor to `PLAN_ROUTE`.
4. The worker returns a deterministic carrier, ETA, and route note.
5. The server shipment actor applies `ASSIGN_ROUTE` and emits `ROUTE_ASSIGNED`.
6. Subscribed browser hosts receive live gateway snapshots/events without
   polling.

## Boundary Guidance

Gateway traffic is the thin host projection/control channel. Actor-Web
`MessageTransport` is the runtime-to-runtime channel. REST is a conventional
ingress adapter for clients that do not want to hold a live socket. The service
worker path remains a browser-local topology proof, not direct production
server-to-service-worker transport.
