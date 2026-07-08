# Mesh Pong

> Status: shipped example. The automated validation gate is
> `examples/mesh-pong/mesh-pong.test.ts`; the playable demo is
> `examples/mesh-pong/ui/index.html`.

Mesh Pong now covers one human plus one MLX controller, full MLX-vs-MLX play,
and a deterministic fake-provider CI lane for the `llm` tool boundary. The
browser loop now treats MLX as two independent per-side intent lanes, so slow
model turns no longer pause simulation or rendering.

## Recommended local benchmark path

The recommended operator benchmark path stays intentionally small and uses the
same provider shape that is covered by in-repo tests:

- One OpenAI-compatible MLX endpoint shared by both sides.
- One model setting for both controller actors.
- Browser-side telemetry plus the benchmark summary reducer in `ui/main.ts` for
  deterministic latency, throughput, timeout, and gameplay-effect reporting.

Start a local MLX server on the endpoint the example already supports:

```bash
python -m mlx_lm.server \
  --model mlx-community/Llama-3.2-3B-Instruct-4bit \
  --host 127.0.0.1 \
  --port 8080
```

Start the example with the same single-endpoint configuration:

```bash
VITE_MESH_PONG_MLX_ENABLED=true \
VITE_MESH_PONG_MLX_ENDPOINT=http://127.0.0.1:8080/v1 \
VITE_MESH_PONG_MLX_MODEL=mlx-community/Llama-3.2-3B-Instruct-4bit \
pnpm examples:dev:local
```

Open the local examples app, switch to Mesh Pong, and use either:

- One-player: one human side plus one `mlx` side.
- MLX-vs-MLX: both sides set to `mlx` to observe shared-endpoint contention.

Supported overrides remain exactly the existing provider keys, with
`localStorage` taking precedence over Vite env vars:

- `actor-web.mesh-pong.mlx.enabled` or `VITE_MESH_PONG_MLX_ENABLED`
- `actor-web.mesh-pong.mlx.endpoint` or `VITE_MESH_PONG_MLX_ENDPOINT`
- `actor-web.mesh-pong.mlx.model` or `VITE_MESH_PONG_MLX_MODEL`
- `actor-web.mesh-pong.mlx.api-key` or `VITE_MESH_PONG_MLX_API_KEY`

Defaults:

- enabled: `false`
- endpoint: `http://127.0.0.1:8080/v1`
- model: `mlx-community/Llama-3.2-3B-Instruct-4bit`

## Benchmark summary

The browser sidebar now shows both the raw telemetry lanes and a compact
benchmark summary string derived only from telemetry events. The summary reports
these deterministic metrics:

- controller started / finished / timeouts
- latency count / total / min / max / average
- controller throughput per second
- simulation scheduled / applied / held / dropped
- applied simulation turns per second
- timeout rate
- gameplay effect classification: `stalled`, `timeout-bound`, `laggy`, or `smooth`

Evidence boundary:

- Deterministic in-repo evidence covers the summary reducer, browser shell
  wiring, one-player telemetry, MLX-vs-MLX telemetry, timeout classification,
  and fake-provider behavior without a live MLX server.
- Manual local benchmark evidence should be collected by running the
  single-endpoint procedure above with the current default model and endpoint.
  This sandbox did not run a live MLX benchmark.
- The model/server strategy for the example remains single-endpoint until live
  evidence shows that a dual-server setup improves local play.

Deterministic benchmark scenarios:

| Scenario | Settings | Expected summary signal | Interpretation |
| --- | --- | --- | --- |
| One-player, synthetic provider | `playerCount=1`, one side `mlx`, one side human | `effect smooth` when controller latency stays under the `90ms` simulation budget and held/dropped stay near zero | Proves the summary path for the default local demo shape without requiring MLX |
| MLX-vs-MLX, synthetic provider | `playerCount=2`, both sides `mlx` | `effect timeout-bound` or `effect laggy` once average latency rises above budget, held/dropped turns accumulate, or controller timeouts appear | Proves the shared-endpoint stress summary without requiring MLX |
| Synthetic CI lane | fake provider or rejected controller promise in `mesh-pong.test.ts` | `timeouts 1` and deterministic summary output with no live MLX | Keeps CI live-MLX-free while proving the reducer and shell wiring |

Decision for this task: keep the single shared endpoint path and defer
per-side endpoint/model configuration plus a two-server strategy. The current
example only exposes one browser-local provider config in `mlx-provider.ts`, and
there is no clean side-specific provider seam yet. There is also no in-repo or
live benchmark evidence in this task showing that per-side endpoints improve
local play, so adding dual routing here would widen the adapter contract before
the evidence supports it.

## Lag budget telemetry

The demo sidebar now exposes shell-local telemetry so lag can be attributed
before changing scheduling:

- `Render` shows snapshot render cadence and the last snapshot gap.
- `Simulation` tracks the fixed `90ms` turn budget, total scheduled turns,
  applied turns, held turns, dropped turns, and the latest scheduling/applied
  gaps.
- `Left control` / `Right control` show whether an MLX turn is in flight, the
  latest controller RTT, the outcome, and the age of the last applied intent.
- `Replay` shows the last cross-tab controller-input replay latency when a tab
  re-applies another tab's input.

Interpretation:

- `held` should stay near zero during normal MLX play because the owner tick now
  advances while each side keeps at most one local-model request in flight.
- High `dropped` means the browser missed one or more `90ms` simulation slots,
  calculated as `floor(gapMs / 90) - 1`.
- High controller `rtt` points to model/provider latency.
- High MLX intent `age` includes local model decision time; replay latency
  points to broadcast/replay delay after the controller already decided. Local
  human input is applied immediately in the shell, so its intent age is usually
  near zero.
- When a fresh MLX result is late, the owner reuses the last known intent for a
  small bounded number of turns, then falls back to a no-op until a new result
  arrives.

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
    lobby: actor({ id: 'lobby', node: 'server', behavior: lobbyBehavior }),
    playerSession: actor({
      id: createPlayerSessionActorId,
      node: 'server',
      behavior: createPlayerSessionBehavior,
    }),
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
mesh-demo execution. MLX prompt construction, provider calls, and response
parsing live in `pong-controller.ts`, outside the deterministic Pong rules.

## File layout

```text
examples/mesh-pong/
  README.md                 this file
  pong-contract.ts          message/event types and deterministic Pong rules
  pong-behaviors.ts         ball / paddle / score / session / lobby behaviors
  pong-controller.ts        side-specific MLX controller actors behind the llm tool
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
   broadcast / mesh), per-tab player sessions, side claims, readiness, MLX
   controller selection, and an explicit start gate. The browser stays the
   observer/control panel: it claims human slots, synthesizes `mlx-left` /
   `mlx-right` lobby sessions for the chosen mode, feeds snapshots to the
   controller actors, and applies bounded paddle intents at owner-tick turn
   boundaries. It does not persist MLX controllers as browser sessions. The
   page renders the shared
   topology/behavior files, the selected startup module, and the parity-status
   panel so the validation result is visible while switching transports. It
   does not run the CI gate; `mesh-pong.test.ts` remains the runtime-agnostic
   parity test executed by `pnpm test:examples`. WebSocket loopback is
   automated in that test because browser WebSocket nodes need an external
   listener.

Acceptance:

- The ball / paddle / score behaviors import no transport, runtime, or topology
  module — only `defineBehavior` and message/event types.
- Two-player human mode starts only after both side controller slots are claimed
  and ready.
- One-player mode starts with one human slot and one MLX controller slot.
- MLX-vs-MLX mode runs through controller actors while the browser remains an
  observer/control panel.
- Missing or failing MLX providers project error facts instead of crashing
  startup.
- Switching mode changes exactly one startup call; zero
  changes to `pong-behaviors.ts` or `pong-topology.ts` across modes.
- The parity test passes for local, broadcast, and websocket.
- Mesh mode runs the demo across 3 peers with no server process.

## Local MLX prerequisites

To use a real local model, register an Actor-Web `llm` tool/provider at runtime
that fronts your MLX host or server. The Mesh Pong controller actors expect a
single JSON reply:

```json
{ "direction": "up" | "down", "amount": 1..28 }
```

Amounts are clamped to one paddle step, and non-JSON or malformed replies are
returned as controller error facts.

When enabled, the demo posts to `<endpoint>/chat/completions` through the same
Actor-Web `llm` tool seam used by tests. When disabled or unreachable, the
controller actor returns a data error instead of throwing.

## CI path

`mesh-pong.test.ts` does not require a live MLX runtime. It injects a
deterministic fake `ActorAgentLlmProvider` through the `llm` tool so the
one-player, MLX-vs-MLX, and missing-provider paths stay stable in CI.

## Depends on

Built after the transports it exercises land: shared transport core,
BroadcastChannel transport, WebSocket transport, and `@actor-web/labs-mesh`.
Current `@actor-web/labs-mesh` exposes membership/directory/routing overlay
APIs rather than a public `meshTransport` factory, so this example's mesh mode
uses the no-server BroadcastChannel transport plus labs-mesh overlay state.
