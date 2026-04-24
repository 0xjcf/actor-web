# Ignite-Element Host Bridge Example

This example shows the current bridge for reusing the same actor and message contracts from **ignite-element** in environments where there is no DOM host. The runtime/source contract stays in `@actor-core/runtime/browser`, the Ignite adapter stays in `ignite-adapters/actor-web`, and the example separates runtime ownership from the host consumer. The browser page acts as a thin host, while runtimes can be owned by an in-memory test harness, a service worker topology proof, a server gateway, or a server plus WebWorker transport demo.

Runnable prove-out: [`examples/ignite-headless-host/`](/Users/joseflores/Development/actor-web/examples/ignite-headless-host)

1. **Web Component Host** – a browser host that consumes an `IgniteActorSource`.
2. **Service Worker Runtime Owner** – the runtime/bootstrap side in the browser demo that owns `ActorSystem`, transport, and remote refs.
3. **Server Gateway Runtime Owner** - a Node runtime owns the actor and exposes projection/control through the runtime gateway.
4. **Server + Worker Runtime Owners** - a Node runtime and browser/WebWorker runtime communicate over Actor-Web WebSocket transport while the page consumes gateway projections.

```ts
import { createActor } from "xstate";
import { createActorRef, createIgniteActorSource } from "@actor-core/runtime/browser";
import { checkoutMachine } from "../machines/checkoutMachine";
import { checkoutComponent } from "../components/checkout-component";

// Browser host -------------------------------------------------------------

// Host adapters stay thin and only need an IgniteActorSource.
const checkoutHost = createHeadlessCheckoutHostFromSource(checkoutSource);

// Register the web component factory (the module exported by igniteCore).
checkoutComponent(
	"checkout-form",
	({ isCompleted, orderId, submitOrder }) => {
		/* render JSX */
	},
);

// Host bridge --------------------------------------------------------------

const checkoutRef = createActorRef(checkoutMachine, {
  id: "checkout",
});
checkoutRef.start();

const checkoutSource = createIgniteActorSource(checkoutRef);
console.log(checkoutSource.transportStatus().state); // "local"

// The same host bridge also works for actor-system managed refs.
// const system = new ActorSystemImpl({ nodeAddress: "web-1" });
// await system.start();
// const checkoutActor = await system.spawn(checkoutBehavior, { id: "checkout" });
// const checkoutSource = createIgniteActorSource(checkoutActor);

checkoutSource.subscribe((snapshot) => {
  console.log(snapshot.phase, snapshot.context);
});

checkoutSource.subscribeEvent((event) => {
  console.log(event.type, event.address.id);
}, { types: ["CHECKOUT_SUBMITTED"] });

// Remote host bridge -------------------------------------------------------

// Actor-Web remote refs can now be consumed directly:
// await navigator.serviceWorker.register("./ignite-headless-host.sw.js", {
//   type: "module",
//   scope: "./",
// });
// const remoteCheckoutRef = await localSystem.lookup<CheckoutContext, CheckoutCommand>(
//   "actor://node-b/actor/checkout"
// );
// const remoteCheckoutSource = createIgniteActorSource(remoteCheckoutRef);
// remoteCheckoutSource.subscribeTransportStatus((status) => {
//   console.log(status.state, status.reason);
// });

// Explicit overrides remain available for foreign transports or non-Actor-Web runtimes.
// const remoteCheckoutSource = createIgniteActorSource(remoteCheckoutRef, {
//   getSnapshot: () => remoteSnapshotCache.read(),
//   subscribeSnapshot: (listener) => remoteSnapshotStream.subscribe(listener),
//   subscribeEvent: (listener, options) =>
//     remoteEventStream.subscribe((event) => {
//       if (!options?.types?.length || options.types.includes(event.type)) {
//         listener(event);
//       }
//     }),
// });

// Server host --------------------------------------------------------------

export async function handleCheckout(request: Request) {
  const body = await request.json();

  switch (body.type) {
    case "SUBMIT":
      await checkoutSource.send({ type: "SUBMIT", payload: body.payload });
      return new Response(JSON.stringify({ status: "accepted" }), { status: 202 });
    case "STATUS":
      return new Response(JSON.stringify(checkoutSource.snapshot()));
    default:
      return new Response("Unsupported", { status: 400 });
  }
}
```

> **Why this works:** ignite-element only needs a host-facing source, but the actor logic is completely separate. By putting the machine behind `@actor-core/runtime/browser` and exposing `createIgniteActorSource(...)`, you can reuse the same typed commands, snapshots, and emitted events across DOM, server, worker, or embedded hosts without rewriting the state machine or message contracts. Local refs now report `local` transport state, which means there is no remote projection hop; remote Actor-Web refs report runtime-backed transport health. In the demo, the service worker is just an example-local runtime owner, not the final distributed transport story.

## Server Plus Worker Demo Mode

The production-oriented demo mode uses two separate channels:

- **Gateway:** browser host to server runtime projection/control channel.
- **Transport:** runtime-to-runtime `MessageTransport` channel between the server runtime and browser/WebWorker runtime.

The Node demo server exposes both URLs:

- `getGatewayUrl()` returns the browser-facing gateway WebSocket URL.
- `getTransportUrl()` returns the Actor-Web runtime transport WebSocket URL.

When both `VITE_ACTOR_WEB_GATEWAY_URL` and `VITE_ACTOR_WEB_TRANSPORT_URL` are configured, the headless host harness starts the server gateway source and a module WebWorker runtime. The worker owns `actor://ignite-worker-runtime/actor/ignite-worker-checkout`; the server owns `actor://ignite-host-runtime/actor/ignite-headless-host`. Tests prove both actors can be projected and commanded through gateway sources while the server and worker communicate over real localhost WebSocket transport.

## Key Takeaways

- Actor-Web gives you host-agnostic ActorRefs plus a minimal Ignite bridge source.
- ignite-element can derive UI state from Actor-Web snapshots without importing runtime internals.
- The bridge can surface typed emitted events to headless or DOM hosts.
- Local refs surface `local` transport state, while Actor-Web remote refs surface `connected`, `replaying`, `degraded`, and `disconnected`.
- The browser example demonstrates both a topology proof through service worker ports and a runtime transport demo through server plus WebWorker WebSockets.
- The example’s runtime harness owns transport/bootstrap separately from the host consumer, which matches the intended client-versus-runtime ownership boundary.
- Gateway traffic is not runtime transport traffic; gateway is the thin host channel, while `MessageTransport` is the Actor-Web runtime peer channel.
- Explicit remote overrides are only needed for foreign transports or non-Actor-Web runtimes.
- Share the machine + event contracts between both hosts to guarantee consistent behavior across UI and server.
