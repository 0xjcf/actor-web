import type { ActorMessage, ActorRef } from '@actor-web/runtime';
import { startMeshPongBroadcast } from '../modes/broadcast';
import { startMeshPongLocal } from '../modes/local';
import { startMeshPongMesh } from '../modes/mesh';
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

type BrowserMode = Exclude<PongTransportMode, 'websocket'>;
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

if (!canvas || !modeSelect || !resetButton || !modeValue || !scoreValue || !statusValue) {
  throw new Error('Mesh Pong UI failed to bind required DOM nodes.');
}

const canvasElement: HTMLCanvasElement = canvas;
const modeSelectElement: HTMLSelectElement = modeSelect;
const resetButtonElement: HTMLButtonElement = resetButton;
const modeValueElement: HTMLElement = modeValue;
const scoreValueElement: HTMLElement = scoreValue;
const statusValueElement: HTMLElement = statusValue;

let runtime: BrowserRuntime | null = null;
let refs: RuntimeRefs | null = null;
let selectedMode: BrowserMode = 'local';
let loopHandle: number | null = null;
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

async function flushRuntime(candidate: BrowserRuntime): Promise<void> {
  if (isCluster(candidate)) {
    await candidate.flush();
    return;
  }

  await Promise.all(
    Object.values(candidate.nodes).map((nodeRuntime) => nodeRuntime?.system.flush())
  );
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
  const [ball, score, left, right] = await Promise.all([
    nextRefs.ball.ask<PongBallContext>({ type: 'GET_BALL' }),
    nextRefs.score.ask<PongScoreState>({ type: 'GET_SCORE' }),
    nextRefs.paddleA.ask<PongPaddleState>({ type: 'GET_PADDLE' }),
    nextRefs.paddleB.ask<PongPaddleState>({ type: 'GET_PADDLE' }),
  ]);

  return {
    ball: ball.ball,
    score,
    paddles: {
      left,
      right,
    },
  };
}

async function resetGame(): Promise<void> {
  if (!runtime || !refs) {
    return;
  }

  const centerY = PONG_FIELD.height / 2 - PONG_FIELD.paddleHeight / 2;
  await Promise.all([
    refs.ball.send({ type: 'RESET_BALL', seed: DEFAULT_PONG_SEED }),
    refs.score.send({ type: 'RESET_SCORE' }),
    refs.paddleA.send({ type: 'SET_PADDLE', y: centerY }),
    refs.paddleB.send({ type: 'SET_PADDLE', y: centerY }),
  ]);
  await flushRuntime(runtime);
  const nextSnapshot = await snapshot(refs);
  drawPong(canvasElement, nextSnapshot);
  scoreValueElement.textContent = `${nextSnapshot.score.left} : ${nextSnapshot.score.right}`;
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
  if (loopHandle !== null) {
    window.clearTimeout(loopHandle);
    loopHandle = null;
  }

  const previous = runtime;
  runtime = null;
  refs = null;
  await previous?.stop();

  selectedMode = mode;
  modeValueElement.textContent = mode;
  setStatus('starting');
  runtime = await startRuntimeForMode(mode);
  refs = await resolveRefs(runtime);
  await resetGame();
  setStatus('running');
  loopHandle = window.setTimeout(tick, 120);
}

async function applyPaddleInput(nextRefs: RuntimeRefs): Promise<void> {
  const moves: Promise<void>[] = [];
  if (keys.has('w')) {
    moves.push(nextRefs.paddleA.send({ type: 'MOVE_PADDLE', direction: 'up' }));
  }
  if (keys.has('s')) {
    moves.push(nextRefs.paddleA.send({ type: 'MOVE_PADDLE', direction: 'down' }));
  }
  if (keys.has('arrowup')) {
    moves.push(nextRefs.paddleB.send({ type: 'MOVE_PADDLE', direction: 'up' }));
  }
  if (keys.has('arrowdown')) {
    moves.push(nextRefs.paddleB.send({ type: 'MOVE_PADDLE', direction: 'down' }));
  }
  await Promise.all(moves);
}

async function tick(): Promise<void> {
  if (!runtime || !refs) {
    return;
  }

  try {
    await applyPaddleInput(refs);
    await flushRuntime(runtime);
    const current = await snapshot(refs);
    await refs.ball.send({
      type: 'SET_PADDLES',
      leftY: current.paddles.left.y,
      rightY: current.paddles.right.y,
    });
    await refs.ball.send({ type: 'TICK' });
    await flushRuntime(runtime);
    const nextSnapshot = await snapshot(refs);
    drawPong(canvasElement, nextSnapshot);
    scoreValueElement.textContent = `${nextSnapshot.score.left} : ${nextSnapshot.score.right}`;
    setStatus('running');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'runtime error');
  } finally {
    loopHandle = window.setTimeout(tick, 90);
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
  void resetGame();
});

window.addEventListener('keydown', (event) => {
  keys.add(event.key.toLowerCase());
});

window.addEventListener('keyup', (event) => {
  keys.delete(event.key.toLowerCase());
});

void switchMode('local');
