# Ignite-Element Host Bridge Example

The `examples/ignite-headless-host/` example is now the Actor-Web Logistics
Control Tower. It keeps the same path for continuity, but the visible domain is
shipment tracking rather than checkout.

The example demonstrates four boundaries:

- **REST ingress:** browser or API clients submit shipments through
  `POST /shipments`.
- **WebSocket gateway:** the thin Ignite host receives live snapshots, events,
  status, and replies from more than one actor source.
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

## Example File Topology

The example is organized around a hexagonal boundary:

- Domain contract: `logistics-contract.ts` defines shipment commands, events,
  context, actor addresses, and runtime owners.
- Domain/application actors: `logistics-shipment-behavior.ts` owns shipment
  lifecycle decisions, while `logistics-routing-behavior.ts` owns worker route
  planning.
- Domain helpers: `logistics-provider.ts` derives deterministic provider
  facilities, loads, notes, and provider signal effects.
- Adapter-side provider model: `logistics-provider-hq.ts` tracks the external
  provider queue and manual/simulation status, while
  `provider-console-adapter.ts` adapts the Provider HQ REST edge for the
  browser console.
- Projection helpers: `logistics-snapshots.ts` and `logistics-view-model.ts`
  keep gateway snapshots and UI route labeling out of actor behavior.
- Ports/adapters: `server-runtime-gateway.ts`, `server-gateway-client.ts`,
  `browser-transport.ts`, `logistics-ui-ports.ts`, `provider-console-adapter.ts`,
  `worker-runtime.ts`, and `worker-websocket-runtime.ts` adapt REST, WebSocket
  gateway, MessagePort, service worker, and Actor-Web transport edges.
- Ignite hosts: `ignite-headless-host-element.tsx`, `provider-console.tsx`,
  and `headless-host.ts` render and command the actors without owning runtime
  state.

The example uses the runtime topology/source DX directly. Runtime edges are
created from topology actor descriptors, not from hand-written actor addresses.
The Control Tower commands and projects the server-owned shipment actor:

```ts
const source = logistics.actors.shipment.source({
  gateway: { url: gatewayUrl },
});
```

In the full server + worker mode, the same gateway also exposes the worker-owned
routing actor as a second read-only source so the UI can show distributed
ownership instead of folding every update into the shipment projection:

```ts
const routingSource = logistics.actors.routing.source({
  gateway: {
    url: gatewayUrl,
    scope: logistics.actors.routing.gateway?.scope,
  },
});
```

`ignite-headless-host-element.tsx` passes Actor-Web source handles directly to
`igniteCore` from `ignite-element/actor-web`. The shipment projection drives the
main Control Tower, and the worker routing actor is rendered as its own
read-only Ignite component/source. The UI consumes the inferred Ignite view
model from the `states` hook instead of wrapping projection data in a custom
source-shaped adapter.

`logistics-ui-ports.ts` keeps the browser host source boundary explicit:
`logisticsSources` chooses the correct topology-backed source for the current
demo mode. Browser-local details such as form inputs and latest-event display
remain element concerns instead of being disguised as Actor-Web source state.
Ignite commands send actor messages through the source actor; REST ingress stays
in the server HTTP adapter and reaches the same actor behavior.

`server-runtime-gateway.ts` starts the server node with `serveActorWebNode` and
uses `serveActorWebHttp(runtime).for(logistics.actors.shipment)` for REST
ingress routes. `worker-websocket-runtime.ts` starts the worker node with
`startActorWebNode`. The remaining harness code exists only to choose between
the full server/worker demo, gateway-only mode, service-worker topology proof,
and in-memory test fallback.

## Demo Flow

1. The Ignite UI submits a shipment through REST when
   `VITE_ACTOR_WEB_REST_URL` is configured; otherwise it falls back to gateway
   commands for local/dev topology proof.
2. The server shipment actor emits `SHIPMENT_CREATED` and `ROUTE_REQUESTED`.
3. When the worker runtime is connected, the server asks the worker routing
   actor to `PLAN_ROUTE`; the Control Tower also subscribes to the routing actor
   source so the worker-owned projection is visible separately.
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
