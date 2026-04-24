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

For the full browser demo, use the dedicated launcher:

```sh
pnpm examples:logistics
```

The launcher starts the logistics backend and Vite in one process, then injects
all three runtime URLs:

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

The launcher also prints a Provider HQ URL. To drive the lifecycle manually:

```sh
LIFECYCLE_MODE=manual pnpm examples:logistics
```

Open the Provider HQ console to switch between live simulation and manual
provider control. In manual mode, the console polls the provider queue, lets the
operator pick the active shipment, and sends label scan, truck pack, outbound
scan, delivery confirmation, or return exception signals. The server runtime
applies those provider updates to the shipment actor, and the control tower
receives fresh snapshots/events over the gateway WebSocket.

## Runtime Owners

- Browser host: Ignite custom element, projection consumer only.
- Server runtime: owns
  `actor://logistics-server-runtime/actor/logistics-shipment`.
- WebWorker runtime: owns
  `actor://logistics-worker-runtime/actor/logistics-routing`.
- Remote Provider HQ: external-system simulation that reports label, truck, and
  delivery/return scan signals back to the server runtime.
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
6. In simulation mode, the server runtime simulates provider lifecycle progress:
   label scan, truck pack, outbound scan, then deterministic delivered/returned
   completion.
7. In manual mode, the Provider HQ console sends the lifecycle signals instead
   of the server timers and processes queued shipments one at a time.
8. Subscribed browser hosts receive live gateway snapshots/events without
   polling.

The control tower keeps the full shipment timeline and gateway event stream in
memory, showing five entries per page so an operator can inspect previous
lifecycle updates without losing the latest projection.

## Boundary Guidance

Gateway traffic is the thin host projection/control channel. Actor-Web
`MessageTransport` is the runtime-to-runtime channel. REST is a conventional
ingress adapter for clients that do not want to hold a live socket. The service
worker path remains a browser-local topology proof, not direct production
server-to-service-worker transport. The browser host submits shipment creation
intent but does not own in-transit, delivered, or returned lifecycle decisions;
those updates are server-owned demo signals streamed back over the gateway.
