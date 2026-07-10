# Mesh Pong

> Status: shipped example. The automated validation gate is
> `examples/mesh-pong/mesh-pong.test.ts`; the playable demo is
> `examples/mesh-pong/ui/index.html`.

Mesh Pong now exposes four visible controller modes per side: `human`,
`reflex`, `planner`, and `hybrid`.

- `reflex` is a deterministic intercept controller with no provider dependency.
- `planner` asks the local MLX/LLM boundary for low-frequency strategy facts and
  moves only while that strategy is still fresh. Once stale, it goes neutral
  instead of secretly falling back to reflex.
- `hybrid` always keeps reflex active as the baseline and overlays fresh planner
  strategy when available; stale planner strategy reuses only for a small
  bounded budget before the shell returns to reflex-only behavior.

Legacy stored or configured `mlx` controller values remain accepted as
compatibility input and normalize to visible `planner`. New browser-visible
controller vocabulary writes use `human` / `reflex` / `planner` / `hybrid`.

## Authority and durability

- `Room` is authoritative for lobby membership, seats, readiness, host selection,
  and the immutable roster handoff. Its state is intentionally ephemeral in this example.
- `MatchCoordinator` is authoritative for match phase, generation, canonical tick,
  controller slots, and the canonical `PongSnapshot`. Its state is also intentionally
  ephemeral; Mesh Pong does not claim a durable match journal or artifact store.
- Planner responses are provisional advisory proposals. The shell records proposal and
  correlation identity, source generation/tick, owner/mode facts, and timestamps, then
  deterministically admits only a current, uncancelled proposal before it can influence
  a synthetic paddle input. The coordinator remains the only authority that applies input.
- The Ignite workflow and browser DOM are derived projections. They never own Room or
  MatchCoordinator lifecycle state, and neither Ignite nor FAS is required to execute a match.

The remote-room follow-up binds authenticated runtime identity at the transport boundary.
The current local/headless example keeps `requestSessionId` as a development identity fact
and rechecks Room/Match authorization at execution time.

## Recommended local benchmark path

The recommended operator benchmark path stays intentionally small and uses the
same provider shape that is covered by in-repo tests:

- One OpenAI-compatible MLX endpoint shared by both sides.
- One model setting for both controller actors.
- Browser-side telemetry plus the benchmark summary reducer in `ui/main.ts` for
  deterministic reductions of observed latency, throughput, timeout, and gameplay-effect facts.

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

- One-player: one human side plus one `reflex`, `planner`, or `hybrid` side.
- Planner-vs-Planner: both sides set to `planner` to observe shared-endpoint contention.
- Hybrid-vs-Hybrid: both sides set to `hybrid` to keep deterministic reflex active while both planner lanes contend for the shared endpoint.

Supported browser-storable overrides remain the non-secret provider keys, with
`localStorage` taking precedence over Vite env vars for those values:

- `actor-web.mesh-pong.mlx.enabled` or `VITE_MESH_PONG_MLX_ENABLED`
- `actor-web.mesh-pong.mlx.endpoint` or `VITE_MESH_PONG_MLX_ENDPOINT`
- `actor-web.mesh-pong.mlx.model` or `VITE_MESH_PONG_MLX_MODEL`

The browser demo intentionally does not send Authorization headers. If an MLX
endpoint requires auth, keep the bearer token behind a local server/proxy and
point the browser example at that local OpenAI-compatible boundary.

Defaults:

- enabled: `false`
- endpoint: `http://127.0.0.1:8080/v1`
- model: `mlx-community/Llama-3.2-3B-Instruct-4bit`

## Benchmark summary

The browser sidebar now shows both the raw telemetry lanes and a compact
benchmark summary string derived only from telemetry events. The summary reports
metrics deterministically reduced from observed telemetry:

- controller started / finished / timeouts
- latency count / total / min / max / average
- controller throughput per second
- simulation scheduled / applied / held / dropped
- applied simulation turns per second
- timeout rate
- gameplay effect classification: `stalled`, `timeout-bound`, `laggy`,
  `controller-delayed`, or `smooth`

Evidence boundary:

- Deterministic in-repo evidence covers the summary reducer, browser shell
  wiring, one-player telemetry, planner-vs-planner telemetry, timeout classification,
  and fake-provider behavior without a live MLX server.
- Manual local benchmark evidence should be collected by running the
  single-endpoint procedure above with the current default model and endpoint.
  This sandbox did not run a live MLX benchmark.
- The model/server strategy for the example remains single-endpoint until live
  evidence shows that a dual-server setup improves local play.

Deterministic benchmark scenarios:

| Scenario | Settings | Expected summary signal | Interpretation |
| --- | --- | --- | --- |
| One-player, synthetic provider | `playerCount=1`, one side `planner`, one side human | `effect smooth` when controller latency stays under the `90ms` simulation budget and held/dropped stay near zero | Proves the summary path for the default local demo shape without requiring MLX |
| Planner-vs-Planner, synthetic provider | `playerCount=2`, both sides `planner` | `effect timeout-bound` or `effect laggy` once average latency rises above budget, held/dropped turns accumulate, or controller timeouts appear | Proves the shared-endpoint stress summary without requiring MLX |
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
- `Left control` / `Right control` show the visible controller mode, the applied
  source (`human`, `reflex`, `planner`, or `hybrid`), planner freshness or
  fallback status, the compact target/intercept or strategy label, the latest
  controller RTT, and the age of the last applied decision.
- `Replay` remains a compatibility telemetry field and stays empty in the
  coordinator architecture; controller input has no parallel replay channel.

Interpretation:

- `held` should stay near zero during normal planner-backed play because the owner tick now
  advances while each side keeps at most one local-model request in flight.
- High `dropped` means the browser missed one or more `90ms` simulation slots,
  calculated as `floor(gapMs / 90) - 1`.
- High controller `rtt` points to model/provider latency.
- High decision `age` includes local model decision time for planner-backed
  modes. Human and synthetic controller input use the selected Actor-Web
  transport to reach `matchCoordinator`. Local
  human input is applied immediately in the shell through the local coordinator
  ref, so its intent age is usually near zero; remote human input follows the
  same command path through its client transport.
- When a fresh planner result is late, `planner` goes neutral after its fresh
  budget expires, while `hybrid` falls back to reflex and only reuses stale
  planner strategy for a small bounded number of turns.

## What it proves

One set of actor definitions runs unchanged across every transport and
topology. Pong is the proof: the authoritative match lifecycle and projection
contract is written once; only the startup mode changes. This is the executable
guard for the topology-independence guarantee from spike
`direct-1781363862864`.

## The invariant — define once

```ts
import { ACTOR_WEB_LLM_TOOL_NAME } from '@actor-web/agent';
import { actor, defineActorWebTopology, node, tool } from '@actor-web/runtime/topology';
import { createPlayerSessionBehavior, matchCoordinatorBehavior } from './pong-behaviors';
import { createPlayerSessionActorId, PONG_NODE_ADDRESSES } from './pong-contract';
import { createPongControllerBehavior } from './pong-controller';

export interface CreatePongTopologyOptions {
  readonly clientNodeAddress?: string;
}

export function createPongTopology(options: CreatePongTopologyOptions = {}) {
  const clientNodeAddress = options.clientNodeAddress ?? PONG_NODE_ADDRESSES.localClient;

  return defineActorWebTopology({
    nodes: {
      server: node(PONG_NODE_ADDRESSES.server),
      a: node(PONG_NODE_ADDRESSES.a),
      b: node(PONG_NODE_ADDRESSES.b),
      client: node(clientNodeAddress),
    },
    tools: [tool(ACTOR_WEB_LLM_TOOL_NAME)],
    actors: {
      matchCoordinator: actor({
        id: 'match-coordinator',
        node: 'server',
        behavior: matchCoordinatorBehavior,
      }),
      playerSession: actor({
        id: createPlayerSessionActorId,
        node: 'client',
        behavior: createPlayerSessionBehavior,
      }),
      controllerLeft: actor({
        id: 'controller-left',
        node: 'a',
        behavior: createPongControllerBehavior('left'),
        tools: [ACTOR_WEB_LLM_TOOL_NAME],
      }),
      controllerRight: actor({
        id: 'controller-right',
        node: 'b',
        behavior: createPongControllerBehavior('right'),
        tools: [ACTOR_WEB_LLM_TOOL_NAME],
      }),
    },
    subscriptions: [],
  });
}

export const pong = createPongTopology();
```

## The only line that changes

```ts
// local — one process, no transport
await startMeshPongLocal();

// websocket loopback — Node listeners on every node for the parity gate
await startMeshPongWebSocketLoopback();

// websocket browser — a unique browser client connects outbound to the Node helper
await startMeshPongBrowserWebSocket();

// broadcast-channel — same-origin tabs on one shared transport identity
await startMeshPongBroadcast({ channelName: 'pong' });

// mesh — labs-mesh overlay on one shared BroadcastChannel identity
await startMeshPongMesh({ channelName: 'pong-mesh' });
```

The example keeps transport-specific code in `modes/`. `pong-behaviors.ts` and
`pong-topology.ts` do not change between local, BroadcastChannel, WebSocket, and
mesh-demo execution.

The controller split now mirrors the intended game-engine architecture:

- `pong-contract.ts`: pure deterministic core. It normalizes controller
  vocabulary, predicts reflex intercept targets, models planner strategy facts,
  merges strategy with reflex targeting, and resolves bounded paddle intents.
- `matchCoordinator`: server-node authoritative lifecycle aggregate. It owns
  phase, generation, controller slots, session roster, authority, and the full
  canonical `PongSnapshot`.
- `playerSession`: client-node adapter for one browser session's side claim,
  readiness, and human controller input.
- `controllerLeft` / `controllerRight`: planner adapter actors on nodes `a` and
  `b`. They own prompt construction, request/timeout wiring, response parsing,
  and errors-as-data, and return low-frequency strategy facts.
- `ui/main.ts`: imperative shell. It owns controller scheduling, freshness and
  stale-budget policy, DOM state, and telemetry. Every seated human session
  submits its own input through the selected Actor-Web transport; only the
  authority plans synthetic controllers and advances `TICK_MATCH`.

The reusable Actor-Web primitive extraction question is intentionally deferred
for this task. The bounded planner/reflex controller seam stays example-local
until there is a second concrete consumer that justifies lifting it into a
package-level contract.

## File layout

```text
examples/mesh-pong/
  README.md                 this file
  pong-contract.ts          message/event types and deterministic Pong rules
  pong-behaviors.ts         coordinator and player-session actor behaviors
  pong-controller.ts        side-specific planner adapter actors behind the llm tool
  pong-topology.ts          the shared defineActorWebTopology
  parity-proof.ts           data rendered by the UI proof panel
  modes/
    local.ts                one single-runtime server / a / b / client topology
    websocket.ts            one helper host plus unique browser client nodes
    broadcast.ts            one-shot browser host lease plus unique client nodes
    mesh.ts                 host/client startup plus overlays for locally started nodes
  ui/
    index.html              the playable demo + transport switcher
    main.ts                 browser runtime driver
    pong-canvas.ts          renders canonical coordinator snapshots
  mesh-pong.test.ts         lifecycle, controller-input, and transport parity gate
```

## Validation strategy

The example is two deliverables: a human-facing demo and an automated gate.

1. **Behavior-parity test** (`mesh-pong.test.ts`) — the real validation. It
   drives the same topology with a deterministic ball seed across `local`,
   `broadcast-channel`, and `websocket` loopback runtimes, reads canonical
   snapshots from `matchCoordinator`, and asserts identical lifecycle, score,
   ball, and paddle projections. Independent BroadcastChannel clients also
   prove guest human input crosses its own transport and converges. This runs in
   CI through `pnpm test:examples`.
2. **UI demo** (`ui/`) — a playable Pong with a transport switcher (local /
   broadcast / mesh / websocket), per-tab player sessions, side claims, readiness,
   `human` / `reflex` / `planner` / `hybrid` controller selection, and an
   explicit start gate. The browser stays the
   observer/control panel: it claims human slots, synthesizes controller
   session slots for `reflex`, `planner`, or `hybrid` sides, and lets every
   seated human send its own input while exactly one authority session asks
   controller actors and advances match ticks. Other clients remain simulation
   projections. It does not persist non-human controllers as browser sessions.
   The page renders the shared
   topology/behavior files, the selected startup module, and the parity-status
   panel so the validation result is visible while switching transports. It
   does not run the CI gate; `mesh-pong.test.ts` remains the runtime-agnostic
   parity test executed by `pnpm test:examples`.

Transport distinction:

- `local`: `server / a / b / client in one runtime` for quick deterministic
  play.
- `broadcast`: `host server / a / b / client; joiners client only` on one
  same-origin BroadcastChannel transport.
- `mesh`: `host server / a / b / client; joiners client only; local overlays`.
  One Web Locks host starts the aggregate/controller/client nodes, each
  additional tab starts only its unique client node, and labs-mesh overlays
  only the nodes started in that tab.
- `websocket` in `mesh-pong.test.ts`: the headless loopback parity gate, where
  Node listeners run on every node so CI can prove transport parity.
- `websocket` in the browser UI: `helper host server / a / b / client; browser
  tabs client only`. Browser nodes stay outbound-only and connect to the local
  Vite helper. The UI reports `connecting`, `connected/lobby`,
  `listener-missing`, or `transport-failed` instead of silently falling back.

Capture guidance:

- Use browser-playable WebSocket for local demo/blog/GIF capture when you want
  a real remote transport in the browser.
- Keep `startMeshPongWebSocketLoopback()` as the automated parity proof and CI
  gate; it is not the browser demo path.
- Production hardening is still follow-up work: the helper is intentionally a
  local example/dev-server seam, not a packaged runtime surface.

Acceptance:

- The deterministic contract, coordinator/player-session behaviors, and
  controller actors import no concrete transport or startup mode.
- Two-player human mode starts only after both side controller slots are claimed
  and ready.
- One-player mode starts with one human slot and one non-human controller slot.
- Planner-vs-Planner mode runs through controller actors while the browser remains an
  observer/control panel.
- Each seated human submits input through its own player-session actor and
  coordinator ref; only the authority may advance `TICK_MATCH`.
- `requestSessionId` is this example's current identity fact. Authenticated
  transport identity remains remote-room work.
- Missing or failing MLX providers project error facts instead of crashing
  startup.
- Switching mode changes exactly one startup call; zero
  changes to `pong-behaviors.ts` or `pong-topology.ts` across modes.
- The parity test passes for local, broadcast, and websocket, with mesh startup
  covered by the same host/client topology contract.
- Mesh mode has one browser host running `server / a / b / client`; client-only
  tabs run one unique client node and never promote after host loss.

## Local MLX prerequisites

To use a real local model, register an Actor-Web `llm` tool/provider at runtime
that fronts your MLX host or server. The Mesh Pong controller actors expect a
single planner-strategy JSON reply:

```json
{
  "targetY": 139,
  "biasY": 0,
  "maxStep": 14,
  "label": "short reason string",
  "facts": ["short fact strings"]
}
```

`targetY` accepts values from 0 through 278, `biasY` accepts values from -82
through 82, and `maxStep` accepts values from 1 through 28.

`maxStep` is clamped to one paddle step, and non-JSON or malformed replies are
returned as controller error facts.

When enabled, the demo posts to `<endpoint>/chat/completions` through the same
Actor-Web `llm` tool seam used by tests. When disabled or unreachable, the
controller actor returns a data error instead of throwing.

## CI path

`mesh-pong.test.ts` does not require a live MLX runtime. It injects a
deterministic fake `ActorAgentLlmProvider` through the `llm` tool so the
one-player, planner-vs-planner, hybrid fallback, and missing-provider paths
stay stable in CI.

## Depends on

Built after the transports it exercises land: shared transport core,
BroadcastChannel transport, WebSocket transport, and `@actor-web/labs-mesh`.
Current `@actor-web/labs-mesh` exposes membership/directory/routing overlay
APIs rather than a public `meshTransport` factory, so this example's mesh mode
uses BroadcastChannel transport for the browser-hosted `server / a / b /
client` topology and adds labs-mesh overlay state only for locally started
nodes.
