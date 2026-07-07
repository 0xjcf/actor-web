import type { ActorMessage, ActorRef } from '@actor-web/runtime';
import { startMeshPongBroadcast } from '../modes/broadcast';
import { startMeshPongLocal } from '../modes/local';
import { startMeshPongMesh } from '../modes/mesh';
import {
  type BrowserPongTransportMode,
  MESH_PONG_SHARED_PARITY_PROOF,
  parityProofForMode,
} from '../parity-proof';
import type {
  BallCommand,
  PaddleCommand,
  PongBallContext,
  PongPaddleState,
  PongScoreState,
  PongSnapshot,
  PongTransportMode,
  ScoreCommand,
} from '../pong-contract';
import { DEFAULT_PONG_SEED, PONG_FIELD } from '../pong-contract';
import { pong } from '../pong-topology';
import { drawPong } from './pong-canvas';

type BrowserMode = BrowserPongTransportMode;
type BrowserRuntime =
  | Awaited<ReturnType<typeof startMeshPongLocal>>
  | Awaited<ReturnType<typeof startMeshPongBroadcast>>
  | Awaited<ReturnType<typeof startMeshPongMesh>>;

interface RuntimeRefs {
  readonly ball: ActorRef<PongBallContext, BallCommand>;
  readonly score: ActorRef<PongScoreState, ScoreCommand>;
  readonly paddleA: ActorRef<PongPaddleState, PaddleCommand>;
  readonly paddleB: ActorRef<PongPaddleState, PaddleCommand>;
}

const canvas = document.querySelector<HTMLCanvasElement>('#pong-canvas');
const modeSelect = document.querySelector<HTMLSelectElement>('#transport-mode');
const resetButton = document.querySelector<HTMLButtonElement>('#reset-game');
const modeValue = document.querySelector<HTMLElement>('#mode-value');
const scoreValue = document.querySelector<HTMLElement>('#score-value');
const statusValue = document.querySelector<HTMLElement>('#status-value');
const proofTopology = document.querySelector<HTMLElement>('#proof-topology');
const proofBehaviors = document.querySelector<HTMLElement>('#proof-behaviors');
const proofActors = document.querySelector<HTMLElement>('#proof-actors');
const proofGate = document.querySelector<HTMLElement>('#proof-gate');
const proofStartup = document.querySelector<HTMLElement>('#proof-startup');
const proofCall = document.querySelector<HTMLElement>('#proof-call');
const proofTransport = document.querySelector<HTMLElement>('#proof-transport');
const proofNodes = document.querySelector<HTMLElement>('#proof-nodes');

if (
  !canvas ||
  !modeSelect ||
  !resetButton ||
  !modeValue ||
  !scoreValue ||
  !statusValue ||
  !proofTopology ||
  !proofBehaviors ||
  !proofActors ||
  !proofGate ||
  !proofStartup ||
  !proofCall ||
  !proofTransport ||
  !proofNodes
) {
  throw new Error('Mesh Pong UI failed to bind required DOM nodes.');
}

const canvasElement: HTMLCanvasElement = canvas;
const modeSelectElement: HTMLSelectElement = modeSelect;
const resetButtonElement: HTMLButtonElement = resetButton;
const modeValueElement: HTMLElement = modeValue;
const scoreValueElement: HTMLElement = scoreValue;
const statusValueElement: HTMLElement = statusValue;
const proofTopologyElement: HTMLElement = proofTopology;
const proofBehaviorsElement: HTMLElement = proofBehaviors;
const proofActorsElement: HTMLElement = proofActors;
const proofGateElement: HTMLElement = proofGate;
const proofStartupElement: HTMLElement = proofStartup;
const proofCallElement: HTMLElement = proofCall;
const proofTransportElement: HTMLElement = proofTransport;
const proofNodesElement: HTMLElement = proofNodes;

let runtime: BrowserRuntime | null = null;
let refs: RuntimeRefs | null = null;
let selectedMode: BrowserMode = 'local';
let loopHandle: number | null = null;
let switchGeneration = 0;
const keys = new Set<string>();

function isCluster(
  candidate: BrowserRuntime
): candidate is
  | Awaited<ReturnType<typeof startMeshPongBroadcast>>
  | Awaited<ReturnType<typeof startMeshPongMesh>> {
  return 'server' in candidate;
}

function setStatus(value: string): void {
  statusValueElement.textContent = value;
}

function renderParityProof(mode: BrowserMode): void {
  const modeProof = parityProofForMode(mode);
  proofTopologyElement.textContent = MESH_PONG_SHARED_PARITY_PROOF.topologyFile;
  proofBehaviorsElement.textContent = MESH_PONG_SHARED_PARITY_PROOF.behaviorFile;
  proofActorsElement.textContent = MESH_PONG_SHARED_PARITY_PROOF.actors.join(', ');
  proofGateElement.textContent = MESH_PONG_SHARED_PARITY_PROOF.validationGate;
  proofStartupElement.textContent = modeProof.startupFile;
  proofCallElement.textContent = modeProof.startupCall;
  proofTransportElement.textContent = modeProof.transportBoundary;
  proofNodesElement.textContent = modeProof.nodeLayout;
}

async function flushRuntime(candidate: BrowserRuntime): Promise<void> {
  if (isCluster(candidate)) {
    await candidate.flush();
    return;
  }

  for (const nodeRuntime of Object.values(candidate.nodes)) {
    await nodeRuntime?.system.flush();
  }
}

function serverNode(candidate: BrowserRuntime) {
  if (isCluster(candidate)) {
    return candidate.server;
  }

  const server = candidate.nodes.server;
  if (!server) {
    throw new Error('Mesh Pong local runtime did not start the server node.');
  }
  return server;
}

async function waitForActor<TContext, TMessage extends ActorMessage>(
  candidate: BrowserRuntime,
  address: string
): Promise<ActorRef<TContext, TMessage>> {
  const server = serverNode(candidate);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const actorRef = await server.system.lookup<TContext, TMessage>(address);
    if (actorRef) {
      return actorRef;
    }
    await flushRuntime(candidate);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error(`Timed out resolving Mesh Pong actor ${address}.`);
}

async function resolveRefs(candidate: BrowserRuntime): Promise<RuntimeRefs> {
  const server = serverNode(candidate);
  return {
    ball: server.requireActor('ball') as ActorRef<PongBallContext, BallCommand>,
    score: server.requireActor('score') as ActorRef<PongScoreState, ScoreCommand>,
    paddleA: await waitForActor<PongPaddleState, PaddleCommand>(
      candidate,
      pong.actors.paddleA.address
    ),
    paddleB: await waitForActor<PongPaddleState, PaddleCommand>(
      candidate,
      pong.actors.paddleB.address
    ),
  };
}

async function snapshot(nextRefs: RuntimeRefs): Promise<PongSnapshot> {
  const ball = await nextRefs.ball.ask<PongBallContext>({ type: 'GET_BALL' });
  const score = await nextRefs.score.ask<PongScoreState>({ type: 'GET_SCORE' });
  const left = await nextRefs.paddleA.ask<PongPaddleState>({ type: 'GET_PADDLE' });
  const right = await nextRefs.paddleB.ask<PongPaddleState>({ type: 'GET_PADDLE' });

  return {
    ball: ball.ball,
    score,
    paddles: {
      left,
      right,
    },
  };
}

async function resetRuntimeGame(
  nextRuntime: BrowserRuntime,
  nextRefs: RuntimeRefs
): Promise<PongSnapshot> {
  const centerY = PONG_FIELD.height / 2 - PONG_FIELD.paddleHeight / 2;
  await nextRefs.ball.send({ type: 'RESET_BALL', seed: DEFAULT_PONG_SEED });
  await flushRuntime(nextRuntime);
  await nextRefs.score.send({ type: 'RESET_SCORE' });
  await flushRuntime(nextRuntime);
  await nextRefs.paddleA.send({ type: 'SET_PADDLE', y: centerY });
  await flushRuntime(nextRuntime);
  await nextRefs.paddleB.send({ type: 'SET_PADDLE', y: centerY });
  await flushRuntime(nextRuntime);
  return snapshot(nextRefs);
}

function renderSnapshot(nextSnapshot: PongSnapshot): void {
  drawPong(canvasElement, nextSnapshot);
  scoreValueElement.textContent = `${nextSnapshot.score.left} : ${nextSnapshot.score.right}`;
}

async function resetGame(): Promise<void> {
  const currentRuntime = runtime;
  const currentRefs = refs;
  if (!currentRuntime || !currentRefs) {
    return;
  }

  const nextSnapshot = await resetRuntimeGame(currentRuntime, currentRefs);
  if (runtime === currentRuntime && refs === currentRefs) {
    renderSnapshot(nextSnapshot);
  }
}

async function startRuntimeForMode(mode: BrowserMode): Promise<BrowserRuntime> {
  if (mode === 'local') {
    return startMeshPongLocal();
  }
  if (mode === 'broadcast') {
    return startMeshPongBroadcast({ channelName: `mesh-pong-demo-${crypto.randomUUID()}` });
  }
  return startMeshPongMesh({ channelName: `mesh-pong-demo-${crypto.randomUUID()}` });
}

async function switchMode(mode: BrowserMode): Promise<void> {
  const generation = switchGeneration + 1;
  switchGeneration = generation;

  if (loopHandle !== null) {
    window.clearTimeout(loopHandle);
    loopHandle = null;
  }

  const previous = runtime;
  runtime = null;
  refs = null;
  if (previous) {
    try {
      await previous.stop();
    } catch (error) {
      if (switchGeneration === generation) {
        setStatus(error instanceof Error ? `stop failed: ${error.message}` : 'stop failed');
      }
      return;
    }
  }

  if (switchGeneration !== generation) {
    return;
  }

  selectedMode = mode;
  modeValueElement.textContent = mode;
  renderParityProof(mode);
  setStatus('starting');

  let nextRuntime: BrowserRuntime | null = null;
  try {
    nextRuntime = await startRuntimeForMode(mode);
    const nextRefs = await resolveRefs(nextRuntime);
    const nextSnapshot = await resetRuntimeGame(nextRuntime, nextRefs);

    if (switchGeneration !== generation) {
      await nextRuntime.stop().catch(() => undefined);
      return;
    }

    runtime = nextRuntime;
    refs = nextRefs;
    renderSnapshot(nextSnapshot);
    setStatus('running');
    loopHandle = window.setTimeout(tick, 120);
  } catch (error) {
    if (nextRuntime) {
      await nextRuntime.stop().catch(() => undefined);
    }
    if (switchGeneration === generation) {
      runtime = null;
      refs = null;
      loopHandle = null;
      setStatus(error instanceof Error ? `start failed: ${error.message}` : 'start failed');
    }
  }
}

async function applyPaddleInput(nextRuntime: BrowserRuntime, nextRefs: RuntimeRefs): Promise<void> {
  if (keys.has('w')) {
    await nextRefs.paddleA.send({ type: 'MOVE_PADDLE', direction: 'up' });
    await flushRuntime(nextRuntime);
  }
  if (keys.has('s')) {
    await nextRefs.paddleA.send({ type: 'MOVE_PADDLE', direction: 'down' });
    await flushRuntime(nextRuntime);
  }
  if (keys.has('arrowup')) {
    await nextRefs.paddleB.send({ type: 'MOVE_PADDLE', direction: 'up' });
    await flushRuntime(nextRuntime);
  }
  if (keys.has('arrowdown')) {
    await nextRefs.paddleB.send({ type: 'MOVE_PADDLE', direction: 'down' });
    await flushRuntime(nextRuntime);
  }
}

async function tick(): Promise<void> {
  const currentRuntime = runtime;
  const currentRefs = refs;
  if (!currentRuntime || !currentRefs) {
    return;
  }

  try {
    await applyPaddleInput(currentRuntime, currentRefs);
    const current = await snapshot(currentRefs);
    await currentRefs.ball.send({
      type: 'SET_PADDLES',
      leftY: current.paddles.left.y,
      rightY: current.paddles.right.y,
    });
    await currentRefs.ball.send({ type: 'TICK' });
    await flushRuntime(currentRuntime);
    const nextSnapshot = await snapshot(currentRefs);
    if (runtime === currentRuntime && refs === currentRefs) {
      renderSnapshot(nextSnapshot);
      setStatus('running');
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'runtime error');
  } finally {
    if (runtime === currentRuntime && refs === currentRefs) {
      loopHandle = window.setTimeout(tick, 90);
    }
  }
}

modeSelectElement.addEventListener('change', () => {
  const mode = modeSelectElement.value as PongTransportMode;
  if (mode === 'websocket') {
    modeSelectElement.value = selectedMode;
    setStatus('websocket loopback runs in CI');
    return;
  }
  void switchMode(mode);
});

resetButtonElement.addEventListener('click', () => {
  void resetGame().catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : 'reset failed');
  });
});

window.addEventListener('keydown', (event) => {
  keys.add(event.key.toLowerCase());
});

window.addEventListener('keyup', (event) => {
  keys.delete(event.key.toLowerCase());
});

void switchMode('local');
