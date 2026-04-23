# Ignite-Element Host Bridge Example

This example shows the current minimal bridge for reusing the same actor (and message contracts) from **ignite-element** in environments where there is no DOM host. We wire the checkout machine into an `@actor-core/runtime` actor and expose a host-facing source with typed commands plus reactive snapshots.

1. **Web Component Host** – the regular ignite-element facade running in the browser.
2. **Server Host** – an HTTP handler that forwards requests to the same actor through Actor-Web.

```ts
import { createActor } from "xstate";
import { createActorRef, createIgniteActorSource } from "@actor-core/runtime";
import { checkoutMachine } from "../machines/checkoutMachine";
import { checkoutComponent } from "../components/checkout-component";

// Browser host -------------------------------------------------------------

// Step 1: spin up the shared actor that backs ignite-element.
const checkoutActor = createActor(checkoutMachine).start();

// Step 2: register the web component factory (the module exported by igniteCore).
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

checkoutSource.subscribe((snapshot) => {
  console.log(snapshot.phase, snapshot.context);
});

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

> **Why this works:** ignite-element only needs a host-facing source, but the actor logic is completely separate. By putting the machine behind `@actor-core/runtime` and exposing `createIgniteActorSource(...)`, you can reuse the same typed commands and snapshots across DOM, server, worker, or embedded hosts without rewriting the state machine or message contracts.

## Key Takeaways

- Actor-Web gives you host-agnostic ActorRefs plus a minimal Ignite bridge source.
- ignite-element can derive UI state from Actor-Web snapshots without importing runtime internals.
- Share the machine + event contracts between both hosts to guarantee consistent behavior across UI and server.
