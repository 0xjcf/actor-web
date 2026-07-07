import type { ActorMessage, ActorRef } from '@actor-web/runtime';
import { createBrowserMlxTools } from '../mlx-provider';
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
  ControllerCommand,
  PaddleCommand,
  PlayerSessionCommand,
  PongBallContext,
  PongControllerActorState,
  PongControllerInputResult,
  PongControllerResult,
  PongControllerType,
  PongLobbyCommand,
  PongLobbyState,
  PongMatchMode,
  PongMatchStartResult,
  PongPaddleState,
  PongPlayerSessionState,
  PongScoreState,
  PongSide,
  PongSnapshot,
  PongTransportMode,
  ScoreCommand,
} from '../pong-contract';
import {
  createSyntheticMlxControllerInput,
  DEFAULT_PONG_SEED,
  PONG_FIELD,
  shouldLaunchMlxControllerForSide,
  syncLobbySessionsFromStorage,
  TWO_HUMAN_PONG_MATCH_MODE,
} from '../pong-contract';
import { pong } from '../pong-topology';
import { drawPong } from './pong-canvas';

type BrowserMode = BrowserPongTransportMode;
type BrowserRuntime =
  | Awaited<ReturnType<typeof startMeshPongLocal>>
  | Awaited<ReturnType<typeof startMeshPongBroadcast>>
  | Awaited<ReturnType<typeof startMeshPongMesh>>;

interface RuntimeRefs {
  readonly ball: ActorRef<PongBallContext, BallCommand>;
  readonly controllerLeft: ActorRef<PongControllerActorState, ControllerCommand>;
  readonly controllerRight: ActorRef<PongControllerActorState, ControllerCommand>;
  readonly score: ActorRef<PongScoreState, ScoreCommand>;
  readonly lobby: ActorRef<PongLobbyState, PongLobbyCommand>;
  readonly playerSession: ActorRef<PongPlayerSessionState, PlayerSessionCommand>;
  readonly paddleA: ActorRef<PongPaddleState, PaddleCommand>;
  readonly paddleB: ActorRef<PongPaddleState, PaddleCommand>;
}

const canvas = document.querySelector<HTMLCanvasElement>('#pong-canvas');
const modeSelect = document.querySelector<HTMLSelectElement>('#transport-mode');
const playerCountSelect = document.querySelector<HTMLSelectElement>('#player-count');
const leftControllerSelect = document.querySelector<HTMLSelectElement>('#left-controller');
const rightControllerSelect = document.querySelector<HTMLSelectElement>('#right-controller');
const claimLeftButton = document.querySelector<HTMLButtonElement>('#claim-left');
const claimRightButton = document.querySelector<HTMLButtonElement>('#claim-right');
const readyButton = document.querySelector<HTMLButtonElement>('#ready-player');
const startButton = document.querySelector<HTMLButtonElement>('#start-game');
const resetButton = document.querySelector<HTMLButtonElement>('#reset-game');
const modeValue = document.querySelector<HTMLElement>('#mode-value');
const scoreValue = document.querySelector<HTMLElement>('#score-value');
const statusValue = document.querySelector<HTMLElement>('#status-value');
const sessionValue = document.querySelector<HTMLElement>('#session-value');
const sideValue = document.querySelector<HTMLElement>('#side-value');
const lobbyValue = document.querySelector<HTMLElement>('#lobby-value');
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
  !playerCountSelect ||
  !leftControllerSelect ||
  !rightControllerSelect ||
  !claimLeftButton ||
  !claimRightButton ||
  !readyButton ||
  !startButton ||
  !resetButton ||
  !modeValue ||
  !scoreValue ||
  !statusValue ||
  !sessionValue ||
  !sideValue ||
  !lobbyValue ||
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
const playerCountSelectElement: HTMLSelectElement = playerCountSelect;
const leftControllerSelectElement: HTMLSelectElement = leftControllerSelect;
const rightControllerSelectElement: HTMLSelectElement = rightControllerSelect;
const claimLeftButtonElement: HTMLButtonElement = claimLeftButton;
const claimRightButtonElement: HTMLButtonElement = claimRightButton;
const readyButtonElement: HTMLButtonElement = readyButton;
const startButtonElement: HTMLButtonElement = startButton;
const resetButtonElement: HTMLButtonElement = resetButton;
const modeValueElement: HTMLElement = modeValue;
const scoreValueElement: HTMLElement = scoreValue;
const statusValueElement: HTMLElement = statusValue;
const sessionValueElement: HTMLElement = sessionValue;
const sideValueElement: HTMLElement = sideValue;
const lobbyValueElement: HTMLElement = lobbyValue;
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
let playerSessionState: PongPlayerSessionState | null = null;
let matchStarted = false;
let matchOwnerSessionId: string | null = null;
let matchGeneration = 0;
const keys = new Set<string>();
let lifecycleStatus = 'idle';
const controllerDiagnostics: Partial<Record<PongSide, string>> = {};

type MlxControllerRequest = {
  readonly runtime: BrowserRuntime;
  readonly refs: RuntimeRefs;
  readonly side: PongSide;
  readonly controller: ActorRef<PongControllerActorState, ControllerCommand>;
  readonly snapshot: PongSnapshot;
  readonly matchGeneration: number;
};

const mlxControllerRequests: Partial<Record<PongSide, MlxControllerRequest>> = {};

function clearMlxControllerRequests(): void {
  delete mlxControllerRequests.left;
  delete mlxControllerRequests.right;
}

function clearMatchOwner(): void {
  matchOwnerSessionId = null;
}

function renderStatus(): void {
  const diagnostics = (['left', 'right'] as const)
    .flatMap((side) => {
      const reason = controllerDiagnostics[side];
      return reason ? [`${side} ${reason}`] : [];
    })
    .join('; ');
  statusValueElement.textContent = diagnostics
    ? `${lifecycleStatus}; ${diagnostics}`
    : lifecycleStatus;
}

const SESSION_ID_STORAGE_KEY = 'actor-web.mesh-pong.session-id';
const LOBBY_STORAGE_KEY = 'actor-web.mesh-pong.sessions';
const LOBBY_CHANNEL_NAME = 'actor-web.mesh-pong.lobby';

type LobbyChannelMessage =
  | { readonly type: 'sessions-updated' }
  | {
      readonly type: 'controller-input';
      readonly input: Extract<PongControllerInputResult, { readonly ok: true }>;
    }
  | {
      readonly type: 'match-started';
      readonly mode: PongMatchMode;
      readonly ownerSessionId: string;
    };

const lobbyChannel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(LOBBY_CHANNEL_NAME);

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getBrowserSessionId(): string {
  try {
    const stored = sessionStorage.getItem(SESSION_ID_STORAGE_KEY);
    if (stored) {
      return stored;
    }
    const next = createSessionId();
    sessionStorage.setItem(SESSION_ID_STORAGE_KEY, next);
    return next;
  } catch {
    return createSessionId();
  }
}

const browserSessionId = getBrowserSessionId();

function isController(value: string): value is PongControllerType {
  return value === 'human' || value === 'mlx';
}

function selectedController(select: HTMLSelectElement): PongControllerType {
  return isController(select.value) ? select.value : 'human';
}

function selectedMatchMode(): PongMatchMode {
  return {
    playerCount: playerCountSelectElement.value === '1' ? 1 : 2,
    controllers: {
      left: selectedController(leftControllerSelectElement),
      right: selectedController(rightControllerSelectElement),
    },
  };
}

function isPongPlayerSessionState(value: unknown): value is PongPlayerSessionState {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<PongPlayerSessionState>;
  return (
    typeof candidate.sessionId === 'string' &&
    (candidate.controller === 'human' || candidate.controller === 'mlx') &&
    (candidate.side === null || candidate.side === 'left' || candidate.side === 'right') &&
    typeof candidate.ready === 'boolean'
  );
}

function readStoredSessions(): PongPlayerSessionState[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOBBY_STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter(isPongPlayerSessionState) : [];
  } catch {
    return [];
  }
}

function writeStoredSession(session: PongPlayerSessionState): void {
  if (session.controller !== 'human') {
    return;
  }
  const sessions = [
    ...readStoredSessions().filter((candidate) => candidate.sessionId !== session.sessionId),
    session,
  ];
  try {
    localStorage.setItem(LOBBY_STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // Storage is an optimization for separate tabs; actor state remains authoritative locally.
  }
  lobbyChannel?.postMessage({ type: 'sessions-updated' } satisfies LobbyChannelMessage);
}

function storedSessionForCurrentTab(): PongPlayerSessionState | undefined {
  return readStoredSessions().find((session) => session.sessionId === browserSessionId);
}

function mlxSessionForSide(side: 'left' | 'right'): PongPlayerSessionState {
  return {
    sessionId: `mlx-${side}`,
    controller: 'mlx',
    side,
    ready: true,
  };
}

function isCluster(
  candidate: BrowserRuntime
): candidate is
  | Awaited<ReturnType<typeof startMeshPongBroadcast>>
  | Awaited<ReturnType<typeof startMeshPongMesh>> {
  return 'server' in candidate;
}

function setStatus(value: string): void {
  lifecycleStatus = value;
  renderStatus();
}

function clearControllerDiagnostics(): void {
  delete controllerDiagnostics.left;
  delete controllerDiagnostics.right;
  renderStatus();
}

function clearControllerDiagnostic(side: PongSide): void {
  if (!(side in controllerDiagnostics)) {
    return;
  }
  delete controllerDiagnostics[side];
  renderStatus();
}

function setControllerDiagnostic(side: PongSide, reason: string): void {
  controllerDiagnostics[side] = reason;
  renderStatus();
}

function renderPlayerSession(session: PongPlayerSessionState | null): void {
  sessionValueElement.textContent = browserSessionId.slice(0, 8);
  sideValueElement.textContent = session?.side ?? 'none';
  readyButtonElement.textContent = session?.ready ? 'Ready' : 'Ready';
}

function renderLobby(lobby: PongLobbyState): void {
  const readyControllers = lobby.controllers.filter((controller) => controller.ready).length;
  lobbyValueElement.textContent = `${readyControllers} / 2`;
}

async function currentLobbyState(nextRefs: RuntimeRefs): Promise<PongLobbyState> {
  return nextRefs.lobby.ask<PongLobbyState>({ type: 'GET_LOBBY' });
}

async function syncStoredSessionsToLobby(
  nextRuntime: BrowserRuntime,
  nextRefs: RuntimeRefs
): Promise<void> {
  const currentLobby = await currentLobbyState(nextRefs);
  const nextLobby = syncLobbySessionsFromStorage(currentLobby, readStoredSessions());
  const nextSessions = new Map(nextLobby.sessions.map((session) => [session.sessionId, session]));
  for (const session of currentLobby.sessions) {
    if (!nextSessions.has(session.sessionId)) {
      await nextRefs.lobby.send({ type: 'REMOVE_SESSION', sessionId: session.sessionId });
    }
  }
  for (const session of nextLobby.sessions) {
    await nextRefs.lobby.send({ type: 'SYNC_SESSION', session });
  }
  await flushRuntime(nextRuntime);
  renderLobby(await currentLobbyState(nextRefs));
}

async function syncLobbyForMatchMode(
  nextRuntime: BrowserRuntime,
  nextRefs: RuntimeRefs,
  mode: PongMatchMode
): Promise<void> {
  await nextRefs.lobby.send({ type: 'RESET_LOBBY' });
  for (const session of readStoredSessions()) {
    await nextRefs.lobby.send({ type: 'SYNC_SESSION', session });
  }
  for (const side of ['left', 'right'] as const) {
    if (mode.controllers[side] === 'mlx') {
      await nextRefs.lobby.send({
        type: 'SYNC_SESSION',
        session: mlxSessionForSide(side),
      });
    }
  }
  await flushRuntime(nextRuntime);
  renderLobby(await currentLobbyState(nextRefs));
}

async function syncCurrentSession(
  nextRuntime: BrowserRuntime,
  nextRefs: RuntimeRefs
): Promise<void> {
  const session = await nextRefs.playerSession.ask<PongPlayerSessionState>({ type: 'GET_SESSION' });
  playerSessionState = session;
  writeStoredSession(session);
  await syncStoredSessionsToLobby(nextRuntime, nextRefs);
  renderPlayerSession(session);
}

async function hydrateCurrentSession(
  nextRuntime: BrowserRuntime,
  nextRefs: RuntimeRefs
): Promise<void> {
  const stored = storedSessionForCurrentTab();
  if (stored?.side) {
    await nextRefs.playerSession.send({
      type: 'CLAIM_SIDE',
      side: stored.side,
      controller: stored.controller,
    });
    if (stored.ready) {
      await nextRefs.playerSession.send({ type: 'SET_READY', ready: true });
    }
    await flushRuntime(nextRuntime);
  }
  await syncCurrentSession(nextRuntime, nextRefs);
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
    controllerLeft: await waitForActor<PongControllerActorState, ControllerCommand>(
      candidate,
      pong.actors.controllerLeft.address
    ),
    controllerRight: await waitForActor<PongControllerActorState, ControllerCommand>(
      candidate,
      pong.actors.controllerRight.address
    ),
    score: server.requireActor('score') as ActorRef<PongScoreState, ScoreCommand>,
    lobby: server.requireActor('lobby') as ActorRef<PongLobbyState, PongLobbyCommand>,
    playerSession: await server.actors.playerSession.instance({ sessionId: browserSessionId }),
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

function browserLocalStorage() {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

async function resetGame(): Promise<void> {
  const currentRuntime = runtime;
  const currentRefs = refs;
  if (!currentRuntime || !currentRefs) {
    return;
  }

  matchStarted = false;
  clearMatchOwner();
  matchGeneration += 1;
  clearMlxControllerRequests();
  clearControllerDiagnostics();
  if (loopHandle !== null) {
    window.clearTimeout(loopHandle);
    loopHandle = null;
  }
  const nextSnapshot = await resetRuntimeGame(currentRuntime, currentRefs);
  if (runtime === currentRuntime && refs === currentRefs) {
    renderSnapshot(nextSnapshot);
    setStatus('lobby');
  }
}

async function startRuntimeForMode(mode: BrowserMode): Promise<BrowserRuntime> {
  const tools = createBrowserMlxTools({ storage: browserLocalStorage() });
  if (mode === 'local') {
    return startMeshPongLocal({ tools });
  }
  if (mode === 'broadcast') {
    return startMeshPongBroadcast({
      channelName: `mesh-pong-demo-${crypto.randomUUID()}`,
      tools,
    });
  }
  return startMeshPongMesh({
    channelName: `mesh-pong-demo-${crypto.randomUUID()}`,
    tools,
  });
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
  playerSessionState = null;
  matchStarted = false;
  clearMatchOwner();
  matchGeneration += 1;
  clearMlxControllerRequests();
  clearControllerDiagnostics();
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
    await hydrateCurrentSession(nextRuntime, nextRefs);

    if (switchGeneration !== generation) {
      await nextRuntime.stop().catch(() => undefined);
      return;
    }

    runtime = nextRuntime;
    refs = nextRefs;
    renderSnapshot(nextSnapshot);
    setStatus('lobby');
  } catch (error) {
    if (nextRuntime) {
      await nextRuntime.stop().catch(() => undefined);
    }
    if (switchGeneration === generation) {
      runtime = null;
      refs = null;
      loopHandle = null;
      clearMatchOwner();
      setStatus(error instanceof Error ? `start failed: ${error.message}` : 'start failed');
    }
  }
}

async function applyControllerInput(
  nextRuntime: BrowserRuntime,
  nextRefs: RuntimeRefs,
  input: Extract<PongControllerInputResult, { readonly ok: true }>
): Promise<void> {
  const paddle = input.side === 'left' ? nextRefs.paddleA : nextRefs.paddleB;
  await paddle.send({
    type: 'MOVE_PADDLE',
    direction: input.direction,
    amount: input.amount,
  });
  await flushRuntime(nextRuntime);
}

async function applyPaddleInput(
  nextRuntime: BrowserRuntime,
  nextRefs: RuntimeRefs,
  mode: PongMatchMode | null
): Promise<void> {
  const session = playerSessionState;
  if (!session?.side || mode?.controllers[session.side] !== 'human') {
    return;
  }

  const direction =
    session.side === 'left'
      ? keys.has('w')
        ? 'up'
        : keys.has('s')
          ? 'down'
          : null
      : keys.has('arrowup')
        ? 'up'
        : keys.has('arrowdown')
          ? 'down'
          : null;

  if (!direction) {
    return;
  }

  const input = await nextRefs.playerSession.ask<PongControllerInputResult>({
    type: 'MOVE_CONTROLLER',
    direction,
  });
  if (!input.ok) {
    return;
  }

  await applyControllerInput(nextRuntime, nextRefs, input);
  lobbyChannel?.postMessage({ type: 'controller-input', input } satisfies LobbyChannelMessage);
}

function isCurrentMlxRequest(request: MlxControllerRequest): boolean {
  return (
    mlxControllerRequests[request.side] === request &&
    request.matchGeneration === matchGeneration &&
    runtime === request.runtime &&
    refs === request.refs &&
    matchStarted
  );
}

async function stillControlsMlxSide(request: MlxControllerRequest): Promise<boolean> {
  if (!isCurrentMlxRequest(request)) {
    return false;
  }
  const lobby = await currentLobbyState(request.refs);
  return isCurrentMlxRequest(request) && lobby.mode?.controllers[request.side] === 'mlx';
}

async function resolveMlxControllerInput(request: MlxControllerRequest): Promise<void> {
  try {
    const result = await request.controller.ask<PongControllerResult>({
      type: 'RUN_CONTROLLER',
      snapshot: request.snapshot,
    });
    if (!(await stillControlsMlxSide(request))) {
      return;
    }
    if (!result.ok) {
      setControllerDiagnostic(result.side, result.reason);
      return;
    }

    clearControllerDiagnostic(result.side);
    if (!(await stillControlsMlxSide(request))) {
      return;
    }

    const input = createSyntheticMlxControllerInput(result);
    await applyControllerInput(request.runtime, request.refs, input);
    if (!(await stillControlsMlxSide(request))) {
      return;
    }
    lobbyChannel?.postMessage({ type: 'controller-input', input } satisfies LobbyChannelMessage);
  } catch (error) {
    if (await stillControlsMlxSide(request)) {
      setControllerDiagnostic(
        request.side,
        error instanceof Error ? error.message : 'controller error'
      );
    }
  } finally {
    if (mlxControllerRequests[request.side] === request) {
      delete mlxControllerRequests[request.side];
    }
  }
}

function launchMlxControllerInput(
  nextRuntime: BrowserRuntime,
  nextRefs: RuntimeRefs,
  side: PongSide,
  controller: ActorRef<PongControllerActorState, ControllerCommand>,
  snapshotState: PongSnapshot
): void {
  if (mlxControllerRequests[side]) {
    return;
  }
  const request: MlxControllerRequest = {
    runtime: nextRuntime,
    refs: nextRefs,
    side,
    controller,
    snapshot: snapshotState,
    matchGeneration,
  };
  mlxControllerRequests[side] = request;
  void resolveMlxControllerInput(request);
}

async function tick(): Promise<void> {
  const currentRuntime = runtime;
  const currentRefs = refs;
  if (!currentRuntime || !currentRefs || !matchStarted) {
    return;
  }

  try {
    const lobby = await currentLobbyState(currentRefs);
    await applyPaddleInput(currentRuntime, currentRefs, lobby.mode);
    const current = await snapshot(currentRefs);
    if (
      shouldLaunchMlxControllerForSide({
        browserSessionId,
        matchOwnerSessionId,
        mode: lobby.mode,
        side: 'left',
      })
    ) {
      launchMlxControllerInput(
        currentRuntime,
        currentRefs,
        'left',
        currentRefs.controllerLeft,
        current
      );
    }
    if (
      shouldLaunchMlxControllerForSide({
        browserSessionId,
        matchOwnerSessionId,
        mode: lobby.mode,
        side: 'right',
      })
    ) {
      launchMlxControllerInput(
        currentRuntime,
        currentRefs,
        'right',
        currentRefs.controllerRight,
        current
      );
    }
    const paddles = await Promise.all([
      currentRefs.paddleA.ask<PongPaddleState>({ type: 'GET_PADDLE' }),
      currentRefs.paddleB.ask<PongPaddleState>({ type: 'GET_PADDLE' }),
    ]);
    await currentRefs.ball.send({
      type: 'SET_PADDLES',
      leftY: paddles[0].y,
      rightY: paddles[1].y,
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

async function claimSide(side: 'left' | 'right'): Promise<void> {
  const currentRuntime = runtime;
  const currentRefs = refs;
  if (!currentRuntime || !currentRefs) {
    return;
  }

  await currentRefs.playerSession.send({
    type: 'CLAIM_SIDE',
    side,
    controller: 'human',
  });
  await flushRuntime(currentRuntime);
  await syncCurrentSession(currentRuntime, currentRefs);
  setStatus('claimed');
}

async function markReady(): Promise<void> {
  const currentRuntime = runtime;
  const currentRefs = refs;
  if (!currentRuntime || !currentRefs) {
    return;
  }

  await currentRefs.playerSession.send({ type: 'SET_READY', ready: true });
  await flushRuntime(currentRuntime);
  await syncCurrentSession(currentRuntime, currentRefs);
  setStatus('ready');
}

function formatStartFailure(result: Exclude<PongMatchStartResult, { readonly ok: true }>): string {
  return `${result.reason}: ${result.missing.join(', ')}`;
}

async function startMatch(
  mode: PongMatchMode,
  broadcast: boolean,
  ownerSessionId: string = browserSessionId
): Promise<void> {
  const currentRuntime = runtime;
  const currentRefs = refs;
  if (!currentRuntime || !currentRefs) {
    return;
  }

  matchGeneration += 1;
  clearMlxControllerRequests();
  clearControllerDiagnostics();
  await syncLobbyForMatchMode(currentRuntime, currentRefs, mode);
  const result = await currentRefs.lobby.ask<PongMatchStartResult>({
    type: 'START_MATCH',
    mode,
  });
  await flushRuntime(currentRuntime);
  renderLobby(await currentLobbyState(currentRefs));
  if (!result.ok) {
    matchStarted = false;
    clearMatchOwner();
    setStatus(formatStartFailure(result));
    return;
  }

  matchStarted = true;
  matchOwnerSessionId = ownerSessionId;
  setStatus('running');
  if (loopHandle === null) {
    loopHandle = window.setTimeout(tick, 90);
  }
  if (broadcast) {
    lobbyChannel?.postMessage({
      type: 'match-started',
      mode,
      ownerSessionId,
    } satisfies LobbyChannelMessage);
  }
}

async function syncCurrentLobbyFromStorage(): Promise<void> {
  const currentRuntime = runtime;
  const currentRefs = refs;
  if (!currentRuntime || !currentRefs) {
    return;
  }
  await syncStoredSessionsToLobby(currentRuntime, currentRefs);
}

playerCountSelectElement.value = String(TWO_HUMAN_PONG_MATCH_MODE.playerCount);
leftControllerSelectElement.value = TWO_HUMAN_PONG_MATCH_MODE.controllers.left;
rightControllerSelectElement.value = TWO_HUMAN_PONG_MATCH_MODE.controllers.right;
renderPlayerSession(null);

modeSelectElement.addEventListener('change', () => {
  const mode = modeSelectElement.value as PongTransportMode;
  if (mode === 'websocket') {
    modeSelectElement.value = selectedMode;
    setStatus('websocket loopback runs in CI');
    return;
  }
  void switchMode(mode);
});

claimLeftButtonElement.addEventListener('click', () => {
  void claimSide('left').catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : 'claim failed');
  });
});

claimRightButtonElement.addEventListener('click', () => {
  void claimSide('right').catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : 'claim failed');
  });
});

readyButtonElement.addEventListener('click', () => {
  void markReady().catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : 'ready failed');
  });
});

startButtonElement.addEventListener('click', () => {
  void startMatch(selectedMatchMode(), true).catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : 'start failed');
  });
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

lobbyChannel?.addEventListener('message', (event: MessageEvent<LobbyChannelMessage>) => {
  const message = event.data;
  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'sessions-updated') {
    void syncCurrentLobbyFromStorage().catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : 'lobby sync failed');
    });
    return;
  }

  if (message.type === 'controller-input') {
    if (message.input.sessionId === browserSessionId) {
      return;
    }
    const currentRuntime = runtime;
    const currentRefs = refs;
    if (!currentRuntime || !currentRefs || !matchStarted) {
      return;
    }
    void applyControllerInput(currentRuntime, currentRefs, message.input).catch(
      (error: unknown) => {
        setStatus(error instanceof Error ? error.message : 'remote input failed');
      }
    );
    return;
  }

  if (message.type === 'match-started') {
    void startMatch(message.mode, false, message.ownerSessionId).catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : 'start failed');
    });
  }
});

window.addEventListener('storage', (event) => {
  if (event.key !== LOBBY_STORAGE_KEY) {
    return;
  }
  void syncCurrentLobbyFromStorage().catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : 'lobby sync failed');
  });
});

void switchMode('local');
