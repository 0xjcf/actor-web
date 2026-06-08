# Actor-Web Transition Constraint DX Design

## Summary

Actor-Web should support lifecycle constraint maps through either XState
statecharts or a small Actor-Web-native FSM object. The `onTransition(...)`
authoring layer then handles actor behavior for allowed transitions: tool calls,
emits, replies, context updates, runtime projections, and agent guardrails.

Tool ports give agent actors explicit capabilities through `tools` and
`dependencies.tools`; transition handlers use those ports while constraint maps
stay pure.

## Problem

Actor-Web currently has the right primitives, but the developer experience still
forces too much manual wiring:

- XState can constrain legal lifecycle transitions for richer statecharts.
- Actor-Web FSM maps can constrain simple workflows without requiring XState.
- `defineActor().withMachine(...)` can attach a machine to an actor behavior.
- `defineActor().onMessage(...)` can handle commands, emit events, and call
  tools.
- Topology can declare runtime ownership and required tools.

The missing layer is a clear way to say:

> For each constrained event/command transition, run this Actor-Web handler with
> a narrowed message type, actor dependencies, and tool access.

Without that layer, developers duplicate lifecycle knowledge between the
constraint map and `onMessage(...)`.

## Design Goal

Keep constraint maps as the source of truth for lifecycle legality. Actor-Web
should add ergonomics around XState and a small native FSM map, not move I/O or
business side effects into the constraint layer.

```text
XState or withFSM owns:
- states
- legal transitions
- guards
- transition metadata

XState additionally owns:
- delayed/transient transitions
- invoked services
- richer statechart behavior where needed

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

For a small pure FSM constraint map:

```ts
const shipmentFSM = defineFSM<ShipmentCommand, ShipmentContext, ShipmentStatus>({
  initial: 'idle',
  states: {
    idle: {
      on: {
        CREATE_SHIPMENT: 'route-requested',
      },
    },
    'route-requested': {
      on: {
        ASSIGN_ROUTE: 'route-assigned',
      },
    },
  },
});

export const createShipmentBehavior = () =>
  defineActor<ShipmentCommand>()
    .withContext(createInitialShipmentContext())
    .withFSM(shipmentFSM)
    .onTransition({
      CREATE_SHIPMENT: async ({ context, message }) => ({
        context: {
          ...context,
          shipmentId: message.shipmentId,
          status: 'route-requested',
        },
        emit: [{ type: 'SHIPMENT_CREATED', shipmentId: message.shipmentId }],
      }),
    })
    .build();
```

For a richer XState statechart:

```ts
export const createShipmentBehavior = () =>
  defineActor<ShipmentCommand>()
    .withMachine(shipmentMachine)
    .onTransition({
      CREATE_SHIPMENT: async ({ context, message }) => ({
        context: {
          ...context,
          shipmentId: message.shipmentId,
        },
        emit: [{ type: 'SHIPMENT_CREATED', shipmentId: message.shipmentId }],
      }),

      SCAN_LABEL: async ({ message, tools }) => {
        const scan = await tools.execute('provider.scan.verify', message);

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

Handlers receive the current context directly. Use `context` for normal domain
state updates, `tools` for ports/adapters, `dependencies` for runtime
integration, and `actor` only when runtime actor capabilities are needed.

```ts
SCAN_LABEL: async ({ context, message, tools, actor }) => {
  context.status;
  message.scanId;
  await tools.execute('provider.scan.verify', message);
  actor.getSnapshot();
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

`onTransition(...)` routes incoming messages through a constraint-aware handler
table. It requires exactly one constraint source: `.withMachine(...)` or
`.withFSM(...)`.

Recommended behavior:

1. Receive an actor message.
2. Check whether the XState machine or FSM map can accept the event.
3. If the transition is invalid, return a structured error value and emit a
   rejected-transition event.
4. If a matching transition handler exists, run it.
5. Let the existing actor behavior pipeline apply context, emit events, replies,
   and message plans.
6. If no transition handler exists, optionally fall back to `onMessage(...)`
   when one is also defined.

The fallback lets teams migrate from manual `onMessage(...)` to
`onTransition(...)` incrementally.

## Invalid Transition Result

Domain invalid transitions follow errors-as-values. They do not throw by
default.

```ts
{
  ok: false,
  error: {
    code: 'INVALID_TRANSITION',
    messageType: 'SCAN_LABEL',
    state: 'idle',
    allowedTransitions: ['CREATE_SHIPMENT'],
  },
}
```

The runtime also emits an `ACTOR_TRANSITION_REJECTED` diagnostic event. Thrown
errors are reserved for invalid actor definitions:

- `onTransition(...)` without `.withMachine(...)` or `.withFSM(...)`,
- using `.withMachine(...)` and `.withFSM(...)` together,
- malformed FSM definitions.

## Tool Port Integration

Tool calls stay inside transition handlers, never inside constraint maps:

```ts
SCAN_LABEL: async ({ message, tools }) => {
  const scan = await tools.execute('provider.scan.verify', message);

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

## Implementation Status

Implemented:

- `defineActor().withMachine(...).onTransition(...)` for typed transition
  handler maps.
- `defineFSM(...)` and `defineActor().withFSM(...)` for lightweight pure
  constraint maps.
- Handler key inference from the command union passed to `defineActor<T>()`.
- Handler `message` narrowing by transition key.
- Runtime XState and FSM legality checks before transition handler side effects.
- Structured invalid-transition values instead of default domain throws.
- `onMessage(...)` fallback for messages without transition handlers.
- Public FSM and transition handler types from `@actor-web/runtime` and
  `@actor-web/runtime/browser`.
- Logistics shipment actor migrated to `withFSM(...).onTransition(...)`.

Still remaining:

- Transition metadata projection for UI/tooling.
- FAS agent lifecycle prototype using XState constraints and actor tools.

## Implementation Slices

### Slice 1: Builder API

- Status: implemented.
- Added `onTransition(...)` to `UnifiedActorBuilder`.
- Typed handler keys from `TMessage['type']`.
- Narrowed handler `message` by transition key.
- Preserved current `onMessage(...)` support.
- Routed incoming messages to transition handlers at runtime.
- Added unit tests for runtime handler execution and fallback behavior.

### Slice 2: XState Validation

- Status: implemented.
- Detects whether the attached machine can accept a message.
- Returns invalid transition values before running side effects.
- Includes invalid-transition tests.
- Keep validation runtime-first; compile-time machine event validation can come
  later.

### Slice 2.5: Actor-Web FSM Constraint Maps

- Status: implemented.
- Added `defineFSM(...)`.
- Added `withFSM(...)`.
- Disallowed mixing `.withMachine(...)` and `.withFSM(...)`.
- Disallowed `onTransition(...)` without a constraint source.
- Converted the logistics shipment actor to `withFSM(...).onTransition(...)`.

### Slice 3: Metadata Projection

- Preserve transition metadata on built behaviors.
- Expose helper APIs for allowed transition inspection.
- Use the metadata in docs/example UI only after the behavior API is stable.

### Slice 4: Logistics Example Migration

- Status: implemented for the shipment actor with `withFSM(...)`.
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
- Do not make the native FSM a full statechart engine.
- Do not require every actor to use a machine.
- Do not generate UI controls in the first slice.
- Do not make FAS-specific APIs part of Actor-Web runtime.

## Open Questions

- How much transition metadata should be projected to Ignite Element and agent
  planning UIs?
- Should required tools remain actor-level only, or should optional
  transition-level metadata be supported later for planning and approval UIs?
- Should FSM state be inspectable through actor snapshots, or should domain
  context remain the projection source for now?
- What stable event contract should `ACTOR_TRANSITION_REJECTED` use once
  transition diagnostics become public API?
