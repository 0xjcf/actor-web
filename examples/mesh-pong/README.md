# Mesh Pong (target-state example)

> Status: target-state design. This example is built by the queued task
> "Build three-mode Mesh Pong example", which depends on the new transport
> packages. Until those land, treat this README as the contract the example
> must satisfy — not as shipped code. (Same convention as
> `docs/examples/ignite-element-*north-star.md`.)

## What it proves

One set of actor definitions runs **unchanged** across every transport and
topology. Pong is the proof: the ball, paddle, and score behaviors are written
once; only the transport passed at startup changes. This is the executable
guard for the topology-independence guarantee from spike
`direct-1781363862864`.

## The invariant — define once

```ts
import { actor, defineActorWebTopology, node } from '@actor-web/runtime/topology';
import { ballBehavior, paddleBehavior, scoreBehavior } from './pong-behaviors';

export const pong = defineActorWebTopology({
  nodes: {
    server: node('actor://server'),
    a: node('actor://a'),
    b: node('actor://b'),
  },
  actors: {
    ball:    actor({ id: 'ball',    node: 'server', behavior: ballBehavior }),
    score:   actor({ id: 'score',   node: 'server', behavior: scoreBehavior }),
    paddleA: actor({ id: 'paddleA', node: 'a',      behavior: paddleBehavior }),
    paddleB: actor({ id: 'paddleB', node: 'b',      behavior: paddleBehavior }),
  },
  subscriptions: [{ from: 'ball', to: ['score'], events: ['SCORED'] }],
});
```

## The only line that changes — pick a transport

```ts
// local — one process, no transport
await startRuntime(pong);

// websocket — client ↔ server
await startActorWebNode(pong, { node: 'a', transport: webSocketTransport({ url: 'wss://host' }) });

// broadcast-channel — same-origin tabs, no server
await startActorWebNode(pong, { node: 'a', transport: broadcastChannelTransport({ channel: 'pong' }) });

// mesh — peer-to-peer, gossip + relay, no server
await startActorWebNode(pong, { node: 'a', transport: meshTransport({ seeds: ['wss://seed1'] }) });
```

## The transports — one line each (`defineTransport`)

A transport author hands `defineTransport` the raw medium object; the framework's
`fromDuplex` normalizer adapts any `postMessage`/`onmessage`/`close` duplex.

```ts
export const broadcastChannelTransport = defineTransport(({ channel }) => new BroadcastChannel(channel));
export const webSocketTransport        = defineTransport(({ url })     => new WebSocket(url));
export const workerTransport           = defineTransport(({ port })    => port);

// only multi-peer servers opt into the richer form:
export const webSocketServerTransport  = defineTransport.server(({ wss }) => ({
  listen: (onPeer) => wss.on('connection', (sock) => onPeer(sock)),
}));
```

## Planned file layout

```
examples/mesh-pong/
  README.md                 this design doc
  pong-behaviors.ts         ball / paddle / score behaviors (transport-agnostic)
  pong-topology.ts          the shared defineActorWebTopology
  modes/
    local.ts                startRuntime(pong)
    websocket.ts            webSocketTransport
    broadcast.ts            broadcastChannelTransport
    mesh.ts                 meshTransport
  ui/
    index.html              the playable demo + transport switcher
    pong-canvas.ts          renders snapshots from the score/ball actors
  mesh-pong.test.ts         headless behavior-parity test (the validation gate)
```

## Validation strategy

The example is two deliverables: a human-facing demo and an automated gate.

1. **Behavior-parity test** (`mesh-pong.test.ts`) — the real validation. Drive
   the *same* topology with a deterministic ball seed across `local`,
   `broadcast-channel`, and `websocket` (loopback) transports, and assert the
   observable score sequence is identical across all three. This is what proves
   the actors are transport-independent; it must run in CI.
2. **UI demo** (`ui/`) — a playable Pong with a transport switcher (local /
   websocket / broadcast / mesh). Mirrors the interactive showcase from the
   spike. Manual/visual confirmation only.

Acceptance:

- The ball / paddle / score behaviors import no transport, runtime, or topology
  module — only `defineBehavior` and message/event types.
- Switching transport changes exactly one line at each startup site; zero
  changes to `pong-behaviors.ts` or `pong-topology.ts` across modes.
- The parity test passes for local, broadcast, and websocket.
- Mesh mode runs the demo across 3 peers with no server process.

## Depends on

Built after the transports it exercises land: the shared transport core
(`defineTransport` + `fromDuplex`), `@actor-web/transport-broadcast-channel`, and
`@actor-web/labs-mesh` (websocket already exists). `@actor-web/transport-webrtc` is a
sibling transport validated by its own package tests, not gated by this example.
