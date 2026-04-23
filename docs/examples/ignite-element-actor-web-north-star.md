# Ignite-Element + Actor-Web North-Star Example

> ⚠️ **Future vision**: This file illustrates what the developer experience could look like once ignite-element and Actor-Web share common host adapters, cross-environment transports, and lifecycle helpers.

## 1. Define the shared checkout machine

```ts
// machines/checkoutMachine.ts
import { setup } from "xstate";

export const checkoutMachine = setup({
  /* ...types/actors/guards... */
}).createMachine({
  /* ...states... */
});
```

## 2. Register the machine with the new Actor Registry

```ts
// actors/registry.ts
import { registerActor } from "@actor-web/registry";
import { checkoutMachine } from "../machines/checkoutMachine";

export const checkoutActorId = registerActor({
  id: "checkout",
  machine: checkoutMachine,
  mailbox: { maxSize: 1000, overflow: "park" },
  persist: { strategy: "memory" },
});
```

## 3. Ignite-Element host uses the registry ID + DOM adapter

```ts
// components/checkout-form.tsx
import { igniteCore } from "ignite-element";
import { domHost } from "ignite-element/hosts/dom";
import { actorSource } from "ignite-element/actors";
import { checkoutActorId } from "../actors/registry";

export const checkoutComponent = igniteCore({
  host: domHost(),
  source: actorSource(checkoutActorId), // look up Actor-Web actor automatically
  events: (event) => ({
    "checkout-submitted": event<{ email: string }>(),
    "checkout-retry": event<{ attemptedAt: string }>(),
  }),
  transports: [
    // DOM CustomEvents + Actor-Web messages
    "dom",
    {
      type: "actor-web",
      actorId: checkoutActorId,
      mapEvent: (type, payload) => ({ type, payload }),
    },
  ],
  states: (snapshot) => ({
    isCompleted: snapshot.matches("completed"),
    orderId: snapshot.context.orderId,
  }),
  commands: ({ actor, emit }) => ({
    submitOrder: () => {
      actor.send({ type: "SUBMIT" });
      emit("checkout-submitted", {/* ... */});
    },
  }),
});
```

## 4. Server host reuses the same actor via Actor-Web helpers

```ts
// hosts/server/httpCheckout.ts
import { attachHttpHost } from "@actor-web/hosts/http";
import { checkoutActorId } from "../actors/registry";

export const handleCheckout = attachHttpHost({
  actorId: checkoutActorId,
  schema: {
    SUBMIT: z.object({ payload: z.object({ email: z.string().email() }) }),
  },
  routes: {
    async POST({ actorRef, body }) {
      await actorRef.send(body);
      return { status: 202 };
    },
    async GET({ actorRef }) {
      return actorRef.snapshot();
    },
  },
});
```

## 5. Worker/embedded host via transport adapters

```ts
// hosts/worker/checkoutWorker.ts
import { attachMessagePort } from "@actor-web/hosts/message-port";
import { checkoutActorId } from "../actors/registry";

attachMessagePort({
  actorId: checkoutActorId,
  port: self,
  serializer: "structuredClone",
});
```

## 6. Hydration & lifecycle helpers

```ts
// client/bootstrap.ts
import { hydrateActor } from "@actor-web/hydration";
import { checkoutActorId } from "../actors/registry";

hydrateActor(checkoutActorId, window.__CHECKOUT_SNAPSHOT__);
```

## Takeaways

- **Single registry** backs every host.
- **Host adapters** (DOM, HTTP, worker) hide boilerplate.
- **Transports** let `emit` fan-out to Actor-Web without extra wiring.
- **Hydration helpers** keep server + client in sync.
- **Schema-aware hosts** enforce message contracts everywhere.

This is the developer experience we’re aiming for: define the actor once, register it, and plug it into any host—browser, server, worker, or embedded—without rewriting the state machine or the event contracts.
