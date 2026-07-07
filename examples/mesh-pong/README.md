# Mesh Pong

> Status: shipped example. The automated validation gate is
> `examples/mesh-pong/mesh-pong.test.ts`; the playable demo is
> `examples/mesh-pong/ui/index.html`.

## What it proves

One set of actor definitions runs unchanged across every transport and
topology. Pong is the proof: the ball, paddle, and score behaviors are written
once; only the startup mode changes. This is the executable guard for the
topology-independence guarantee from spike `direct-1781363862864`.

## The invariant — define once

```ts
import { actor, defineActorWebTopology, node } from '@actor-web/runtime/topology';
import { ballBehavior, createPaddleBehavior, scoreBehavior } from './pong-behaviors';

export const pong = defineActorWebTopology({
  nodes: {
    server: node('pong-server'),
    a: node('pong-a'),
    b: node('pong-b'),
  },
  actors: {
    ball: actor({ id: 'ball', node: 'server', behavior: ballBehavior }),
    score: actor({ id: 'score', node: 'server', behavior: scoreBehavior }),
    paddleA: actor({ id: 'paddle-a', node: 'a', behavior: createPaddleBehavior('left') }),
    paddleB: actor({ id: 'paddle-b', node: 'b', behavior: createPaddleBehavior('right') }),
  },
  subscriptions: [{ from: 'ball', to: ['score'], events: ['SCORED'] }],
});
```

## The only line that changes

```ts
// local — one process, no transport
await startMeshPongLocal();

// websocket — loopback nodes for the parity gate
await startMeshPongWebSocketLoopback();

// broadcast-channel — same-origin tabs, no server
await startMeshPongBroadcast({ channelName: 'pong' });

// mesh — labs-mesh overlay on no-server BroadcastChannel peers
await startMeshPongMesh({ channelName: 'pong-mesh' });
```

The example keeps transport-specific code in `modes/`. `pong-behaviors.ts` and
`pong-topology.ts` do not change between local, BroadcastChannel, WebSocket, and
mesh-demo execution.

## File layout

```text
examples/mesh-pong/
  README.md                 this file
  pong-contract.ts          message/event types and deterministic Pong rules
  pong-behaviors.ts         ball / paddle / score behaviors (transport-agnostic)
  pong-topology.ts          the shared defineActorWebTopology
  parity-proof.ts           data rendered by the UI proof panel
  modes/
    local.ts                startRuntime(pong)
    websocket.ts            serveNode loopback transport
    broadcast.ts            broadcastChannelTransport
    mesh.ts                 labs-mesh overlay + no-server BroadcastChannel peers
  ui/
    index.html              the playable demo + transport switcher
    main.ts                 browser runtime driver
    pong-canvas.ts          renders snapshots from the score/ball actors
  mesh-pong.test.ts         headless behavior-parity test (the validation gate)
```

## Validation strategy

The example is two deliverables: a human-facing demo and an automated gate.

1. **Behavior-parity test** (`mesh-pong.test.ts`) — the real validation. It
   drives the same topology with a deterministic ball seed across `local`,
   `broadcast-channel`, and `websocket` loopback runtimes, resolves remote
   paddle actors from the server node, and asserts the observable score sequence
   is identical across all three. This is what proves the actors are
   transport-independent; it runs in CI through `pnpm test:examples`.
2. **UI demo** (`ui/`) — a playable Pong with a transport switcher (local /
   broadcast / mesh). The page renders the shared topology/behavior files, the
   selected startup module, and the parity-status panel so the validation
   result is visible while switching transports. It does not run the CI gate;
   `mesh-pong.test.ts` remains the runtime-agnostic parity test executed by
   `pnpm test:examples`. WebSocket loopback is automated in that test because
   browser WebSocket nodes need an external listener.

Acceptance:

- The ball / paddle / score behaviors import no transport, runtime, or topology
  module — only `defineBehavior` and message/event types.
- Switching mode changes exactly one startup call; zero
  changes to `pong-behaviors.ts` or `pong-topology.ts` across modes.
- The parity test passes for local, broadcast, and websocket.
- Mesh mode runs the demo across 3 peers with no server process.

## Depends on

Built after the transports it exercises land: shared transport core,
BroadcastChannel transport, WebSocket transport, and `@actor-web/labs-mesh`.
Current `@actor-web/labs-mesh` exposes membership/directory/routing overlay
APIs rather than a public `meshTransport` factory, so this example's mesh mode
uses the no-server BroadcastChannel transport plus labs-mesh overlay state.
