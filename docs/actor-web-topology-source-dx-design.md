# Actor-Web Topology Source DX Design

## Summary

Actor-Web should support two source-authoring paths for Ignite Element:

- Shared TypeScript topology for the best developer experience:
  `source: logistics.actors.shipment.source()`.
- Address-based source creation for separate repositories, generated clients, or
  non-TypeScript consumers:
  `createActorWebSource({ address, contractVersion, gateway })`.

Both paths should preserve hexagonal architecture and actor model topology. The
topology stays explicit, actors own behavior, adapters own boundaries, and
Ignite Element owns projection/rendering.

## Goals

- Make Actor-Web sources plug-and-play with `igniteCore`, similar to XState,
  Redux, and MobX sources.
- Avoid explicit user-facing generics such as
  `createActorWebSource<Context, Command, Event>(...)`.
- Keep runtime ownership visible instead of hiding distributed topology behind
  stringly typed UI code.
- Support monorepos, published shared contract packages, and separate repos that
  consume generated contract metadata.
- Keep Node-only APIs out of browser bundles through package boundaries.

## Non-Goals

- This design does not define new delivery guarantees.
- This design does not add auth, durable replay, discovery, or backpressure.
- This design does not make browser hosts implicit runtime cluster members.
- This design does not require every product to use a monorepo.

## Architecture Layers

Actor-Web examples and product apps should map files to these layers:

- Domain contract: commands, events, context, value objects, and actor IDs.
- Actor behavior: `defineActor(...)` state transitions and actor-to-actor
  messaging.
- Topology: runtime nodes, actor ownership, addresses, and gateway scopes.
- Supervision: restart policies and process groups for actors that should fail,
  recover, and be reasoned about together.
- Ports: REST commands, gateway projections, provider/external ingress.
- Adapters: Node server, browser gateway client, worker runtime, service worker,
  and transport implementations.
- Projection: Ignite-compatible source state and view models.
- Presentation: `igniteCore` components and Ignite JSX rendering.
- Operations: telemetry, auth, replay, queues, deployment, and health.

The topology is shared and declarative. It can be imported by browser, server,
worker, and tests, but it must not start servers, open sockets, read secrets, or
bind ports at import time.

## Package Boundaries

Recommended public API boundaries:

```ts
// Shared, browser-safe topology declarations.
import { actor, defineActorWebTopology, node, tool } from '@actor-core/runtime/topology';

// Browser/presentation source creation and browser worker runtime hosting.
import { createActorWebSource, startActorWebNode } from '@actor-core/runtime/browser';

// Node/server runtime hosting and HTTP ingress adapters.
import { serveActorWebHttp, serveActorWebNode } from '@actor-core/runtime/node';

// Ignite Element authoring over Actor-Web sources.
import { igniteCore } from 'ignite-element/actor-web';
```

The exact package names can evolve, but the import line should make the runtime
side obvious.

Current implementation status:

- `@actor-core/runtime/topology` exports the browser-safe topology declaration
  helpers, descriptor types, and actor descriptor `.source(...)` convenience.
- `@actor-core/runtime/browser` exports `createActorWebSource` for gateway-backed
  Ignite-compatible projection/control sources.
- `@actor-core/runtime/node` exports `serveActorWebNode` for topology-owned
  Node/server runtime hosting.
- `@actor-core/runtime/node` exports `serveActorWebHttp` for route-first HTTP
  adapters around a served node.
- `@actor-core/runtime/browser` exports `startActorWebNode` for topology-owned
  browser worker runtime hosting.
- `ignite-element/actor-web` is the first-class Ignite Element adapter entrypoint
  for Actor-Web sources.
- The current example uses topology actor `.source(...)` for server gateway
  sources and keeps only the harness code needed for in-memory/service-worker
  fallback behavior.

## Primary Path: Shared TypeScript Topology

Use this path when frontend, backend, workers, and tests can import the same
TypeScript contract. This is the recommended monorepo and shared package DX.

```ts
// logistics.topology.ts
import { actor, defineActorWebTopology, node, tool } from '@actor-core/runtime/topology';
import { createRoutingBehavior } from './actors/routing.actor';
import { createShipmentBehavior } from './actors/shipment.actor';

export const logistics = defineActorWebTopology({
  contractVersion: '1.4.0',

  tools: [tool('route.plan')],

  nodes: {
    browser: node('logistics-browser-host'),
    server: node('logistics-server-runtime'),
    worker: node('logistics-worker-runtime'),
  },

  actors: {
    shipment: actor({
      id: 'logistics-shipment',
      node: 'server',
      behavior: createShipmentBehavior,
      tools: ['route.plan'],
      supervision: {
        strategy: 'restart',
        maxRestarts: 3,
        withinMs: 60_000,
      },
      gateway: {
        scope: { kind: 'logistics-shipment' },
      },
    }),

    routing: actor({
      id: 'logistics-routing',
      node: 'worker',
      behavior: createRoutingBehavior,
      gateway: {
        scope: { kind: 'logistics-routing' },
      },
    }),
  },

  supervisors: {
    logistics: supervisor({
      node: 'server',
      children: ['shipment'],
    }),

    workerServices: supervisor({
      node: 'worker',
      children: ['routing'],
    }),
  },
});
```

The Ignite component consumes the actor source without explicit generics:

```tsx
// logistics-control-tower.element.tsx
/** @jsxImportSource ignite-element/jsx */

import 'ignite-element/renderers/ignite-jsx';

import { igniteCore } from 'ignite-element/actor-web';
import { logistics } from './logistics.topology';

const logisticsControlTower = igniteCore({
  source: logistics.actors.shipment.source({
    gateway: {
      url: import.meta.env.VITE_ACTOR_WEB_GATEWAY_URL,
    },
  }),

  states: ({ context, transport }) => ({
    status: context.status,
    shipmentId: context.shipmentId,
    destination: context.destination,
    carrier: context.carrier ?? 'pending',
    eta: context.eta ?? 'pending',
    connected: transport.state === 'connected',
  }),

  commands: ({ actor }) => ({
    createShipment: (input: { destination: string; reference?: string }) =>
      actor.send({
        type: 'CREATE_SHIPMENT',
        shipmentId: `shipment-${Date.now().toString(36)}`,
        destination: input.destination,
        reference: input.reference,
      }),

    reset: () => actor.send({ type: 'RESET_SHIPMENT' }),
  }),
});

logisticsControlTower('aw-logistics-control-tower', ({ state, commands }) => (
  <main>
    <h1>Logistics Control Tower</h1>
    <button
      onClick={() =>
        commands.createShipment({
          destination: 'Chicago warehouse',
          reference: 'REF-1001',
        })
      }
    >
      Create shipment
    </button>
    <p>{state.status}</p>
  </main>
));
```

The Node server runs one node from the same topology:

```ts
// server.ts
import { serveActorWebNode } from '@actor-core/runtime/node';
import { logistics } from './logistics.topology';

const server = await serveActorWebNode(logistics, {
  node: 'server',
  gateway: true,
  transport: true,
});

const http = await serveActorWebHttp(server)
  .for(logistics.actors.shipment)
  .post('/shipments', async (request, response, { actor }) => {
    const body = request.body as { shipmentId?: string; destination?: string };
    if (!body.destination) {
      return response.badRequest({ error: 'destination is required' });
    }

    const shipmentId = body.shipmentId ?? `shipment-${Date.now().toString(36)}`;
    await actor.send({
      type: 'CREATE_SHIPMENT',
      shipmentId,
      destination: body.destination,
    });

    return response.accepted({ shipmentId });
  })
  .get('/shipments/count', async (_request, response, { actor }) => {
    const count = await actor.ask<number>({ type: 'GET_SHIPMENT_COUNT' });
    return response.ok({ count });
  })
  .listen({ port: 4100 });

console.log(http.url);
```

REST, provider callbacks, and other ingress ports remain app-owned adapters,
but `serveActorWebHttp(server)` removes the repeated Node HTTP boilerplate. The
handler shape is `(request, response, actorWeb)`: `request` is HTTP data,
`response` owns JSON/status helpers, and `actorWeb` exposes `runtime`,
`actors`, plus inferred `actor` inside `.for(actorDescriptor)` routes.

The browser worker runs another node:

```ts
// worker-runtime.ts
import { startActorWebNode } from '@actor-core/runtime/browser';
import { logistics } from './logistics.topology';

const transportUrl = new URL(self.location.href).searchParams.get('transportUrl') ?? '';

startActorWebNode(logistics, {
  node: 'worker',
  peers: {
    server: transportUrl,
  },
  transport: {
    heartbeatIntervalMs: 5000,
  },
});
```

## Fallback Path: Address-Based Sources

Use this path when the UI cannot import the shared TypeScript topology:

- frontend and backend live in separate repositories,
- the consumer is generated from contract metadata,
- the consumer is not TypeScript,
- the UI only knows a deployed actor address and gateway URL.

```ts
import { createActorWebSource } from '@actor-core/runtime/browser';

const shipmentSource = createActorWebSource({
  address: 'actor://logistics-server-runtime/actor/logistics-shipment',
  contractVersion: '1.4.0',
  gateway: {
    url: import.meta.env.VITE_ACTOR_WEB_GATEWAY_URL,
  },
});
```

This source can still be passed to `igniteCore`:

```tsx
const logisticsControlTower = igniteCore({
  source: shipmentSource,

  states: ({ context, transport }) => ({
    status: context.status,
    shipmentId: context.shipmentId,
    connected: transport.state === 'connected',
  }),
});
```

When the source is address-based, typing is only as strong as the generated
client or manually supplied contract metadata. This path should be supported,
but the shared topology path remains the preferred DX.

## Generated Client Path

For polyrepo or cross-language teams, a backend or contract repo can generate a
client package:

```ts
// generated/logistics.actor-client.ts
export const logistics = defineGeneratedActorWebClient({
  contractVersion: '1.4.0',

  actors: {
    shipment: {
      address: 'actor://logistics-server-runtime/actor/logistics-shipment',
      gatewayScope: { kind: 'logistics-shipment' },
      commands: ['CREATE_SHIPMENT', 'RESET_SHIPMENT'],
      events: ['SHIPMENT_CREATED', 'SHIPMENT_RESET'],
    },
  },
});
```

Consumer code remains close to the shared topology path:

```ts
const source = logistics.actors.shipment.source({
  gateway: {
    url: import.meta.env.VITE_ACTOR_WEB_GATEWAY_URL,
  },
});
```

## Type Inference Rule

The user-facing API should infer `Context`, `Command`, and `Event` from the
actor source. Developers should not need to write:

```ts
createActorWebSource<ShipmentContext, ShipmentCommand, ShipmentEvent>(/* ... */);
```

Inference should flow from:

- topology actor definitions,
- generated contract client metadata,
- or an explicitly typed imported source.

If a consumer only passes a raw actor address, the resulting source may be typed
as `unknown` context/command/event unless generated metadata is provided.

## How This Relates To XState, Redux, And MobX

The Ignite Element authoring shape should stay familiar:

```ts
igniteCore({
  source,
  states,
  commands,
});
```

Actor-Web differs because `source` may be remote and distributed. That means
topology remains a first-class concept. The similarity is at the component
boundary; the distinction is in how the source is declared and connected.

| Source type | What it represents | Ignite API shape |
| --- | --- | --- |
| XState | local or provided machine/actor | `igniteCore({ source: machine })` |
| Redux | local store or slice | `igniteCore({ source: store })` |
| MobX | local observable object | `igniteCore({ source: store })` |
| Actor-Web | local or remote actor projection/control port | `igniteCore({ source: topology.actors.shipment.source(options) })` |

## Naming Decisions

Recommended API names:

- `defineActorWebTopology`: declares shared runtime topology.
- `supervisor`: declares a supervised actor group.
- `serveActorWebNode`: starts a Node/server runtime node.
- `serveActorWebHttp`: starts a Node HTTP adapter around a served runtime node.
- `startActorWebNode`: starts a browser worker runtime node.
- `createActorWebSource`: creates a browser-safe projection/control source.
- `igniteCore` from `ignite-element/actor-web`: authoring surface for Actor-Web
  components.

Avoid naming the shared declaration `defineActorWebApp` if it suggests it starts
or owns the whole application. The topology is a map, not a running process.

## Usage Guidance

Use shared topology when:

- frontend/backend are in a monorepo,
- both repos can depend on the same published TypeScript contract package,
- strong typing and topology-aware DX matter most.

Use address-based source creation when:

- the UI cannot import backend/shared TypeScript code,
- the source comes from generated metadata,
- the integration boundary is a deployed actor address and gateway URL.

Use `serveActorWebNode` only in Node/server entrypoints.

Use `serveActorWebHttp` only in Node/server entrypoints that need HTTP ingress.

Use `startActorWebNode` only in browser worker entrypoints.

Use `topology.actors.name.source(options)` in browser presentation code when a
shared topology is available.

Use `createActorWebSource({ address, contractVersion, gateway })` when the UI
cannot import shared topology metadata.

## AI And Agentic Workflow Alignment

Actor-Web topology should support AI agents as normal actor workloads. An AI
agent should not require a separate runtime model; it should be an actor with
isolated state, explicit messages, emitted events, supervision, and topology.

```ts
import { actor, defineActorWebTopology, node, supervisor, tool } from '@actor-core/runtime/topology';

export const fas = defineActorWebTopology({
  contractVersion: '1.0.0',

  nodes: {
    coordinator: node('fas-coordinator-runtime'),
    worker: node('fas-agent-worker-runtime'),
    browser: node('fas-dashboard-host'),
  },

  actors: {
    taskRun: actor({
      id: 'fas-task-run',
      node: 'coordinator',
      behavior: createTaskRunBehavior,
      supervision: {
        strategy: 'restart',
        maxRestarts: 3,
        withinMs: 60_000,
      },
    }),

    plannerAgent: actor({
      id: 'fas-planner-agent',
      node: 'worker',
      behavior: createPlannerAgentBehavior,
      tools: [
        tool('repo.search', { description: 'Search indexed repository context.' }),
        tool('fas.memory.read', { description: 'Read scoped FAS memory.' }),
      ],
      supervision: {
        strategy: 'restart',
        maxRestarts: 2,
        withinMs: 60_000,
      },
    }),

    verifierAgent: actor({
      id: 'fas-verifier-agent',
      node: 'worker',
      behavior: createVerifierAgentBehavior,
      tools: [
        tool('verification.run', { description: 'Run approved verification commands.' }),
      ],
      supervision: {
        strategy: 'restart',
        maxRestarts: 2,
        withinMs: 60_000,
      },
    }),
  },

  supervisors: {
    fasWorkflow: supervisor({
      node: 'coordinator',
      strategy: 'one-for-one',
      children: ['taskRun'],
    }),

    agentWorkers: supervisor({
      node: 'worker',
      strategy: 'one-for-one',
      children: ['plannerAgent', 'verifierAgent'],
    }),
  },
});
```

Tool declarations are required ports, not implementations. A runtime entrypoint
provides the concrete adapters when it starts a node:

```ts
await startActorWebNode(fas, {
  node: 'worker',
  tools: {
    'repo.search': repoSearchAdapter,
    'fas.memory.read': fasMemoryReadAdapter,
    'verification.run': verificationRunAdapter,
  },
});
```

Agent behaviors access those ports through runtime dependencies:

```ts
const createPlannerAgentBehavior = () =>
  defineActor<PlannerMessage>()
    .withContext(initialPlannerContext)
    .onMessage(async ({ message, dependencies }) => {
      if (message.type === 'PLAN_TASK') {
        const context = await dependencies.tools.execute('repo.search', {
          query: message.task,
        });

        return {
          reply: { context },
        };
      }
    })
    .build();
```

This keeps agentic workflow aligned with the same architecture used by product
apps:

- Agents are actors, not hidden callbacks.
- Agent commands are typed messages.
- Agent decisions and tool results are emitted events.
- Tool integrations are hexagonal ports/adapters.
- Human approvals are explicit messages and state transitions.
- Agent failures flow through supervision and telemetry.
- Dashboards consume live projections through Ignite Element sources.

FAS is a natural consumer of this model. FAS roles such as planner,
implementer, verifier, reviewer, SRE, memory, and documenter can map to actors
or supervised actor groups. A FAS dashboard can project task state through:

```ts
const fasTaskPanel = igniteCore({
  source: fas.actors.taskRun.source(),

  states: ({ context, transport }) => ({
    phase: context.phase,
    activeAgent: context.activeAgent,
    findings: context.reviewFindings,
    waitingForApproval: context.waitingForApproval,
    connected: transport.state === 'connected',
  }),
});
```

The long-term direction is for FAS agent runtimes to run on Actor-Web nodes, use
Actor-Web messages for role coordination, and expose live workflow projections
to Ignite Element UIs. That gives FAS replayable workflow history, supervised
agent execution, human approval boundaries, topology-aware deployment, and
real-time operational dashboards.

## Open Questions

- Should generated/source-enabled topology clients expose
  `topology.actors.shipment.source()`, or should all runtime configuration stay
  explicit through `createActorWebSource(actor, options)`?
- Should actor supervision start as metadata only, or should the first topology
  implementation enforce restart strategy immediately?
- Should supervisor groups map directly to runtime supervisor actors, or remain
  declarative process groups until the runtime supervision API is hardened?
- Should generated clients include runtime command/event validators, or only
  TypeScript types and metadata?
- Should FAS agents be modeled as one actor per conceptual role, one actor per
  task lease, or a hybrid where role actors supervise task-run child actors?
- Should AI tool calls be actors, ports, or both depending on whether the tool
  owns durable state?
- Should actor behavior live in the shared topology package, or should topology
  reference behavior factories only in server/worker builds through conditional
  exports?
- How should `ignite-element/actor-web` be packaged so it does not pull Node-only
  runtime code into browser bundles?
