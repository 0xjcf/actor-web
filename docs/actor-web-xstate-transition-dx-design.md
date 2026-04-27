# Actor-Web XState Transition DX Design

## Summary

Actor-Web should use XState as the lifecycle constraint engine and add an
Actor-Web-native `onTransition(...)` authoring layer for message handlers,
tool calls, emits, replies, runtime projections, and agent guardrails.

This should be implemented after the Actor-Web tool ports slice. Tool ports give
agent actors explicit capabilities through `dependencies.tools`; this slice uses
those ports inside typed transition handlers.

## Problem

Actor-Web currently has the right primitives, but the developer experience still
forces too much manual wiring:

- XState can constrain legal lifecycle transitions.
- `defineActor().withMachine(...)` can attach a machine to an actor behavior.
- `defineActor().onMessage(...)` can handle commands, emit events, and call
  tools.
- Topology can declare runtime ownership and required tools.

The missing layer is a clear way to say:

> For each machine event/command transition, run this Actor-Web handler with a
> narrowed message type, actor dependencies, and tool access.

Without that layer, developers duplicate lifecycle knowledge between the XState
machine and `onMessage(...)`.

## Design Goal

Keep XState as the source of truth for lifecycle legality. Actor-Web should add
ergonomics around XState, not replace it with a second FSM engine.

```text
XState owns:
- states
- legal transitions
- guards
- machine context
- delayed/transient transitions where needed

Actor-Web owns:
- actor messages
- actor refs and location transparency
- tool ports
- emitted events
- replies
- runtime projections
- topology metadata
- gateway/transport visibility
```

## Proposed API

```ts
export const createShipmentBehavior = () =>
  defineActor<ShipmentCommand>()
    .withMachine(shipmentMachine)
    .onTransition({
      CREATE_SHIPMENT: async ({ message }) => ({
        emit: [{ type: 'SHIPMENT_CREATED', shipmentId: message.shipmentId }],
      }),

      SCAN_LABEL: async ({ message, dependencies }) => {
        const scan = await dependencies.tools.execute('provider.scan.verify', message);

        return {
          emit: [{ type: 'PROVIDER_SIGNAL_RECORDED', scan }],
        };
      },
    })
    .build();
```

The handler key narrows `message`:

```ts
SCAN_LABEL: async ({ message }) => {
  message.type;
  message.shipmentId;
  message.scanId;
}
```

The machine provides actor context:

```ts
const shipmentMachine = setup({
  types: {
    context: {} as ShipmentContext,
    events: {} as ShipmentCommand,
  },
}).createMachine({
  id: 'shipment',
  initial: 'idle',
  context: {
    shipmentId: null,
    status: 'idle',
  },
  states: {
    idle: {
      on: {
        CREATE_SHIPMENT: {
          target: 'pending',
        },
      },
    },
    pending: {
      on: {
        SCAN_LABEL: {
          target: 'packed',
          guard: 'hasProviderScan',
        },
      },
    },
  },
});
```

## Type Inference

The first implementation should infer from the command union passed to
`defineActor<TCommand>()`.

```ts
type TransitionHandlers<TCommand extends { type: string }, TContext, TEvent> = {
  readonly [K in TCommand['type']]?: TransitionHandler<
    Extract<TCommand, { type: K }>,
    TContext,
    TEvent
  >;
};
```

Expected inference:

- Handler keys are limited to `TCommand['type']`.
- Handler `message` is narrowed with `Extract<TCommand, { type: K }>`.
- Handler `actor` context follows `.withMachine(...)` context when available.
- Handler `dependencies` exposes `dependencies.tools`.
- Handler result uses the existing `ActorHandlerResult`/`MessagePlan` return
  patterns.

Compile-time validation that a key exists in the XState machine can be a later
hardening step. The first slice can validate machine support at runtime.

## Runtime Behavior

`onTransition(...)` should route incoming messages through the machine-aware
handler table.

Recommended behavior:

1. Receive an actor message.
2. Check whether the machine can accept the event.
3. If the transition is invalid, reject with a clear invalid transition error.
4. If a matching transition handler exists, run it.
5. Let the existing actor behavior pipeline apply context, emit events, replies,
   and message plans.
6. If no transition handler exists, optionally fall back to `onMessage(...)`
   when one is also defined.

The fallback lets teams migrate from manual `onMessage(...)` to
`onTransition(...)` incrementally.

## Invalid Transition Error

Actor-Web should expose a stable error shape later, but the first implementation
can start with a clear `Error`.

```text
Actor "logistics-shipment" cannot apply transition "SCAN_LABEL" from state "idle".
```

Future hardening can add:

- error code,
- current state,
- attempted transition,
- allowed transitions,
- actor address,
- correlation id.

## Tool Port Integration

Tool calls stay inside transition handlers:

```ts
SCAN_LABEL: async ({ message, dependencies }) => {
  const scan = await dependencies.tools.execute('provider.scan.verify', message);

  return {
    emit: [{ type: 'PROVIDER_SIGNAL_RECORDED', scan }],
  };
}
```

Topology declares required tools:

```ts
shipment: actor({
  id: 'logistics-shipment',
  node: 'server',
  behavior: createShipmentBehavior,
  tools: [tool('provider.scan.verify')],
});
```

Node runners provide implementations:

```ts
await serveActorWebNode(logistics, {
  node: 'server',
  tools: {
    'provider.scan.verify': providerScanVerify,
  },
});
```

This gives FAS agents the same model:

- state machine constrains legal action,
- transition handler performs agent/tool work,
- events capture decisions and results,
- topology declares required capabilities.

## Topology And UI Projection

The transition map should eventually be visible to topology consumers. Ignite
Element and agent UIs can then ask:

- What state is this actor in?
- What transitions are currently legal?
- Which transitions require tools?
- Which transitions require human approval?
- Which command shape should this control send?

Initial implementation does not need to generate UI controls. It should preserve
enough metadata to support that later.

## FAS Agent Fit

For FAS, an agent actor could look like:

```ts
const agentMachine = setup({
  types: {
    context: {} as AgentRunContext,
    events: {} as AgentRunCommand,
  },
}).createMachine({
  initial: 'idle',
  states: {
    idle: {
      on: {
        START_TASK: 'planning',
      },
    },
    planning: {
      on: {
        PLAN_READY: 'awaitingApproval',
      },
    },
    awaitingApproval: {
      on: {
        APPROVE_PLAN: 'implementing',
        REJECT_PLAN: 'idle',
      },
    },
  },
});

export const createPlannerAgentBehavior = () =>
  defineActor<AgentRunCommand>()
    .withMachine(agentMachine)
    .onTransition({
      START_TASK: async ({ message, dependencies }) => {
        const memory = await dependencies.tools.execute('fas.memory.read', {
          task: message.task,
        });

        return {
          emit: [{ type: 'AGENT_CONTEXT_LOADED', memory }],
        };
      },
    })
    .build();
```

This matches FAS’s FSM-as-constraint-map model without creating a separate FSM
implementation in Actor-Web.

## Implementation Slices

### Slice 1: Builder API

- Add `onTransition(...)` to `UnifiedActorBuilder`.
- Type handler keys from `TMessage['type']`.
- Narrow handler `message` by transition key.
- Preserve current `onMessage(...)` support.
- Route incoming messages to transition handlers at runtime.
- Add unit tests for type narrowing and runtime handler execution.

### Slice 2: XState Validation

- Detect whether the attached machine can accept a message.
- Reject invalid transitions before running side effects.
- Add invalid-transition tests.
- Keep validation runtime-first; compile-time machine event validation can come
  later.

### Slice 3: Metadata Projection

- Preserve transition metadata on built behaviors.
- Expose helper APIs for allowed transition inspection.
- Use the metadata in docs/example UI only after the behavior API is stable.

### Slice 4: Logistics Example Migration

- Convert the logistics shipment actor to `withMachine(...).onTransition(...)`.
- Keep tool calls in transition handlers.
- Use transition legality to disable or explain provider controls.
- Keep gateway projections unchanged.

### Slice 5: FAS Agent Prototype

- Model one FAS agent lifecycle with XState + `onTransition(...)`.
- Use tool ports for memory, repo search, and verification.
- Emit transition/audit events for the dashboard.

## Test Plan

- Type tests:
  - handler keys are command type literals,
  - handler messages are narrowed by key,
  - invalid command keys fail compilation where possible.
- Unit tests:
  - transition handler executes,
  - tools are available in handler dependencies,
  - missing handler fallback works when `onMessage(...)` exists,
  - invalid transition rejects before side effects.
- Regression tests:
  - existing `defineActor().onMessage(...)` behavior remains unchanged,
  - existing `defineActor().withMachine(...).onMessage(...)` behavior remains
    unchanged,
  - topology runners still inject tools.

## Non-Goals

- Do not replace XState.
- Do not build a new FSM engine.
- Do not require every actor to use a machine.
- Do not generate UI controls in the first slice.
- Do not make FAS-specific APIs part of Actor-Web runtime.

## Open Questions

- Should `onTransition(...)` require `.withMachine(...)`, or should it also work
  without a machine as a typed message dispatch table?
- Should invalid transitions throw, return an error reply, or emit a rejected
  event by default?
- Should transition metadata include required tools per transition, or should
  required tools stay actor-level only for the first implementation?
- Should `onMessage(...)` and `onTransition(...)` be mutually exclusive in the
  long term, or should fallback remain supported?
