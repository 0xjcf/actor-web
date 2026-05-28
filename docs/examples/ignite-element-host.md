# Ignite-Element Host Bridge Example

The `examples/ignite-headless-host/` example is now the Actor-Web Logistics
Control Tower. It keeps the same path for continuity, but the visible domain is
shipment tracking rather than checkout.

The example demonstrates four boundaries:

- **REST ingress:** browser or API clients submit shipments through
  `POST /shipments`.
- **Runtime gateway:** the thin Ignite host receives live snapshots, events,
  status, and replies from more than one actor source. The demo gateway is
  WebSocket-backed, but gateway means the client projection/control edge.
- **Actor-Web transport:** the server runtime asks a WebWorker-owned routing
  actor for carrier and ETA planning over WebSocket `MessageTransport`.
- **Service worker topology proof:** browser host and service worker runtime
  still communicate through the example-local MessagePort transport.

Runnable prove-out: `examples/ignite-headless-host/`

For the full browser demo, use the dedicated launcher:

```sh
pnpm examples:logistics
```

The launcher starts the logistics backend and Vite in one process, then injects
all three runtime URLs:

- `VITE_ACTOR_WEB_REST_URL`: REST command ingress for the Create button.
- `VITE_ACTOR_WEB_GATEWAY_URL`: runtime gateway endpoint for live snapshots,
  events, status, and actor commands.
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
- Provider actors/model: `logistics-provider-hq.ts` tracks provider queue data,
  `logistics-provider-hq-behavior.ts` exposes the Provider HQ actor behavior,
  and `provider-console.tsx` renders the external Provider HQ console.
- Projection helpers: `logistics-snapshots.ts` and `logistics-view-model.ts`
  keep gateway snapshots and UI route labeling out of actor behavior.
- Ports/adapters: `server-runtime-gateway.ts`, `browser-transport.ts`,
  `worker-runtime.ts`, and `worker-websocket-runtime.ts` adapt REST, WebSocket
  gateway, MessagePort, service worker, and Actor-Web transport edges.
- Ignite hosts: `ignite-headless-host-element.tsx` and `provider-console.tsx`
  render and command the actors without owning runtime state.

The example uses the runtime topology/source DX directly. Runtime edges are
created from topology actor descriptors, not from hand-written actor addresses.
The default Ignite host surface is projection-only: the Control Tower projects
the server-owned shipment actor through a read-model source. Source means the
Ignite-compatible read-model adapter for one actor:

```ts
const source = logistics.actors.shipment.readModel({
  gateway: { url: gatewayUrl },
});
```

In the full server + worker mode, the same runtime gateway also exposes the
worker-owned routing actor as a second read-only source so the UI can show
distributed ownership instead of folding every update into the shipment
projection. The source helper defaults to the actor descriptor's gateway scope;
in this example, `gateway: true` uses the topology actor keys `shipment` and
`routing` as the public gateway scopes. Explicit `scope` is only needed for
overrides, parameterized subscriptions, or address-based/generated clients:

```ts
const routingSource = logistics.actors.routing.readModel({
  gateway: { url: gatewayUrl },
});
```

When a component needs a scoped projection, keep dynamic values inside
`gateway.scope.params` and let `kind` default from the topology actor unless the
gateway intentionally exposes a different public scope:

```ts
const vehicleInspectionsSource = fleet.actors.vehicleInspections.readModel({
  gateway: {
    url: gatewayUrl,
    scope: {
      params: { fleetId, vehicleId },
    },
  },
});
```

`ignite-headless-host-element.tsx` passes Actor-Web read-model handles directly
to `igniteCore` from `ignite-element/actor-web`. The shipment projection drives
the main Control Tower, and the worker routing actor is rendered as its own
read-only Ignite component/source. The UI consumes the inferred Ignite view
model from the `states` hook instead of wrapping projection data in a custom
source-shaped adapter.

`logistics-browser-client.ts` binds the shared topology to the deployed gateway
for current demo wiring, but the target `ignite-element/actor-web` contract is
read-model first. The Ignite host should pass `.readModel(...)` as `source` and
only opt into `.commandSource(...)` when the component intentionally owns
command/control. Browser-local details such as form inputs and latest-event
display remain element concerns instead of being disguised as Actor-Web source
state. REST ingress stays in the server HTTP adapter and reaches the same actor
behavior.

Use the split like this:

```ts
const runtime = await startActorWebLocalRuntime(logistics);

const shipmentHost = igniteCore({
  source: ({ host }) => runtime.shipment.readModel({ host }),
  commandSource: () => runtime.shipment.commandSource(),
  commands: ({ actor, command }) => ({
    resetShipment: command(() => actor.send({ type: 'RESET_SHIPMENT' })),
  }),
});
```

Do not inject standalone command-helper objects into Ignite components. Keep
host-owned commands on the Ignite command API through the explicit
`commandSource` pairing. For deployed gateway-backed pages, use the same split
with `logistics.actors.shipment.readModel({ gateway })` and
`logistics.actors.shipment.commandSource({ gateway })`. Generic browser clients
can still use
`createActorWebReadModelClient(...)` or `.readModel(...)` where no Ignite command
surface is required.

`server-runtime-gateway.ts` starts the server node with `serveActorWebNode` and
uses `serveActorWebHttp(runtime).for(logistics.actors.shipment)` for REST
ingress routes. `worker-websocket-runtime.ts` starts the WebWorker runtime node
with `startActorWebNode` and the browser runtime transport options.
`worker-runtime.ts` starts the Service Worker proof node with the same
`startActorWebNode` API and a `createMessagePortTransport` adapter, so
service-worker ownership remains part of the shared topology while
service-worker registration stays in the example browser shell.

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

Use the names consistently:

- Node: an actor-owning runtime process, such as the server runtime or worker
  runtime.
- Transport: runtime-to-runtime actor messaging through `MessageTransport`.
- Gateway: client projection/control edge for thin hosts. This demo backs it
  with WebSocket, but it is not the same thing as inter-node transport.
- Source: Ignite-compatible read-model adapter for one actor.
- Commands: Ignite host actions defined inside `igniteCore(...).commands(...)`
  and routed through the provided `actor` handle for the active source.

REST is a conventional ingress adapter for clients that do not want to hold a
live socket. The service worker path remains a browser-local topology proof, not
direct production server-to-service-worker transport. The browser host submits
shipment creation intent but does not own in-transit, delivered, or returned
lifecycle decisions; those updates are server-owned demo signals streamed back
over the gateway.
