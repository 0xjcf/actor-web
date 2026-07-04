---
title: Headless agent runtime
description: Drive an Ignite + Actor-Web workflow without mounting DOM.
---

# Headless agent runtime

Every `igniteCore(...)` registration is also a headless runtime. The same
definition that can register a custom element can be driven from tests, scripts,
automation, or an agent loop with no DOM mounted.

For Actor-Web, that means the actor remains the owner of topology, lifecycle,
messages, and emitted facts. Ignite consumes one Actor-Web source, projects a
view, exposes named commands, and returns a runtime an agent can execute.

## Build one contract

```ts
import { igniteCore } from 'ignite-element/actor-web';

const checkoutRuntime = igniteCore({
  source: checkoutTopology.actors.checkout.source({ gateway: { url } }),
  view: ({ context, transport }) => ({
    orderId: context.orderId,
    status: context.status,
    connected: transport.state === 'connected',
  }),
  commands: ({ actor, command }) => ({
    submit: command(
      (orderId: string) => actor.send({ type: 'SUBMIT_ORDER', orderId }),
      { description: 'Submit an order to the checkout actor.' }
    ),
    requestReview: (orderId: string) =>
      actor.ask?.({ type: 'REQUEST_REVIEW', orderId }),
  }),
});
```

The `source` can come from a browser-local runtime, a gateway-backed runtime, or
a host-owned source handle. Ignite sees one source; Actor-Web still owns where
the actor lives.

## Drive it without DOM

```ts
const result = await checkoutRuntime.execute('submit', 'order-1001');

const snapshot = checkoutRuntime.getSnapshot();
const view = checkoutRuntime.getView();

const eventSub = checkoutRuntime.on('ORDER_SUBMITTED', (event) => {
  console.log(event.detail.orderId);
});

const viewSub = checkoutRuntime.watchView((nextView) => {
  console.log(nextView.status);
});

eventSub.unsubscribe();
viewSub.unsubscribe();
```

`execute(commandName, payload?)` calls the named command and returns the latest
snapshot plus any emitted events captured during that command window.

`getSnapshot()` returns the adapter snapshot. For Actor-Web sources, that
snapshot includes the actor context plus transport and address metadata.

`getView()` returns the projected view from your `view` callback, which is the
same shape a custom element renderer receives.

`on(eventName, handler)` subscribes to runtime events. Actor-Web source emits
flow into this runtime event stream when the source exposes `subscribeEvent`.

`watchSnapshot(...)` and `watchView(...)` observe ongoing state and view changes.
Older design notes may mention `getState()` or `watch(...)`; the current beta
runtime types use `getSnapshot()` and `watchSnapshot()`.

## Record a story

The runtime can record command, state, view, event, and lifecycle evidence:

```ts
const story = checkoutRuntime.record('submit order');

await story.execute('submit', 'order-1001');

story.trace();
story.lifecycle();
story.summary();
story.stop();
```

Use stories for deterministic examples and regression tests. They exercise the
same command surface an agent uses, so command names should be product verbs:
`submit`, `approve`, `retry`, `requestReview`.

## Register a DOM element from the same definition

The same value still registers a custom element:

```tsx
checkoutRuntime('checkout-panel', ({ orderId, status, submit }) => (
  <button onClick={() => submit(orderId)}>
    {status === 'submitted' ? 'Submitted' : 'Submit'}
  </button>
));
```

No separate UI adapter is required. The headless agent and DOM renderer share
the source, view projection, command names, and emitted-event surface.

## Boundary rules

- Actor-Web owns actor topology, runtime lifecycle, source handles, and command
  transport.
- Ignite owns projection, command binding, headless execution, recording, and
  DOM registration.
- Use `actor.send(...)` for fire-and-forget actor messages and `actor.ask(...)`
  only when the source supports request/reply.
- Use `command(...)` when you want command metadata for agent schemas or
  operator tooling.
- Keep domain protocol types at the actor boundary; UI and agent code should
  consume view state and named commands.
