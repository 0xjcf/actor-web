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

For the full browser demo, start the logistics gateway server and run Vite with
all three runtime URLs configured:

- `VITE_ACTOR_WEB_REST_URL`: REST command ingress for the Create button.
- `VITE_ACTOR_WEB_GATEWAY_URL`: WebSocket projection/control gateway for live
  snapshots and events.
- `VITE_ACTOR_WEB_TRANSPORT_URL`: Actor-Web runtime transport listener used by
  the browser WebWorker routing runtime.

When only `VITE_ACTOR_WEB_GATEWAY_URL` is configured, the UI still works through
gateway commands, but Create will not produce a REST network request. When
`VITE_ACTOR_WEB_TRANSPORT_URL` is missing, the shipment actor will stay at
`route-requested` with pending carrier/ETA because no worker runtime peer is
connected.

## Runtime Owners

- Browser host: Ignite custom element, projection consumer only.
- Server runtime: owns
  `actor://logistics-server-runtime/actor/logistics-shipment`.
- WebWorker runtime: owns
  `actor://logistics-worker-runtime/actor/logistics-routing`.
- Service worker runtime: browser-local fallback/topology proof.

## Demo Flow

1. The Ignite UI submits a shipment through REST when
   `VITE_ACTOR_WEB_REST_URL` is configured; otherwise it falls back to gateway
   commands for local/dev topology proof.
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
