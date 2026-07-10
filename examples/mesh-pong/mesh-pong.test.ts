import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ActorAgentLlmProvider,
  type ActorAgentLlmRequest,
  type ActorAgentLlmResult,
  createActorAgentTools,
} from '@actor-web/agent';
import { type ActorMessage, type ActorRef, createActorSource } from '@actor-web/runtime';
import type { ActorToolExecutionContext, BroadcastChannelLike } from '@actor-web/runtime/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserMlxLlmProvider,
  resolveBrowserMlxProviderConfig,
  type StorageLike,
} from './mlx-provider';
import { startMeshPongBroadcast, startMeshPongBroadcastClient } from './modes/broadcast';
import { startMeshPongLocal } from './modes/local';
import {
  createMeshPongWebSocketDevHelperClient,
  describeMeshPongWebSocketStatus,
  startMeshPongBrowserWebSocketClient,
  startMeshPongWebSocketLoopback,
} from './modes/websocket';
import {
  MESH_PONG_MODE_PARITY_PROOF,
  MESH_PONG_SHARED_PARITY_PROOF,
  parityProofForMode,
} from './parity-proof';
import type {
  BallCommand,
  ControllerCommand,
  PaddleCommand,
  PlayerSessionCommand,
  PongBallContext,
  PongControllerActorState,
  PongControllerInputResult,
  PongControllerResult,
  PongLobbyCommand,
  PongLobbyState,
  PongMatchCommand,
  PongMatchCommandResult,
  PongMatchStartResult,
  PongMatchState,
  PongPaddleState,
  PongPlayerSessionParams,
  PongPlayerSessionState,
  PongScoreState,
  PongSide,
  PongSnapshot,
  ScoreCommand,
} from './pong-contract';
import {
  advanceBall,
  createInitialBallContext,
  createInitialLobby,
  createInitialMatchState,
  createInitialPaddle,
  createInitialPlayerSession,
  createInitialScore,
  createMergedControllerAim,
  createPlannerSessionId,
  createPlannerStrategy,
  createReflexControllerAim,
  createSyntheticControllerSession,
  createSyntheticPlannerControllerInput,
  DEFAULT_PONG_SEED,
  normalizePongControllerType,
  PONG_FIELD,
  type PongShellMatchMode,
  removeMatchSession,
  shouldLaunchPlannerControllerForSide,
  startLobbyMatch,
  startMatchLifecycle,
  syncLobbySession,
  syncLobbySessionsFromStorage,
  syncMatchSession,
  TWO_HUMAN_PONG_MATCH_MODE,
  toLegacyPongControllerType,
  usesSyntheticControllerSlot,
} from './pong-contract';
import {
  CONTROLLER_LLM_TIMEOUT_MS,
  createPongControllerRequest,
  runPongControllerWithLlmProvider,
} from './pong-controller';
import {
  createInitialPongRoom,
  type PongRoomCommand,
  type PongRoomResult,
  type PongRoomState,
} from './pong-room-contract';
import { pong } from './pong-topology';
import {
  bootstrapMeshPongUI,
  createMeshPongBenchmarkSummaryState,
  createMeshPongClock,
  createMeshPongControllerInputReplayMessage,
  createMeshPongTelemetryState,
  createMeshPongTurnStepper,
  DEFAULT_MESH_PONG_CONTROLLER_SCHEDULE_POLICY,
  formatMeshPongBenchmarkSummary,
  formatMeshPongTelemetry,
  isProjectedMatchReadyToStart,
  MESH_PONG_STARTUP_TIMEOUT_MS,
  type MeshPongControllerSchedulePolicy,
  type MeshPongTelemetryEvent,
  reduceMeshPongBenchmarkSummary,
  reduceMeshPongTelemetry,
  resetRuntimeGame,
  resolveBrowserModeSelection,
  resolveBrowserRuntimeRefPath,
  restoreAndSyncMeshPongPlayerSession,
  runMeshPongStartupSubstages,
  withMeshPongStartupTimeout,
} from './ui/main';

type StartedMeshPongRuntime =
  | Awaited<ReturnType<typeof startMeshPongLocal>>
  | Awaited<ReturnType<typeof startMeshPongBroadcast>>
  | Awaited<ReturnType<typeof startMeshPongWebSocketLoopback>>;

const meshPongExamplesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class FakeBroadcastChannelNetwork {
  private readonly channels = new Set<FakeBroadcastChannel>();

  create = (name: string): BroadcastChannelLike => {
    const channel = new FakeBroadcastChannel(name, this);
    this.channels.add(channel);
    return channel;
  };

  delete(channel: FakeBroadcastChannel): void {
    this.channels.delete(channel);
  }

  size(): number {
    return this.channels.size;
  }

  publish(sender: FakeBroadcastChannel, data: unknown): void {
    for (const channel of Array.from(this.channels)) {
      if (channel !== sender && channel.name === sender.name) {
        channel.deliver(data);
      }
    }
  }
}

class FakeBroadcastChannel implements BroadcastChannelLike {
  private readonly listeners = new Set<EventListener>();
  private closed = false;

  constructor(
    readonly name: string,
    private readonly network: FakeBroadcastChannelNetwork
  ) {}

  postMessage(data: unknown): void {
    if (this.closed) {
      throw new Error(`BroadcastChannel ${this.name} is closed.`);
    }
    this.network.publish(this, data);
  }

  addEventListener(type: string, listener: EventListener): void {
    if (type === 'message') {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (type === 'message') {
      this.listeners.delete(listener);
    }
  }

  deliver(data: unknown): void {
    const event = { data } as MessageEvent;
    for (const listener of Array.from(this.listeners)) {
      listener(event);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.listeners.clear();
    this.network.delete(this);
  }
}

class FakeWebLocks {
  readonly activeNames = new Set<string>();
  readonly releasedNames: string[] = [];
  readonly requestLog: Array<{ readonly name: string; readonly granted: boolean }> = [];

  async request<T>(
    name: string,
    _options: { readonly ifAvailable: true },
    callback: (lock: { readonly name: string } | null) => Promise<T> | T
  ): Promise<T> {
    if (this.activeNames.has(name)) {
      this.requestLog.push({ name, granted: false });
      return callback(null);
    }
    this.activeNames.add(name);
    this.requestLog.push({ name, granted: true });
    try {
      return await callback({ name });
    } finally {
      this.activeNames.delete(name);
      this.releasedNames.push(name);
    }
  }
}

const startedRuntimes: StartedMeshPongRuntime[] = [];

interface MeshPongSessionRefs {
  readonly matchCoordinator: ActorRef<PongMatchState, PongMatchCommand>;
  readonly lobby: ActorRef<PongLobbyState, PongLobbyCommand>;
  readonly sessionA: ActorRef<PongPlayerSessionState, PlayerSessionCommand>;
  readonly sessionB: ActorRef<PongPlayerSessionState, PlayerSessionCommand>;
}

interface MeshPongControllerRefs {
  readonly left: ActorRef<PongControllerActorState, ControllerCommand>;
  readonly right: ActorRef<PongControllerActorState, ControllerCommand>;
}

interface MeshPongLookupNode {
  readonly system: {
    lookup(address: string): Promise<unknown>;
    flush(): Promise<void>;
  };
  requireActor(key: string): unknown;
  readonly actors: {
    readonly playerSession: {
      instance(
        params: PongPlayerSessionParams
      ): Promise<ActorRef<PongPlayerSessionState, PlayerSessionCommand>>;
    };
  };
}

afterEach(async () => {
  await Promise.allSettled(startedRuntimes.splice(0).map((runtime) => runtime.stop()));
});

function createToolExecutionContext(signal?: AbortSignal): ActorToolExecutionContext {
  const controller = new AbortController();
  return {
    actorId: 'mesh-pong-test',
    nodeAddress: 'browser',
    signal: signal ?? controller.signal,
  };
}

async function flush(runtime: StartedMeshPongRuntime): Promise<void> {
  if ('flush' in runtime) {
    await runtime.flush();
    return;
  }

  const localRuntime = runtime as StartedMeshPongRuntime & {
    readonly nodes: Record<string, { readonly system: { flush(): Promise<void> } } | undefined>;
  };
  await Promise.all(
    Object.values(localRuntime.nodes).map((nodeRuntime) => nodeRuntime?.system.flush())
  );
}

function serverNode(runtime: StartedMeshPongRuntime): MeshPongLookupNode {
  if ('server' in runtime) {
    return runtime.server as unknown as MeshPongLookupNode;
  }
  const clusterRuntime = runtime as StartedMeshPongRuntime & { readonly lookupNode?: unknown };
  if (clusterRuntime.lookupNode) {
    return clusterRuntime.lookupNode as MeshPongLookupNode;
  }

  const localRuntime = runtime as { readonly nodes: Record<string, unknown> };
  const server = localRuntime.nodes.server as unknown;
  if (!server) {
    throw new Error('Mesh Pong local runtime did not start the server node.');
  }
  return server as MeshPongLookupNode;
}

async function waitForActor<TContext, TMessage extends ActorMessage>(
  runtime: StartedMeshPongRuntime,
  address: string
): Promise<ActorRef<TContext, TMessage>> {
  const server = serverNode(runtime);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const actorRef = (await server.system.lookup(address)) as ActorRef<TContext, TMessage> | null;
    if (actorRef) {
      return actorRef;
    }
    await flush(runtime);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error(`Timed out resolving Mesh Pong actor ${address} from the server node.`);
}

async function createPlayerSession(
  runtime: StartedMeshPongRuntime,
  params: PongPlayerSessionParams
): Promise<ActorRef<PongPlayerSessionState, PlayerSessionCommand>> {
  const clientRuntime = runtime as StartedMeshPongRuntime & {
    readonly client?: {
      readonly actors: {
        readonly playerSession: {
          instance(
            params: PongPlayerSessionParams
          ): Promise<ActorRef<PongPlayerSessionState, PlayerSessionCommand>>;
        };
      };
    };
  };
  if (clientRuntime.client) {
    return clientRuntime.client.actors.playerSession.instance(params);
  }
  const localRuntime = runtime as StartedMeshPongRuntime & {
    readonly nodes?: Record<
      string,
      {
        readonly actors: {
          readonly playerSession: {
            instance(
              params: PongPlayerSessionParams
            ): Promise<ActorRef<PongPlayerSessionState, PlayerSessionCommand>>;
          };
        };
      }
    >;
  };
  if (localRuntime.nodes) {
    const client = localRuntime.nodes.client ?? localRuntime.nodes.server;
    if (!client) {
      throw new Error('Mesh Pong runtime did not start a client or server node.');
    }
    return client.actors.playerSession.instance(params);
  }
  const server = serverNode(runtime);
  return server.actors.playerSession.instance(params);
}

function isLobbyMatchMode(value: unknown): value is {
  readonly playerCount: 1 | 2;
  readonly controllers: { readonly left: 'human' | 'mlx'; readonly right: 'human' | 'mlx' };
} {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as {
    readonly playerCount?: unknown;
    readonly controllers?: { readonly left?: unknown; readonly right?: unknown };
  };
  return (
    (candidate.playerCount === 1 || candidate.playerCount === 2) &&
    (candidate.controllers?.left === 'human' || candidate.controllers?.left === 'mlx') &&
    (candidate.controllers?.right === 'human' || candidate.controllers?.right === 'mlx')
  );
}

function createLobbyRef(): ActorRef<PongLobbyState, PongLobbyCommand> {
  let lobbyState = createInitialLobby();
  return {
    ask: vi.fn(async (message: PongLobbyCommand) => {
      if (message.type === 'GET_LOBBY') {
        return lobbyState;
      }
      if (message.type === 'START_MATCH') {
        if (!isLobbyMatchMode(message.mode)) {
          return {
            ok: false,
            reason: 'invalid-command',
            missing: [],
          } satisfies PongMatchStartResult;
        }
        const result = startLobbyMatch(lobbyState, message.mode);
        lobbyState = result.lobby;
        return result.result;
      }
      if (message.type === 'SYNC_SESSION') {
        lobbyState = syncLobbySession(lobbyState, message.session);
        return lobbyState;
      }
      if (message.type === 'REMOVE_SESSION') {
        lobbyState = {
          ...lobbyState,
          sessions: lobbyState.sessions.filter(
            (session) => session.sessionId !== message.sessionId
          ),
          controllers: lobbyState.controllers.filter(
            (controller) => controller.sessionId !== message.sessionId
          ),
        };
        return lobbyState;
      }
      if (message.type === 'RESET_LOBBY') {
        lobbyState = createInitialLobby();
        return lobbyState;
      }
      return {
        ok: false,
        reason: 'invalid-command',
        missing: [],
      } satisfies PongMatchStartResult;
    }),
    send: vi.fn(async (message: PongLobbyCommand) => {
      if (message.type === 'SYNC_SESSION') {
        lobbyState = syncLobbySession(lobbyState, message.session);
        return;
      }
      if (message.type === 'REMOVE_SESSION') {
        lobbyState = {
          ...lobbyState,
          sessions: lobbyState.sessions.filter(
            (session) => session.sessionId !== message.sessionId
          ),
          controllers: lobbyState.controllers.filter(
            (controller) => controller.sessionId !== message.sessionId
          ),
        };
        return;
      }
      if (message.type === 'RESET_LOBBY') {
        lobbyState = createInitialLobby();
        return;
      }
      if (message.type === 'START_MATCH') {
        if (!isLobbyMatchMode(message.mode)) {
          return;
        }
        lobbyState = startLobbyMatch(lobbyState, message.mode).lobby;
      }
    }),
  } as unknown as ActorRef<PongLobbyState, PongLobbyCommand>;
}

async function resolveSessionRefs(runtime: StartedMeshPongRuntime): Promise<MeshPongSessionRefs> {
  const server = serverNode(runtime);
  return {
    matchCoordinator: server.requireActor('matchCoordinator') as ActorRef<
      PongMatchState,
      PongMatchCommand
    >,
    lobby: createLobbyRef(),
    sessionA: await createPlayerSession(runtime, { sessionId: 'tab-a' }),
    sessionB: await createPlayerSession(runtime, { sessionId: 'tab-b' }),
  };
}

async function currentMatchState(
  matchCoordinator: ActorRef<PongMatchState, PongMatchCommand>
): Promise<PongMatchState> {
  return matchCoordinator.ask<PongMatchState>({ type: 'GET_MATCH' });
}

async function syncCoordinatorSession(
  matchCoordinator: ActorRef<PongMatchState, PongMatchCommand>,
  session: ActorRef<PongPlayerSessionState, PlayerSessionCommand>
): Promise<void> {
  const state = await session.ask<PongPlayerSessionState>({ type: 'GET_SESSION' });
  const result = await matchCoordinator.ask<PongMatchCommandResult>({
    type: 'SYNC_SESSION',
    requestSessionId: state.sessionId,
    session: state,
  });
  if (!result.ok) {
    throw new Error(`Expected session sync, received ${result.reason}.`);
  }
}

async function resolveControllerRefs(
  runtime: StartedMeshPongRuntime
): Promise<MeshPongControllerRefs> {
  return {
    left: await waitForActor<PongControllerActorState, ControllerCommand>(
      runtime,
      pong.actors.controllerLeft.address
    ),
    right: await waitForActor<PongControllerActorState, ControllerCommand>(
      runtime,
      pong.actors.controllerRight.address
    ),
  };
}

async function currentSnapshot(runtime: StartedMeshPongRuntime): Promise<PongSnapshot> {
  const { matchCoordinator } = await resolveSessionRefs(runtime);
  const match = await currentMatchState(matchCoordinator);
  return match.snapshot;
}

async function resolveDistributedMatchCoordinator(
  runtime: StartedMeshPongRuntime
): Promise<ActorRef<PongMatchState, PongMatchCommand>> {
  return waitForActor<PongMatchState, PongMatchCommand>(
    runtime,
    pong.actors.matchCoordinator.address
  );
}

async function syncSyntheticMlxSession(
  lobby: ActorRef<PongLobbyState, PongLobbyCommand>,
  side: 'left' | 'right'
): Promise<void> {
  await lobby.send({
    type: 'SYNC_SESSION',
    session: {
      sessionId: createPlannerSessionId(side),
      controller: 'mlx',
      side,
      ready: true,
    },
  });
}

function createFakeMlxProvider(
  resolveContent: (request: ActorAgentLlmRequest) => string
): ActorAgentLlmProvider {
  return (request) => ({
    ok: true,
    value: {
      message: {
        role: 'assistant',
        content: resolveContent(request),
      },
    },
  });
}

function createStorage(entries: Record<string, string>): StorageLike {
  return {
    getItem(key: string) {
      return entries[key] ?? null;
    },
  };
}

async function syncSessionToLobby(
  lobby: ActorRef<PongLobbyState, PongLobbyCommand>,
  session: ActorRef<PongPlayerSessionState, PlayerSessionCommand>
): Promise<void> {
  const state = await session.ask<PongPlayerSessionState>({ type: 'GET_SESSION' });
  await lobby.send({ type: 'SYNC_SESSION', session: state });
}

async function prepareRunningMatch(
  runtime: StartedMeshPongRuntime
): Promise<ActorRef<PongMatchState, PongMatchCommand>> {
  const { matchCoordinator, sessionA, sessionB } = await resolveSessionRefs(runtime);
  await sessionA.send({ type: 'CLAIM_SIDE', side: 'left' });
  await sessionA.send({ type: 'SET_READY', ready: true });
  await sessionB.send({ type: 'CLAIM_SIDE', side: 'right' });
  await sessionB.send({ type: 'SET_READY', ready: true });
  await syncCoordinatorSession(matchCoordinator, sessionA);
  await syncCoordinatorSession(matchCoordinator, sessionB);
  await flush(runtime);
  await matchCoordinator.ask<PongMatchCommandResult>({
    type: 'START_MATCH',
    requestSessionId: 'tab-a',
    expectedGeneration: 0,
    mode: TWO_HUMAN_PONG_MATCH_MODE,
  });
  await flush(runtime);
  return matchCoordinator;
}

async function driveUntilNextScore(
  runtime: StartedMeshPongRuntime,
  matchCoordinator: ActorRef<PongMatchState, PongMatchCommand>,
  currentSequenceLength: number
): Promise<PongScoreState> {
  for (let tick = 0; tick < 40; tick += 1) {
    const currentMatch = await currentMatchState(matchCoordinator);
    const result = await matchCoordinator.ask<PongMatchCommandResult>({
      type: 'TICK_MATCH',
      requestSessionId: 'tab-a',
      expectedGeneration: currentMatch.generation,
    });
    expect(result.ok).toBe(true);
    await flush(runtime);

    const score = (await currentMatchState(matchCoordinator)).snapshot.score;
    if (score.sequence.length > currentSequenceLength) {
      return score;
    }
  }

  throw new Error('Mesh Pong did not score within the expected tick window.');
}

async function runScoreSequence(runtime: StartedMeshPongRuntime): Promise<string[]> {
  const matchCoordinator = await prepareRunningMatch(runtime);

  for (let tick = 0; tick < 28; tick += 1) {
    const currentMatch = await currentMatchState(matchCoordinator);
    await matchCoordinator.ask<PongMatchCommandResult>({
      type: 'TICK_MATCH',
      requestSessionId: 'tab-a',
      expectedGeneration: currentMatch.generation,
    });
    await flush(runtime);
  }

  const finalScore = (await currentMatchState(matchCoordinator)).snapshot.score;
  return finalScore.sequence.map(
    (point) => `${point.scorer}:${point.left}-${point.right}:r${point.rally}:t${point.tick}`
  );
}

async function captureSequence(
  start: () => Promise<StartedMeshPongRuntime>
): Promise<readonly string[]> {
  const runtime = await start();
  startedRuntimes.push(runtime);
  return runScoreSequence(runtime);
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createStepperSnapshot(
  paddles: { left: PongPaddleState; right: PongPaddleState },
  tick: number
): PongSnapshot {
  return {
    ball: {
      ...createInitialBallContext(DEFAULT_PONG_SEED).ball,
      rally: tick,
    },
    score: createInitialScore(),
    paddles,
  };
}

function createTurnStepperHarness(
  mode: PongShellMatchMode,
  options: {
    readonly applyHumanInput?: (mode: PongShellMatchMode | null) => Promise<boolean>;
    readonly applyFailure?: Exclude<PongMatchCommandResult, { readonly ok: true }>;
    readonly flushRuntime?: () => Promise<void>;
    readonly runMlxController?: (
      side: PongSide,
      snapshot: PongSnapshot
    ) => Promise<PongControllerResult>;
    readonly onSnapshot?: () => void;
    readonly schedulePolicy?: MeshPongControllerSchedulePolicy;
    readonly tickFailure?: Exclude<PongMatchCommandResult, { readonly ok: true }>;
  } = {}
) {
  const runtime = { kind: 'mesh-pong-test-runtime' } as unknown as Awaited<
    ReturnType<typeof startMeshPongLocal>
  >;
  const telemetryEvents: MeshPongTelemetryEvent[] = [];
  const statuses: string[] = [];
  const replayedInputs: Array<Extract<PongControllerInputResult, { readonly ok: true }>> = [];
  const renderedSnapshots: PongSnapshot[] = [];
  const commands: string[] = [];
  const leftDeferreds: Array<ReturnType<typeof createDeferred<PongControllerResult>>> = [];
  const rightDeferreds: Array<ReturnType<typeof createDeferred<PongControllerResult>>> = [];
  const leftAskTimeouts: number[] = [];
  const rightAskTimeouts: number[] = [];
  const matchState = {
    started: true,
    generation: 1,
    ownerSessionId: 'owner-tab',
    mode,
  };
  let now = 100;
  let tickCount = 0;
  let leftAskCount = 0;
  let rightAskCount = 0;
  let paddles = {
    left: createInitialPaddle('left'),
    right: createInitialPaddle('right'),
  };

  const makeMatch = (): PongMatchState => ({
    matchId: 'mesh-pong',
    generation: matchState.generation,
    phase: matchState.started ? 'running' : 'lobby',
    mode: {
      playerCount: matchState.mode.playerCount,
      controllers: {
        left: toLegacyPongControllerType(matchState.mode.controllers.left),
        right: toLegacyPongControllerType(matchState.mode.controllers.right),
      },
    },
    sessions: [],
    controllers: [],
    authoritySessionId: matchState.ownerSessionId,
    tick: tickCount,
    snapshot: createStepperSnapshot(paddles, tickCount),
  });

  const ball = {
    ask: vi.fn(async () => ({
      ball: createStepperSnapshot(paddles, tickCount).ball,
      leftPaddleY: paddles.left.y,
      rightPaddleY: paddles.right.y,
      tick: tickCount,
    })),
    send: vi.fn(async (message: BallCommand) => {
      commands.push(`ball:${message.type}`);
      if (message.type === 'TICK') {
        tickCount += 1;
      }
    }),
  } as unknown as ActorRef<PongBallContext, BallCommand>;

  const paddleA = {
    ask: vi.fn(async () => paddles.left),
    send: vi.fn(async (message: PaddleCommand) => {
      commands.push(`left:${message.type}`);
      if (message.type === 'MOVE_PADDLE') {
        paddles = {
          ...paddles,
          left: {
            ...paddles.left,
            y:
              message.direction === 'up'
                ? paddles.left.y - (message.amount ?? PONG_FIELD.paddleStep)
                : paddles.left.y + (message.amount ?? PONG_FIELD.paddleStep),
          },
        };
      }
      if (message.type === 'SET_PADDLE') {
        paddles = {
          ...paddles,
          left: {
            ...paddles.left,
            y: message.y,
          },
        };
      }
    }),
  } as unknown as ActorRef<PongPaddleState, PaddleCommand>;

  const paddleB = {
    ask: vi.fn(async () => paddles.right),
    send: vi.fn(async (message: PaddleCommand) => {
      commands.push(`right:${message.type}`);
      if (message.type === 'MOVE_PADDLE') {
        paddles = {
          ...paddles,
          right: {
            ...paddles.right,
            y:
              message.direction === 'up'
                ? paddles.right.y - (message.amount ?? PONG_FIELD.paddleStep)
                : paddles.right.y + (message.amount ?? PONG_FIELD.paddleStep),
          },
        };
      }
      if (message.type === 'SET_PADDLE') {
        paddles = {
          ...paddles,
          right: {
            ...paddles.right,
            y: message.y,
          },
        };
      }
    }),
  } as unknown as ActorRef<PongPaddleState, PaddleCommand>;

  const controllerLeft = {
    ask: vi.fn((_message: ControllerCommand, timeoutMs?: number) => {
      leftAskCount += 1;
      if (timeoutMs !== undefined) {
        leftAskTimeouts.push(timeoutMs);
      }
      const deferred = createDeferred<PongControllerResult>();
      leftDeferreds.push(deferred);
      return deferred.promise;
    }),
  } as unknown as ActorRef<PongControllerActorState, ControllerCommand>;

  const controllerRight = {
    ask: vi.fn((_message: ControllerCommand, timeoutMs?: number) => {
      rightAskCount += 1;
      if (timeoutMs !== undefined) {
        rightAskTimeouts.push(timeoutMs);
      }
      const deferred = createDeferred<PongControllerResult>();
      rightDeferreds.push(deferred);
      return deferred.promise;
    }),
  } as unknown as ActorRef<PongControllerActorState, ControllerCommand>;

  const refs = {
    ball,
    controllerLeft,
    controllerRight,
    matchCoordinator: {
      ask: vi.fn(async (message: PongMatchCommand) => {
        if (message.type === 'GET_MATCH') {
          return makeMatch();
        }
        if (message.type === 'APPLY_CONTROLLER_INPUT') {
          if (options.applyFailure) {
            return options.applyFailure;
          }
          const key = message.input.side;
          const amount = message.input.amount;
          commands.push(`${key === 'left' ? 'left' : 'right'}:MOVE_PADDLE`);
          paddles = {
            ...paddles,
            [key]: {
              ...paddles[key],
              y:
                message.input.direction === 'up'
                  ? paddles[key].y - amount
                  : paddles[key].y + amount,
            },
          };
          return { ok: true, match: makeMatch() } satisfies PongMatchCommandResult;
        }
        if (message.type === 'TICK_MATCH') {
          if (options.tickFailure) {
            return options.tickFailure;
          }
          commands.push('ball:TICK');
          tickCount += 1;
          return { ok: true, match: makeMatch() } satisfies PongMatchCommandResult;
        }
        return { ok: true, match: makeMatch() } satisfies PongMatchCommandResult;
      }),
    } as unknown as ActorRef<PongMatchState, PongMatchCommand>,
    room: {
      ask: vi.fn(async () => ({
        ok: true,
        room: createInitialPongRoom('test-room'),
      })),
    } as unknown as ActorRef<PongRoomState, PongRoomCommand>,
    score: {
      ask: vi.fn(async () => createInitialScore()),
    } as unknown as ActorRef<PongScoreState, ScoreCommand>,
    lobby: {
      ask: vi.fn(async () => createInitialLobby()),
    } as unknown as ActorRef<PongLobbyState, PongLobbyCommand>,
    playerSession: {
      ask: vi.fn(async () => createInitialPlayerSession('owner-tab')),
    } as unknown as ActorRef<PongPlayerSessionState, PlayerSessionCommand>,
    paddleA,
    paddleB,
  };

  const stepper = createMeshPongTurnStepper({
    runtime,
    refs,
    browserSessionId: 'owner-tab',
    getMatchState: () => ({
      phase: matchState.started ? 'running' : 'lobby',
      matchGeneration: matchState.generation,
      matchOwnerSessionId: matchState.ownerSessionId,
      mode: matchState.mode,
    }),
    nowMs: () => {
      now += 5;
      return now;
    },
    schedulePolicy: options.schedulePolicy,
    flushRuntime: options.flushRuntime ?? (async () => undefined),
    snapshot: async () => {
      options.onSnapshot?.();
      return createStepperSnapshot(paddles, tickCount);
    },
    renderSnapshot: (nextSnapshot) => {
      renderedSnapshots.push(nextSnapshot);
    },
    setStatus: (status) => {
      statuses.push(status);
    },
    updateTelemetry: (event) => {
      telemetryEvents.push(event);
    },
    postControllerInput: (input) => {
      replayedInputs.push(input);
    },
    setControllerDiagnostic: () => undefined,
    clearControllerDiagnostic: () => undefined,
    applyHumanInput: options.applyHumanInput,
  });

  return {
    commands,
    leftDeferreds,
    matchState,
    replayedInputs,
    renderedSnapshots,
    rightDeferreds,
    statuses,
    stepper,
    telemetryEvents,
    tickCount: () => tickCount,
    leftAskCount: () => leftAskCount,
    leftAskTimeouts: () => leftAskTimeouts,
    rightAskCount: () => rightAskCount,
    rightAskTimeouts: () => rightAskTimeouts,
  };
}

describe('Mesh Pong transport parity', () => {
  it('derives cross-tab epoch timestamps from a shared clock source', () => {
    const clock = createMeshPongClock({
      timeOrigin: 1_000,
      now: () => 80,
    });

    expect(clock.nowMs()).toBe(80);
    expect(clock.nowEpochMs()).toBe(1_080);
  });

  it('tracks held and applied simulation turns in telemetry state', () => {
    let telemetry = createMeshPongTelemetryState(0);

    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'simulation-scheduled',
      nowMs: 90,
    });
    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'simulation-held',
      nowMs: 90,
    });
    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'simulation-scheduled',
      nowMs: 180,
    });
    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'simulation-applied',
      nowMs: 180,
    });

    expect(telemetry.simulation.scheduledCount).toBe(2);
    expect(telemetry.simulation.heldCount).toBe(1);
    expect(telemetry.simulation.appliedCount).toBe(1);
    expect(telemetry.simulation.lastScheduledGapMs).toBe(90);
  });

  it('derives dropped turns from the simulation scheduling gap', () => {
    let telemetry = createMeshPongTelemetryState(0);

    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'simulation-scheduled',
      nowMs: 90,
    });
    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'simulation-scheduled',
      nowMs: 370,
    });

    expect(telemetry.simulation.lastScheduledGapMs).toBe(280);
    expect(telemetry.simulation.droppedCount).toBe(2);
  });

  it('formats render, simulation, and per-side controller telemetry facts', () => {
    let telemetry = createMeshPongTelemetryState(0);

    telemetry = reduceMeshPongTelemetry(telemetry, { type: 'rendered', nowMs: 16 });
    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'simulation-scheduled',
      nowMs: 90,
    });
    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'simulation-applied',
      nowMs: 92,
    });
    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'controller-request-started',
      side: 'left',
      mode: 'planner',
      nowMs: 100,
    });
    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'controller-request-finished',
      side: 'left',
      mode: 'planner',
      nowMs: 145,
      outcome: 'ready',
      strategyStatus: 'fresh',
      detail: 't278 planner-target',
    });
    expect(telemetry.controllers.left.outcome).toBe('ready');
    expect(telemetry.controllers.left.lastAppliedIntentAgeMs).toBeNull();

    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'controller-intent-applied',
      side: 'left',
      mode: 'planner',
      source: 'planner',
      strategyStatus: 'fresh',
      detail: 't278 planner-target',
      nowMs: 150,
      sentAtMs: 138,
    });
    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'controller-request-finished',
      side: 'right',
      mode: 'hybrid',
      nowMs: 151,
      outcome: 'error',
      strategyStatus: 'error',
      error: 'provider-failed',
    });

    const formatted = formatMeshPongTelemetry(telemetry);

    expect(formatted.render).toContain('frames');
    expect(formatted.simulation).toContain('90ms');
    expect(formatted.simulation).toContain('applied 1');
    expect(formatted.leftController).toContain('m planner');
    expect(formatted.leftController).toContain('src planner');
    expect(formatted.leftController).toContain('st fresh');
    expect(formatted.leftController).toContain('aim t278 planner-target');
    expect(formatted.leftController).toContain('rtt 45ms');
    expect(formatted.leftController).toContain('age 12ms');
    expect(formatted.rightController).toContain('provider-failed');
  });

  it('captures fallback and stale strategy details in per-side telemetry', () => {
    let telemetry = createMeshPongTelemetryState(0);

    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'controller-request-started',
      side: 'right',
      mode: 'hybrid',
      nowMs: 100,
    });
    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'controller-request-finished',
      side: 'right',
      mode: 'hybrid',
      nowMs: 150,
      outcome: 'ready',
      strategyStatus: 'fresh',
      detail: 't140 shadow-bottom',
    });
    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'controller-intent-applied',
      side: 'right',
      mode: 'hybrid',
      source: 'hybrid',
      strategyStatus: 'stale',
      detail: 't140/i92 shadow-bottom',
      nowMs: 172,
      sentAtMs: 120,
    });

    expect(telemetry.controllers.right.mode).toBe('hybrid');
    expect(telemetry.controllers.right.appliedSource).toBe('hybrid');
    expect(telemetry.controllers.right.strategyStatus).toBe('stale');
    expect(telemetry.controllers.right.detail).toBe('t140/i92 shadow-bottom');
    expect(formatMeshPongTelemetry(telemetry).rightController).toContain('st stale');
  });

  it('records controller RTT, replay latency, and applied intent age from injected timestamps', () => {
    let telemetry = createMeshPongTelemetryState(0);

    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'controller-request-started',
      side: 'left',
      mode: 'planner',
      nowMs: 100,
    });
    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'controller-request-finished',
      side: 'left',
      mode: 'planner',
      nowMs: 160,
      outcome: 'ready',
      strategyStatus: 'fresh',
      detail: 't0 hug-top',
    });
    expect(telemetry.controllers.left.outcome).toBe('ready');
    expect(telemetry.controllers.left.lastAppliedIntentAtMs).toBeNull();
    expect(telemetry.controllers.left.lastAppliedIntentAgeMs).toBeNull();

    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'replay-sent',
      originSessionId: 'session-a',
      sentAtMs: 162,
    });
    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'replay-received',
      originSessionId: 'session-a',
      sentAtMs: 162,
      receivedAtMs: 171,
    });
    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'controller-intent-applied',
      side: 'left',
      mode: 'planner',
      source: 'planner',
      strategyStatus: 'fresh',
      detail: 't0 hug-top',
      nowMs: 180,
      sentAtMs: 162,
    });

    expect(telemetry.controllers.left.rttMs).toBe(60);
    expect(telemetry.controllers.left.lastAppliedIntentAgeMs).toBe(18);
    expect(telemetry.replay.latencyMs).toBe(9);
  });

  it('preserves non-human controller telemetry through controller-input replay payloads', () => {
    const sentAtMs = 1_000;
    const receivedAtMs = 1_045;
    const message = createMeshPongControllerInputReplayMessage({
      input: createSyntheticPlannerControllerInput('right', {
        side: 'right',
        direction: 'up',
        amount: 7,
      }),
      originSessionId: 'owner-tab',
      sentAtMs,
      controllerTelemetry: {
        mode: 'hybrid',
        source: 'hybrid',
        strategyStatus: 'stale',
        detail: 't140/i92 shadow-bottom',
      },
    });

    expect(message.controllerTelemetry).toEqual({
      mode: 'hybrid',
      source: 'hybrid',
      strategyStatus: 'stale',
      detail: 't140/i92 shadow-bottom',
    });
    const controllerTelemetry = message.controllerTelemetry;
    expect(controllerTelemetry).toBeDefined();
    if (!controllerTelemetry) {
      throw new Error('controller telemetry missing from replay message');
    }

    let telemetry = createMeshPongTelemetryState(0);
    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'replay-received',
      originSessionId: message.replay.originSessionId,
      sentAtMs: message.replay.sentAtMs,
      receivedAtMs,
    });
    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'controller-intent-applied',
      side: message.input.side,
      mode: controllerTelemetry.mode,
      source: controllerTelemetry.source,
      strategyStatus: controllerTelemetry.strategyStatus,
      detail: controllerTelemetry.detail,
      nowMs: receivedAtMs,
      sentAtMs: message.replay.sentAtMs,
    });

    expect(telemetry.controllers.right.mode).toBe('hybrid');
    expect(telemetry.controllers.right.appliedSource).toBe('hybrid');
    expect(telemetry.controllers.right.strategyStatus).toBe('stale');
    expect(telemetry.controllers.right.detail).toBe('t140/i92 shadow-bottom');
    expect(telemetry.controllers.right.lastAppliedIntentAgeMs).toBe(45);
    expect(formatMeshPongTelemetry(telemetry).rightController).toContain('src hybrid');
    expect(formatMeshPongTelemetry(telemetry).rightController).toContain('st stale');
  });

  it('uses epoch timestamps for cross-tab replay latency without poisoning benchmark rates', () => {
    const remoteClock = createMeshPongClock({
      timeOrigin: 1_000,
      now: () => 80,
    });
    const sentAtEpochMs = 1_000;
    const receivedAtEpochMs = remoteClock.nowEpochMs();
    let telemetry = createMeshPongTelemetryState(5);
    let summary = reduceMeshPongBenchmarkSummary(createMeshPongBenchmarkSummaryState(5), {
      type: 'simulation-scheduled',
      nowMs: 95,
    });

    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'replay-sent',
      originSessionId: 'remote-tab',
      sentAtMs: sentAtEpochMs,
    });
    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'replay-received',
      originSessionId: 'remote-tab',
      sentAtMs: sentAtEpochMs,
      receivedAtMs: receivedAtEpochMs,
    });
    telemetry = reduceMeshPongTelemetry(telemetry, {
      type: 'controller-intent-applied',
      side: 'left',
      mode: 'planner',
      source: 'planner',
      strategyStatus: 'fresh',
      detail: 't0 hug-top',
      nowMs: receivedAtEpochMs,
      sentAtMs: sentAtEpochMs,
    });
    for (const event of [
      {
        type: 'replay-sent',
        originSessionId: 'remote-tab',
        sentAtMs: sentAtEpochMs,
      },
      {
        type: 'replay-received',
        originSessionId: 'remote-tab',
        sentAtMs: sentAtEpochMs,
        receivedAtMs: receivedAtEpochMs,
      },
      {
        type: 'controller-intent-applied',
        side: 'left',
        mode: 'planner',
        source: 'planner',
        strategyStatus: 'fresh',
        detail: 't0 hug-top',
        nowMs: receivedAtEpochMs,
        sentAtMs: sentAtEpochMs,
      },
    ] satisfies MeshPongTelemetryEvent[]) {
      summary = reduceMeshPongBenchmarkSummary(summary, event);
    }

    expect(telemetry.replay.latencyMs).toBe(80);
    expect(telemetry.controllers.left.lastAppliedIntentAgeMs).toBe(80);
    expect(summary.updatedAtMs).toBe(95);
    expect(summary.controllers.throughputPerSec).toBe(0);
  });

  it('reduces benchmark summary metrics for latency, throughput, timeouts, and lag classification', () => {
    let summary = createMeshPongBenchmarkSummaryState(0);

    summary = reduceMeshPongBenchmarkSummary(summary, {
      type: 'simulation-scheduled',
      nowMs: 90,
    });
    summary = reduceMeshPongBenchmarkSummary(summary, {
      type: 'simulation-applied',
      nowMs: 90,
    });
    summary = reduceMeshPongBenchmarkSummary(summary, {
      type: 'controller-request-started',
      side: 'left',
      mode: 'planner',
      nowMs: 100,
    });
    summary = reduceMeshPongBenchmarkSummary(summary, {
      type: 'controller-request-finished',
      side: 'left',
      mode: 'planner',
      nowMs: 160,
      outcome: 'ready',
    });
    summary = reduceMeshPongBenchmarkSummary(summary, {
      type: 'controller-intent-applied',
      side: 'left',
      mode: 'planner',
      source: 'planner',
      strategyStatus: 'fresh',
      detail: 't0 hug-top',
      nowMs: 170,
      sentAtMs: 150,
    });
    summary = reduceMeshPongBenchmarkSummary(summary, {
      type: 'simulation-scheduled',
      nowMs: 270,
    });
    summary = reduceMeshPongBenchmarkSummary(summary, {
      type: 'simulation-held',
      nowMs: 270,
    });
    summary = reduceMeshPongBenchmarkSummary(summary, {
      type: 'controller-request-started',
      side: 'right',
      mode: 'planner',
      nowMs: 280,
    });
    summary = reduceMeshPongBenchmarkSummary(summary, {
      type: 'controller-request-finished',
      side: 'right',
      mode: 'planner',
      nowMs: 400,
      outcome: 'error',
      error: 'controller-timeout',
    });

    expect(summary.controllers.startedCount).toBe(2);
    expect(summary.controllers.finishedCount).toBe(2);
    expect(summary.controllers.timeoutCount).toBe(1);
    expect(summary.controllers.latency.count).toBe(2);
    expect(summary.controllers.latency.totalMs).toBe(180);
    expect(summary.controllers.latency.minMs).toBe(60);
    expect(summary.controllers.latency.maxMs).toBe(120);
    expect(summary.controllers.latency.averageMs).toBe(90);
    expect(summary.controllers.throughputPerSec).toBeCloseTo(5, 5);
    expect(summary.simulation.scheduledCount).toBe(2);
    expect(summary.simulation.appliedCount).toBe(1);
    expect(summary.simulation.heldCount).toBe(1);
    expect(summary.simulation.droppedCount).toBe(1);
    expect(summary.simulation.appliedPerSec).toBeCloseTo(2.5, 5);
    expect(summary.timeoutRate).toBe(0.5);
    expect(summary.gameplayEffect).toBe('timeout-bound');
  });

  it('classifies stalled and smooth benchmark outcomes deterministically', () => {
    const stalled = formatMeshPongBenchmarkSummary(createMeshPongBenchmarkSummaryState(0));
    expect(stalled).toContain('effect stalled');

    let smooth = createMeshPongBenchmarkSummaryState(0);
    smooth = reduceMeshPongBenchmarkSummary(smooth, {
      type: 'simulation-scheduled',
      nowMs: 90,
    });
    smooth = reduceMeshPongBenchmarkSummary(smooth, {
      type: 'simulation-applied',
      nowMs: 90,
    });
    smooth = reduceMeshPongBenchmarkSummary(smooth, {
      type: 'controller-request-started',
      side: 'left',
      mode: 'planner',
      nowMs: 100,
    });
    smooth = reduceMeshPongBenchmarkSummary(smooth, {
      type: 'controller-request-finished',
      side: 'left',
      mode: 'planner',
      nowMs: 150,
      outcome: 'ready',
    });

    expect(formatMeshPongBenchmarkSummary(smooth)).toContain('effect smooth');
  });

  it('classifies benchmark outcomes as controller-delayed when controller latency exceeds the simulation budget', () => {
    let delayed = createMeshPongBenchmarkSummaryState(0);
    delayed = reduceMeshPongBenchmarkSummary(delayed, {
      type: 'simulation-scheduled',
      nowMs: 90,
    });
    delayed = reduceMeshPongBenchmarkSummary(delayed, {
      type: 'simulation-applied',
      nowMs: 90,
    });
    delayed = reduceMeshPongBenchmarkSummary(delayed, {
      type: 'controller-request-started',
      side: 'left',
      mode: 'planner',
      nowMs: 100,
    });
    delayed = reduceMeshPongBenchmarkSummary(delayed, {
      type: 'controller-request-finished',
      side: 'left',
      mode: 'planner',
      nowMs: 220,
      outcome: 'ready',
    });

    expect(delayed.controllers.latency.averageMs).toBe(120);
    expect(delayed.timeoutRate).toBe(0);
    expect(delayed.gameplayEffect).toBe('controller-delayed');
    expect(formatMeshPongBenchmarkSummary(delayed)).toContain('effect controller-delayed');
  });

  it('classifies benchmark outcomes as laggy when simulation turns are held or dropped', () => {
    let laggy = createMeshPongBenchmarkSummaryState(0);
    laggy = reduceMeshPongBenchmarkSummary(laggy, {
      type: 'simulation-scheduled',
      nowMs: 90,
    });
    laggy = reduceMeshPongBenchmarkSummary(laggy, {
      type: 'simulation-applied',
      nowMs: 90,
    });
    laggy = reduceMeshPongBenchmarkSummary(laggy, {
      type: 'simulation-scheduled',
      nowMs: 270,
    });
    laggy = reduceMeshPongBenchmarkSummary(laggy, {
      type: 'simulation-applied',
      nowMs: 270,
    });
    laggy = reduceMeshPongBenchmarkSummary(laggy, {
      type: 'controller-request-started',
      side: 'left',
      mode: 'planner',
      nowMs: 280,
    });
    laggy = reduceMeshPongBenchmarkSummary(laggy, {
      type: 'controller-request-finished',
      side: 'left',
      mode: 'planner',
      nowMs: 320,
      outcome: 'ready',
    });

    expect(laggy.simulation.droppedCount).toBe(1);
    expect(laggy.gameplayEffect).toBe('laggy');
    expect(formatMeshPongBenchmarkSummary(laggy)).toContain('effect laggy');
  });

  it('exports the browser helper surface without requiring DOM bootstrap', async () => {
    const module = await import('./ui/main');

    expect(typeof module.createMeshPongBenchmarkSummaryState).toBe('function');
    expect(typeof module.createMeshPongTelemetryState).toBe('function');
    expect(typeof module.reduceMeshPongBenchmarkSummary).toBe('function');
    expect(typeof module.reduceMeshPongTelemetry).toBe('function');
    expect(typeof module.formatMeshPongBenchmarkSummary).toBe('function');
    expect(typeof module.formatMeshPongTelemetry).toBe('function');
    expect(typeof module.createMeshPongControllerInputReplayMessage).toBe('function');
    expect(typeof module.bootstrapMeshPongUI).toBe('function');
    expect(bootstrapMeshPongUI).toBe(module.bootstrapMeshPongUI);
  });

  it('creates one player session actor per browser session', async () => {
    const runtime = await startMeshPongLocal();
    startedRuntimes.push(runtime);

    const { sessionA, sessionB } = await resolveSessionRefs(runtime);

    expect(sessionA.address).toBe('actor://pong-client-local/player-session-tab-a');
    expect(sessionB.address).toBe('actor://pong-client-local/player-session-tab-b');
    expect(sessionA.address).not.toBe(sessionB.address);

    await sessionA.send({ type: 'CLAIM_SIDE', side: 'left' });
    await sessionA.send({ type: 'SET_READY', ready: true });
    await flush(runtime);

    await expect(sessionA.ask<PongPlayerSessionState>({ type: 'GET_SESSION' })).resolves.toEqual({
      sessionId: 'tab-a',
      controller: 'human',
      side: 'left',
      ready: true,
    });
  });

  it('requires both human controller slots to be ready before starting a two-player match', async () => {
    const runtime = await startMeshPongLocal();
    startedRuntimes.push(runtime);
    const { lobby, sessionA, sessionB } = await resolveSessionRefs(runtime);

    await lobby.send({ type: 'RESET_LOBBY' });
    await flush(runtime);

    await expect(
      lobby.ask<PongMatchStartResult>({
        type: 'START_MATCH',
        mode: {
          playerCount: 2,
          controllers: { left: 'human', right: 'human' },
        },
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'missing-controller',
      missing: ['left', 'right'],
    });

    await sessionA.send({ type: 'CLAIM_SIDE', side: 'left' });
    await sessionA.send({ type: 'SET_READY', ready: true });
    await syncSessionToLobby(lobby, sessionA);
    await flush(runtime);

    await expect(
      lobby.ask<PongMatchStartResult>({
        type: 'START_MATCH',
        mode: {
          playerCount: 2,
          controllers: { left: 'human', right: 'human' },
        },
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'missing-controller',
      missing: ['right'],
    });

    await sessionB.send({ type: 'CLAIM_SIDE', side: 'right' });
    await sessionB.send({ type: 'SET_READY', ready: true });
    const input = await sessionB.ask<PongControllerInputResult>({
      type: 'MOVE_CONTROLLER',
      direction: 'up',
    });
    await syncSessionToLobby(lobby, sessionB);
    await flush(runtime);

    expect(input).toEqual({
      ok: true,
      sessionId: 'tab-b',
      side: 'right',
      direction: 'up',
      amount: PONG_FIELD.paddleStep,
    });
    await expect(
      lobby.ask<PongMatchStartResult>({
        type: 'START_MATCH',
        mode: {
          playerCount: 2,
          controllers: { left: 'human', right: 'human' },
        },
      })
    ).resolves.toEqual({
      ok: true,
      mode: {
        playerCount: 2,
        controllers: { left: 'human', right: 'human' },
      },
      controllers: [
        { sessionId: 'tab-a', controller: 'human', side: 'left', ready: true },
        { sessionId: 'tab-b', controller: 'human', side: 'right', ready: true },
      ],
    });
  });

  it('returns stale-generation data failures for authoritative lifecycle commands', async () => {
    const runtime = await startMeshPongLocal();
    startedRuntimes.push(runtime);
    const { matchCoordinator, sessionA, sessionB } = await resolveSessionRefs(runtime);

    await sessionA.send({ type: 'CLAIM_SIDE', side: 'left' });
    await sessionA.send({ type: 'SET_READY', ready: true });
    await sessionB.send({ type: 'CLAIM_SIDE', side: 'right' });
    await sessionB.send({ type: 'SET_READY', ready: true });
    await syncCoordinatorSession(matchCoordinator, sessionA);
    await syncCoordinatorSession(matchCoordinator, sessionB);
    await flush(runtime);

    await expect(
      matchCoordinator.ask<PongMatchCommandResult>({
        type: 'START_MATCH',
        requestSessionId: 'tab-a',
        expectedGeneration: 0,
        mode: TWO_HUMAN_PONG_MATCH_MODE,
      })
    ).resolves.toMatchObject({
      ok: true,
      match: {
        generation: 1,
        authoritySessionId: 'tab-a',
        phase: 'running',
      },
    });

    await expect(
      matchCoordinator.ask<PongMatchCommandResult>({
        type: 'RESTART_MATCH',
        requestSessionId: 'tab-b',
        expectedGeneration: 0,
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'stale-generation',
      expectedGeneration: 0,
      actualGeneration: 1,
    });
    await expect(currentMatchState(matchCoordinator)).resolves.toMatchObject({
      generation: 1,
      authoritySessionId: 'tab-a',
      phase: 'running',
    });
  });

  it('rejects spectator lifecycle and tick commands as data instead of mutating the match', async () => {
    const runtime = await startMeshPongLocal();
    startedRuntimes.push(runtime);
    const { matchCoordinator, sessionA, sessionB } = await resolveSessionRefs(runtime);
    const spectator = await createPlayerSession(runtime, { sessionId: 'spectator-tab' });

    await sessionA.send({ type: 'CLAIM_SIDE', side: 'left' });
    await sessionA.send({ type: 'SET_READY', ready: true });
    await sessionB.send({ type: 'CLAIM_SIDE', side: 'right' });
    await sessionB.send({ type: 'SET_READY', ready: true });
    await syncCoordinatorSession(matchCoordinator, sessionA);
    await syncCoordinatorSession(matchCoordinator, sessionB);
    await syncCoordinatorSession(matchCoordinator, spectator);
    await flush(runtime);

    await matchCoordinator.ask<PongMatchCommandResult>({
      type: 'START_MATCH',
      requestSessionId: 'tab-a',
      expectedGeneration: 0,
      mode: TWO_HUMAN_PONG_MATCH_MODE,
    });
    await flush(runtime);

    await expect(
      matchCoordinator.ask<PongMatchCommandResult>({
        type: 'RESTART_MATCH',
        requestSessionId: 'spectator-tab',
        expectedGeneration: 1,
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'not-seated-player',
      requestSessionId: 'spectator-tab',
    });
    await expect(
      matchCoordinator.ask<PongMatchCommandResult>({
        type: 'TICK_MATCH',
        requestSessionId: 'spectator-tab',
        expectedGeneration: 1,
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'not-authority',
      authoritySessionId: 'tab-a',
      requestSessionId: 'spectator-tab',
    });
  });

  it('prevents a spectator from removing the authority session', async () => {
    const runtime = await startMeshPongLocal();
    startedRuntimes.push(runtime);
    const { matchCoordinator, sessionA, sessionB } = await resolveSessionRefs(runtime);

    await sessionA.send({ type: 'CLAIM_SIDE', side: 'left' });
    await sessionA.send({ type: 'SET_READY', ready: true });
    await sessionB.send({ type: 'CLAIM_SIDE', side: 'right' });
    await sessionB.send({ type: 'SET_READY', ready: true });
    await syncCoordinatorSession(matchCoordinator, sessionA);
    await syncCoordinatorSession(matchCoordinator, sessionB);
    await matchCoordinator.ask<PongMatchCommandResult>({
      type: 'START_MATCH',
      requestSessionId: 'tab-a',
      expectedGeneration: 0,
      mode: TWO_HUMAN_PONG_MATCH_MODE,
    });

    await expect(
      matchCoordinator.ask<PongMatchCommandResult>({
        type: 'REMOVE_SESSION',
        requestSessionId: 'spectator-tab',
        sessionId: 'tab-a',
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'not-session-owner',
      requestSessionId: 'spectator-tab',
      sessionId: 'tab-a',
    });
    await expect(currentMatchState(matchCoordinator)).resolves.toMatchObject({
      phase: 'running',
      generation: 1,
      authoritySessionId: 'tab-a',
      sessions: expect.arrayContaining([expect.objectContaining({ sessionId: 'tab-a' })]),
    });
  });

  it('locks active seats while allowing self-authored late spectator hydration', async () => {
    const runtime = await startMeshPongLocal();
    startedRuntimes.push(runtime);
    const { matchCoordinator, sessionA, sessionB } = await resolveSessionRefs(runtime);

    await sessionA.send({ type: 'CLAIM_SIDE', side: 'left' });
    await sessionA.send({ type: 'SET_READY', ready: true });
    await sessionB.send({ type: 'CLAIM_SIDE', side: 'right' });
    await sessionB.send({ type: 'SET_READY', ready: true });
    await syncCoordinatorSession(matchCoordinator, sessionA);
    await syncCoordinatorSession(matchCoordinator, sessionB);
    await matchCoordinator.ask<PongMatchCommandResult>({
      type: 'START_MATCH',
      requestSessionId: 'tab-a',
      expectedGeneration: 0,
      mode: TWO_HUMAN_PONG_MATCH_MODE,
    });

    await expect(
      matchCoordinator.ask<PongMatchCommandResult>({
        type: 'SYNC_SESSION',
        requestSessionId: 'spectator-tab',
        session: {
          sessionId: 'spectator-tab',
          controller: 'human',
          side: 'right',
          ready: true,
        },
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'session-mutation-not-allowed',
      requestSessionId: 'spectator-tab',
      sessionId: 'spectator-tab',
      phase: 'running',
    });
    await expect(
      matchCoordinator.ask<PongMatchCommandResult>({
        type: 'SYNC_SESSION',
        requestSessionId: 'spectator-tab',
        session: {
          sessionId: 'tab-b',
          controller: 'human',
          side: 'right',
          ready: true,
        },
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'not-session-owner',
      requestSessionId: 'spectator-tab',
      sessionId: 'tab-b',
    });
    await expect(
      matchCoordinator.ask<PongMatchCommandResult>({
        type: 'SYNC_SESSION',
        requestSessionId: 'tab-b',
        session: {
          sessionId: 'tab-b',
          controller: 'human',
          side: 'left',
          ready: true,
        },
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'session-mutation-not-allowed',
      requestSessionId: 'tab-b',
      sessionId: 'tab-b',
      phase: 'running',
    });
    await expect(
      matchCoordinator.ask<PongMatchCommandResult>({
        type: 'SYNC_SESSION',
        requestSessionId: 'spectator-tab',
        session: createInitialPlayerSession('spectator-tab'),
      })
    ).resolves.toMatchObject({
      ok: true,
      match: {
        sessions: expect.arrayContaining([
          expect.objectContaining({ sessionId: 'tab-b', side: 'right' }),
          expect.objectContaining({ sessionId: 'spectator-tab', side: null }),
        ]),
      },
    });
    await expect(
      matchCoordinator.ask<PongMatchCommandResult>({
        type: 'SYNC_SESSION',
        requestSessionId: 'tab-b',
        session: {
          sessionId: 'tab-b',
          controller: 'human',
          side: 'right',
          ready: true,
        },
      })
    ).resolves.toMatchObject({
      ok: true,
      match: {
        phase: 'running',
        authoritySessionId: 'tab-a',
        sessions: expect.arrayContaining([
          expect.objectContaining({ sessionId: 'tab-b', side: 'right' }),
        ]),
      },
    });
  });

  it('keeps authorized self-sync and self-removal deterministic in the core', () => {
    const session = {
      sessionId: 'tab-a',
      controller: 'human',
      side: 'left',
      ready: true,
    } as const;
    const synced = syncMatchSession(createInitialMatchState(), 'tab-a', session);
    expect(synced).toMatchObject({ ok: true, match: { sessions: [session] } });
    if (!synced.ok) {
      throw new Error(`Expected authorized sync, received ${synced.reason}.`);
    }

    const removed = removeMatchSession(synced.match, 'tab-a', 'tab-a');
    expect(removed).toMatchObject({ ok: true, match: { sessions: [], controllers: [] } });
    if (!removed.ok) {
      throw new Error(`Expected authorized removal, received ${removed.reason}.`);
    }

    expect(removeMatchSession(removed.match, 'tab-a', 'tab-a')).toEqual(removed);
  });

  it('restores a player-session actor only from the same session identity', async () => {
    const runtime = await startMeshPongLocal();
    startedRuntimes.push(runtime);
    const session = await createPlayerSession(runtime, { sessionId: 'tab-a' });

    await expect(
      session.ask({
        type: 'RESTORE_SESSION',
        session: {
          sessionId: 'tab-b',
          controller: 'human',
          side: 'right',
          ready: true,
        },
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'session-id-mismatch',
      localSessionId: 'tab-a',
      restoreSessionId: 'tab-b',
    });
    await expect(session.ask({ type: 'GET_SESSION' })).resolves.toEqual(
      createInitialPlayerSession('tab-a')
    );

    const restored = {
      sessionId: 'tab-a',
      controller: 'human',
      side: 'right',
      ready: true,
    } as const;
    await expect(
      session.ask({
        type: 'RESTORE_SESSION',
        session: restored,
      })
    ).resolves.toEqual({ ok: true, session: restored });
    await expect(session.ask({ type: 'GET_SESSION' })).resolves.toEqual(restored);
  });

  it('allows only the authority session to advance coordinator ticks', async () => {
    const runtime = await startMeshPongLocal();
    startedRuntimes.push(runtime);
    const { matchCoordinator, sessionA, sessionB } = await resolveSessionRefs(runtime);

    await sessionA.send({ type: 'CLAIM_SIDE', side: 'left' });
    await sessionA.send({ type: 'SET_READY', ready: true });
    await sessionB.send({ type: 'CLAIM_SIDE', side: 'right' });
    await sessionB.send({ type: 'SET_READY', ready: true });
    await syncCoordinatorSession(matchCoordinator, sessionA);
    await syncCoordinatorSession(matchCoordinator, sessionB);
    await flush(runtime);

    await matchCoordinator.ask<PongMatchCommandResult>({
      type: 'START_MATCH',
      requestSessionId: 'tab-a',
      expectedGeneration: 0,
      mode: TWO_HUMAN_PONG_MATCH_MODE,
    });
    await flush(runtime);

    await expect(
      matchCoordinator.ask<PongMatchCommandResult>({
        type: 'TICK_MATCH',
        requestSessionId: 'tab-b',
        expectedGeneration: 1,
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'not-authority',
      authoritySessionId: 'tab-a',
      requestSessionId: 'tab-b',
    });
    await expect(currentMatchState(matchCoordinator)).resolves.toMatchObject({ tick: 0 });

    await expect(
      matchCoordinator.ask<PongMatchCommandResult>({
        type: 'TICK_MATCH',
        requestSessionId: 'tab-a',
        expectedGeneration: 1,
      })
    ).resolves.toMatchObject({
      ok: true,
      match: {
        tick: 1,
        authoritySessionId: 'tab-a',
      },
    });
  });

  it('allows either seated player to restart and take lifecycle authority', async () => {
    const runtime = await startMeshPongLocal();
    startedRuntimes.push(runtime);
    const { matchCoordinator, sessionA, sessionB } = await resolveSessionRefs(runtime);

    await sessionA.send({ type: 'CLAIM_SIDE', side: 'left' });
    await sessionA.send({ type: 'SET_READY', ready: true });
    await sessionB.send({ type: 'CLAIM_SIDE', side: 'right' });
    await sessionB.send({ type: 'SET_READY', ready: true });
    await syncCoordinatorSession(matchCoordinator, sessionA);
    await syncCoordinatorSession(matchCoordinator, sessionB);
    await flush(runtime);

    await matchCoordinator.ask<PongMatchCommandResult>({
      type: 'START_MATCH',
      requestSessionId: 'tab-a',
      expectedGeneration: 0,
      mode: TWO_HUMAN_PONG_MATCH_MODE,
    });
    await matchCoordinator.ask<PongMatchCommandResult>({
      type: 'RESTART_MATCH',
      requestSessionId: 'tab-b',
      expectedGeneration: 1,
    });
    await expect(currentMatchState(matchCoordinator)).resolves.toMatchObject({
      generation: 2,
      authoritySessionId: 'tab-b',
      phase: 'running',
      snapshot: {
        score: { left: 0, right: 0 },
      },
    });

    await matchCoordinator.ask<PongMatchCommandResult>({
      type: 'RESTART_MATCH',
      requestSessionId: 'tab-a',
      expectedGeneration: 2,
    });
    await expect(currentMatchState(matchCoordinator)).resolves.toMatchObject({
      generation: 3,
      authoritySessionId: 'tab-a',
      phase: 'running',
      snapshot: {
        score: { left: 0, right: 0 },
      },
    });
  });

  it('separates pre-match room and match aggregates and places controllers on nodes a and b', () => {
    expect(Object.keys(pong.actors).sort()).toEqual([
      'controllerLeft',
      'controllerRight',
      'matchCoordinator',
      'playerSession',
      'room',
    ]);
    expect('ball' in pong.actors).toBe(false);
    expect('lobby' in pong.actors).toBe(false);
    expect('paddleA' in pong.actors).toBe(false);
    expect('paddleB' in pong.actors).toBe(false);
    expect('score' in pong.actors).toBe(false);
    expect(pong.actors.controllerLeft.node).toBe('a');
    expect(pong.actors.controllerRight.node).toBe('b');
    expect(pong.subscriptions).toEqual([]);
  });

  it('runs room authorization and revision invariants through the topology-owned actor', async () => {
    const runtime = await startMeshPongLocal();
    startedRuntimes.push(runtime);
    const room = serverNode(runtime).requireActor('room') as ActorRef<
      PongRoomState,
      PongRoomCommand
    >;

    await expect(room.ask<PongRoomResult>({ type: 'GET_ROOM' })).resolves.toMatchObject({
      ok: true,
      room: { phase: 'empty', revision: 0 },
    });
    await expect(
      room.ask<PongRoomResult>({
        type: 'CREATE_ROOM',
        requestSessionId: 'tab-a',
        expectedRevision: 0,
        code: 'PONG42',
      })
    ).resolves.toMatchObject({ ok: true, room: { revision: 1, hostSessionId: 'tab-a' } });
    await expect(
      room.ask<PongRoomResult>({
        type: 'JOIN_ROOM',
        requestSessionId: 'tab-b',
        expectedRevision: 0,
      })
    ).resolves.toMatchObject({
      ok: false,
      reason: 'stale-revision',
      expectedRevision: 0,
      actualRevision: 1,
    });
  });

  it('pauses exactly once and preserves remaining human sessions when authority disappears', () => {
    const firstSync = syncMatchSession(createInitialMatchState(), 'tab-a', {
      sessionId: 'tab-a',
      controller: 'human',
      side: 'left',
      ready: true,
    });
    if (!firstSync.ok) {
      throw new Error(`Expected first sync, received ${firstSync.reason}.`);
    }
    const secondSync = syncMatchSession(firstSync.match, 'tab-b', {
      sessionId: 'tab-b',
      controller: 'human',
      side: 'right',
      ready: true,
    });
    if (!secondSync.ok) {
      throw new Error(`Expected second sync, received ${secondSync.reason}.`);
    }
    const running = startMatchLifecycle(secondSync.match, 'tab-a', 0, TWO_HUMAN_PONG_MATCH_MODE);
    expect(running.ok).toBe(true);
    const startedMatch = (running as Extract<PongMatchCommandResult, { ok: true }>).match;

    const paused = removeMatchSession(startedMatch, 'tab-a', 'tab-a');
    expect(paused).toMatchObject({
      ok: true,
      match: {
        phase: 'paused',
        authoritySessionId: null,
        generation: 2,
        sessions: [expect.objectContaining({ sessionId: 'tab-b', side: 'right', ready: true })],
      },
    });
    if (!paused.ok) {
      throw new Error(`Expected authority removal, received ${paused.reason}.`);
    }

    const repeated = removeMatchSession(paused.match, 'tab-a', 'tab-a');
    expect(repeated).toEqual(paused);
  });

  it('maps reset semantics to RESTART_MATCH while keeping RETURN_TO_ROOM distinct', async () => {
    const uiEntrypoint = await readFile(
      path.resolve(meshPongExamplesDir, 'mesh-pong/ui/main.ts'),
      'utf8'
    );

    expect(uiEntrypoint).toContain("type: 'RESTART_MATCH'");
    expect(uiEntrypoint).not.toContain("type: 'RESET_MATCH'");
    expect(uiEntrypoint).toContain("type: 'RETURN_TO_ROOM'");
  });

  it('asks remote controller actors instead of running a browser-local MLX shortcut', async () => {
    const uiEntrypoint = await readFile(
      path.resolve(meshPongExamplesDir, 'mesh-pong/ui/main.ts'),
      'utf8'
    );

    expect(uiEntrypoint).toContain('refs.controllerLeft.ask');
    expect(uiEntrypoint).toContain('refs.controllerRight.ask');
    expect(uiEntrypoint).not.toContain('createBrowserMlxLlmProvider');
    expect(uiEntrypoint).not.toContain('runPongControllerWithLlmProvider');
  });

  it('keeps projections alive in lobby paused and running while only the authority ticks', async () => {
    const uiEntrypoint = await readFile(
      path.resolve(meshPongExamplesDir, 'mesh-pong/ui/main.ts'),
      'utf8'
    );

    expect(uiEntrypoint).toContain("case 'paused'");
    expect(uiEntrypoint).toContain("case 'running'");
    expect(uiEntrypoint).toContain("case 'lobby'");
    expect(uiEntrypoint).toContain("type: 'TICK_MATCH'");
    expect(uiEntrypoint).toContain('matchOwnerSessionId === browserSessionId');
  });

  it('starts projection from runtime startup and keeps reset on the active loop', async () => {
    const uiEntrypoint = await readFile(
      path.resolve(meshPongExamplesDir, 'mesh-pong/ui/main.ts'),
      'utf8'
    );
    const resetSection = uiEntrypoint.slice(
      uiEntrypoint.indexOf('async function resetGame(): Promise<void> {'),
      uiEntrypoint.indexOf('async function returnToRoom(): Promise<void> {')
    );

    expect(uiEntrypoint).toContain('function ensureProjectionLoop(): void');
    expect(uiEntrypoint).toContain(
      'applyProjectedMatch(refreshedMatch, { renderSnapshot: false, renderStatus: false });'
    );
    expect(uiEntrypoint).toContain('ensureProjectionLoop();');
    expect(resetSection).not.toContain('window.clearTimeout(loopHandle);');
  });

  it('adds an explicit PAUSE_MATCH command that returns data for non-authority callers', async () => {
    const runtime = await startMeshPongLocal();
    startedRuntimes.push(runtime);
    const { matchCoordinator, sessionA, sessionB } = await resolveSessionRefs(runtime);

    await sessionA.send({ type: 'CLAIM_SIDE', side: 'left' });
    await sessionA.send({ type: 'SET_READY', ready: true });
    await sessionB.send({ type: 'CLAIM_SIDE', side: 'right' });
    await sessionB.send({ type: 'SET_READY', ready: true });
    await syncCoordinatorSession(matchCoordinator, sessionA);
    await syncCoordinatorSession(matchCoordinator, sessionB);
    await flush(runtime);

    await matchCoordinator.ask<PongMatchCommandResult>({
      type: 'START_MATCH',
      requestSessionId: 'tab-a',
      expectedGeneration: 0,
      mode: TWO_HUMAN_PONG_MATCH_MODE,
    });

    await expect(
      matchCoordinator.ask<PongMatchCommandResult>({
        type: 'PAUSE_MATCH',
        requestSessionId: 'tab-b',
        expectedGeneration: 1,
      } as PongMatchCommand)
    ).resolves.toEqual({
      ok: false,
      reason: 'not-authority',
      authoritySessionId: 'tab-a',
      requestSessionId: 'tab-b',
    });
  });

  it('preserves active lobby state when a later match-start request is rejected', async () => {
    const startedLobby = startLobbyMatch(
      syncLobbySession(
        syncLobbySession(createInitialLobby(), {
          sessionId: 'tab-a',
          controller: 'human',
          side: 'left',
          ready: true,
        }),
        {
          sessionId: 'tab-b',
          controller: 'human',
          side: 'right',
          ready: true,
        }
      ),
      {
        playerCount: 2,
        controllers: { left: 'human', right: 'human' },
      }
    ).lobby;

    const rejected = startLobbyMatch(startedLobby, {
      playerCount: 2,
      controllers: { left: 'human', right: 'mlx' },
    });
    expect(rejected.result).toEqual({
      ok: false,
      reason: 'missing-controller',
      missing: ['right'],
    });
    expect(rejected.lobby).toBe(startedLobby);

    const runtime = await startMeshPongLocal();
    startedRuntimes.push(runtime);
    const { lobby, sessionA, sessionB } = await resolveSessionRefs(runtime);
    await sessionA.send({ type: 'CLAIM_SIDE', side: 'left' });
    await sessionA.send({ type: 'SET_READY', ready: true });
    await sessionB.send({ type: 'CLAIM_SIDE', side: 'right' });
    await sessionB.send({ type: 'SET_READY', ready: true });
    await syncSessionToLobby(lobby, sessionA);
    await syncSessionToLobby(lobby, sessionB);
    await flush(runtime);
    await lobby.ask<PongMatchStartResult>({
      type: 'START_MATCH',
      mode: {
        playerCount: 2,
        controllers: { left: 'human', right: 'human' },
      },
    });
    const lobbyBeforeReject = await lobby.ask<PongLobbyState>({ type: 'GET_LOBBY' });

    await expect(
      lobby.ask<PongMatchStartResult>({
        type: 'START_MATCH',
        mode: 'bad-mode',
      } as unknown as PongLobbyCommand)
    ).resolves.toEqual({
      ok: false,
      reason: 'invalid-command',
      missing: [],
    });
    await expect(lobby.ask<PongLobbyState>({ type: 'GET_LOBBY' })).resolves.toEqual(
      lobbyBeforeReject
    );
  });

  it('starts a reflex controller side from a clean lobby without launching planner work', () => {
    const mode = {
      playerCount: 1,
      controllers: { left: 'human', right: 'reflex' },
    } as const;
    const legacyMode = {
      playerCount: mode.playerCount,
      controllers: {
        left: toLegacyPongControllerType(mode.controllers.left),
        right: toLegacyPongControllerType(mode.controllers.right),
      },
    };
    const lobby = syncLobbySession(
      syncLobbySession(createInitialLobby(), {
        sessionId: 'tab-a',
        controller: 'human',
        side: 'left',
        ready: true,
      }),
      createSyntheticControllerSession('right')
    );

    expect(toLegacyPongControllerType('reflex')).toBe('mlx');
    expect(usesSyntheticControllerSlot('reflex')).toBe(true);
    expect(
      shouldLaunchPlannerControllerForSide({
        browserSessionId: 'tab-a',
        matchOwnerSessionId: 'tab-a',
        mode,
        side: 'right',
      })
    ).toBe(false);
    expect(startLobbyMatch(lobby, legacyMode).result).toEqual({
      ok: true,
      mode: legacyMode,
      controllers: [
        { sessionId: 'tab-a', controller: 'human', side: 'left', ready: true },
        { sessionId: 'planner-right', controller: 'mlx', side: 'right', ready: true },
      ],
    });
  });

  it('returns data failures for malformed player-session and lobby commands', async () => {
    const runtime = await startMeshPongLocal();
    startedRuntimes.push(runtime);
    const { lobby, sessionA } = await resolveSessionRefs(runtime);

    await expect(
      sessionA.ask<PongControllerInputResult>({
        type: 'MOVE_CONTROLLER',
        direction: 'sideways',
      } as unknown as PlayerSessionCommand)
    ).resolves.toEqual({
      ok: false,
      sessionId: 'tab-a',
      reason: 'invalid-command',
    });

    const initialSession = await sessionA.ask<PongPlayerSessionState>({ type: 'GET_SESSION' });
    await expect(
      sessionA.ask<PongControllerInputResult>({
        type: 'CLAIM_SIDE',
        side: 'middle',
        controller: 'bot',
      } as unknown as PlayerSessionCommand)
    ).resolves.toEqual({
      ok: false,
      sessionId: 'tab-a',
      reason: 'invalid-command',
    });
    await expect(sessionA.ask<PongPlayerSessionState>({ type: 'GET_SESSION' })).resolves.toEqual(
      initialSession
    );

    await sessionA.send({ type: 'CLAIM_SIDE', side: 'left' });
    await flush(runtime);

    await expect(
      sessionA.ask<PongControllerInputResult>({
        type: 'UNKNOWN_COMMAND',
      } as unknown as PlayerSessionCommand)
    ).resolves.toEqual({
      ok: false,
      sessionId: 'tab-a',
      reason: 'invalid-command',
    });

    await expect(
      lobby.ask<PongMatchStartResult>({
        type: 'START_MATCH',
      } as unknown as PongLobbyCommand)
    ).resolves.toEqual({
      ok: false,
      reason: 'invalid-command',
      missing: [],
    });

    const lobbyBeforeUnknown = await lobby.ask<PongLobbyState>({ type: 'GET_LOBBY' });
    await expect(
      lobby.ask<PongMatchStartResult>({
        type: 'UNKNOWN_COMMAND',
      } as unknown as PongLobbyCommand)
    ).resolves.toEqual({
      ok: false,
      reason: 'invalid-command',
      missing: [],
    });
    await expect(lobby.ask<PongLobbyState>({ type: 'GET_LOBBY' })).resolves.toEqual(
      lobbyBeforeUnknown
    );
  });

  it('rejects malformed match-coordinator commands without ticking or mutating state', async () => {
    const runtime = await startMeshPongLocal();
    startedRuntimes.push(runtime);
    const { matchCoordinator } = await resolveSessionRefs(runtime);
    const initialMatch = await currentMatchState(matchCoordinator);

    await expect(
      matchCoordinator.ask<PongMatchCommandResult>({
        type: 'UNKNOWN_COMMAND',
        requestSessionId: 'tab-a',
        expectedGeneration: initialMatch.generation,
      } as unknown as PongMatchCommand)
    ).resolves.toEqual({
      ok: false,
      reason: 'invalid-command',
      missing: [],
    });
    await expect(currentMatchState(matchCoordinator)).resolves.toEqual(initialMatch);
  });

  it('preserves the first owner when another session claims the same match side', () => {
    const first = syncMatchSession(createInitialMatchState(), 'tab-a', {
      sessionId: 'tab-a',
      controller: 'human',
      side: 'left',
      ready: true,
    });
    if (!first.ok) {
      throw new Error(`Expected first sync, received ${first.reason}.`);
    }

    const conflict = syncMatchSession(first.match, 'tab-b', {
      sessionId: 'tab-b',
      controller: 'human',
      side: 'left',
      ready: true,
    });

    expect(conflict).toEqual({
      ok: false,
      reason: 'side-already-claimed',
      requestSessionId: 'tab-b',
      ownerSessionId: 'tab-a',
      side: 'left',
    });
    expect(first.match.controllers).toEqual([
      { sessionId: 'tab-a', controller: 'human', side: 'left', ready: true },
    ]);
  });

  it('rejects START_MATCH once the authoritative match is already running', () => {
    const first = syncMatchSession(createInitialMatchState(), 'tab-a', {
      sessionId: 'tab-a',
      controller: 'human',
      side: 'left',
      ready: true,
    });
    if (!first.ok) {
      throw new Error(`Expected first sync, received ${first.reason}.`);
    }
    const second = syncMatchSession(first.match, 'tab-b', {
      sessionId: 'tab-b',
      controller: 'human',
      side: 'right',
      ready: true,
    });
    if (!second.ok) {
      throw new Error(`Expected second sync, received ${second.reason}.`);
    }
    const started = startMatchLifecycle(
      second.match,
      'tab-a',
      second.match.generation,
      TWO_HUMAN_PONG_MATCH_MODE
    );
    if (!started.ok) {
      throw new Error(`Expected match start, received ${started.reason}.`);
    }

    expect(
      startMatchLifecycle(
        started.match,
        'tab-a',
        started.match.generation,
        TWO_HUMAN_PONG_MATCH_MODE
      )
    ).toEqual({
      ok: false,
      reason: 'match-not-in-lobby',
      phase: 'running',
    });
  });

  it('starts one-player human plus MLX controller mode and emits bounded controller intents', async () => {
    const runtime = await startMeshPongLocal({
      tools: createActorAgentTools({
        llm: createFakeMlxProvider(
          () =>
            `{"targetY":${PONG_FIELD.height - PONG_FIELD.paddleHeight},"biasY":0,"maxStep":999,"label":"planner-target"}`
        ),
      }),
    });
    startedRuntimes.push(runtime);
    const { lobby, sessionA } = await resolveSessionRefs(runtime);
    const controllers = await resolveControllerRefs(runtime);

    await sessionA.send({ type: 'CLAIM_SIDE', side: 'left' });
    await sessionA.send({ type: 'SET_READY', ready: true });
    await syncSessionToLobby(lobby, sessionA);
    await syncSyntheticMlxSession(lobby, 'right');
    await flush(runtime);

    await expect(
      lobby.ask<PongMatchStartResult>({
        type: 'START_MATCH',
        mode: {
          playerCount: 1,
          controllers: { left: 'human', right: 'mlx' },
        },
      })
    ).resolves.toEqual({
      ok: true,
      mode: {
        playerCount: 1,
        controllers: { left: 'human', right: 'mlx' },
      },
      controllers: [
        { sessionId: 'tab-a', controller: 'human', side: 'left', ready: true },
        { sessionId: 'planner-right', controller: 'mlx', side: 'right', ready: true },
      ],
    });

    const result = await controllers.right.ask<PongControllerResult>({
      type: 'RUN_CONTROLLER',
      snapshot: await currentSnapshot(runtime),
    });

    expect(result).toEqual({
      ok: true,
      side: 'right',
      provider: 'llm',
      strategy: createPlannerStrategy('right', {
        targetY: PONG_FIELD.height - PONG_FIELD.paddleHeight,
        biasY: 0,
        maxStep: PONG_FIELD.paddleStep,
        label: 'planner-target',
      }),
    });
  });

  it('returns invalid-response when the LLM amount is malformed', async () => {
    for (const content of [
      '{"targetY":null,"biasY":0,"maxStep":10}',
      '{"targetY":false,"biasY":0,"maxStep":10}',
      '{"targetY":"","biasY":0,"maxStep":10}',
      '{"targetY":"   ","biasY":0,"maxStep":10}',
      '{"targetY":{},"biasY":0,"maxStep":10}',
      '{"targetY":"Infinity","biasY":0,"maxStep":10}',
      '{"targetY":"NaN","biasY":0,"maxStep":10}',
    ]) {
      const runtime = await startMeshPongLocal({
        tools: createActorAgentTools({
          llm: createFakeMlxProvider(() => content),
        }),
      });
      startedRuntimes.push(runtime);
      const controllers = await resolveControllerRefs(runtime);

      await expect(
        controllers.right.ask<PongControllerResult>({
          type: 'RUN_CONTROLLER',
          snapshot: await currentSnapshot(runtime),
        })
      ).resolves.toEqual({
        ok: false,
        side: 'right',
        reason: 'invalid-response',
        error: {
          code: 'LLM_INVALID_RESPONSE',
          message: 'LLM controller must return JSON with targetY, biasY, and maxStep.',
        },
      });
    }
  });

  it('reads browser MLX config from non-secret local storage overrides', () => {
    const config = resolveBrowserMlxProviderConfig(
      createStorage({
        'actor-web.mesh-pong.mlx.enabled': 'true',
        'actor-web.mesh-pong.mlx.endpoint': 'http://127.0.0.1:1234/v1/',
        'actor-web.mesh-pong.mlx.model': 'mlx-test-model',
      })
    );

    expect(config).toEqual({
      enabled: true,
      endpoint: 'http://127.0.0.1:1234/v1',
      model: 'mlx-test-model',
    });
    expect(config).not.toHaveProperty('apiKey');
  });

  it('calls an openai-compatible local MLX endpoint when browser MLX is enabled', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const provider = createBrowserMlxLlmProvider({
      config: {
        enabled: true,
        endpoint: 'http://127.0.0.1:8080/v1',
        model: 'mlx-local',
      },
      fetchImpl: (async (url, init) => {
        fetchCalls.push({ url: String(url), init });
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '{"direction":"up","amount":7}' } }],
            usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
          }),
        } as Response;
      }) as typeof fetch,
    });

    await expect(
      provider(
        {
          system: 'Play Pong.',
          messages: [{ role: 'user', content: '{"side":"left"}' }],
          tools: [],
        } as ActorAgentLlmRequest,
        createToolExecutionContext()
      )
    ).resolves.toEqual({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: '{"direction":"up","amount":7}',
        },
        usage: {
          inputTokens: 4,
          outputTokens: 2,
          totalTokens: 6,
        },
      },
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toMatchObject({
      url: 'http://127.0.0.1:8080/v1/chat/completions',
      init: {
        method: 'POST',
        signal: expect.any(AbortSignal),
        headers: {
          'content-type': 'application/json',
        },
      },
    });
    expect(JSON.stringify(fetchCalls[0]?.init?.headers)).not.toContain('authorization');
    expect(JSON.stringify(fetchCalls[0]?.init?.headers)).not.toContain('Bearer');
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toMatchObject({
      model: 'mlx-local',
      temperature: 0,
      max_tokens: 24,
      chat_template_kwargs: { enable_thinking: false },
    });
  });

  it('times out browser MLX endpoint calls that do not settle', async () => {
    let observedSignal: AbortSignal | undefined;
    const provider = createBrowserMlxLlmProvider({
      config: {
        enabled: true,
        endpoint: 'http://127.0.0.1:8080/v1',
        model: 'mlx-local',
      },
      timeoutMs: 1,
      fetchImpl: (async (_url, init) => {
        observedSignal = init?.signal as AbortSignal | undefined;
        return new Promise<Response>((_resolve, reject) => {
          observedSignal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      }) as typeof fetch,
    });

    await expect(
      provider(
        {
          messages: [{ role: 'user', content: '{"side":"right"}' }],
          tools: [],
        } as ActorAgentLlmRequest,
        createToolExecutionContext()
      )
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'LLM_PROVIDER_FAILED',
        message:
          'Local MLX request timed out after 1ms for http://127.0.0.1:8080/v1/chat/completions.',
      },
    });
    expect(observedSignal?.aborted).toBe(true);
  });

  it('honors actor-tool abort signals during browser MLX endpoint calls', async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const provider = createBrowserMlxLlmProvider({
      config: {
        enabled: true,
        endpoint: 'http://127.0.0.1:8080/v1',
        model: 'mlx-local',
      },
      timeoutMs: 20_000,
      fetchImpl: (async (_url, init) => {
        observedSignal = init?.signal as AbortSignal | undefined;
        return new Promise<Response>((_resolve, reject) => {
          observedSignal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      }) as typeof fetch,
    });

    const result = provider(
      {
        messages: [{ role: 'user', content: '{"side":"left"}' }],
        tools: [],
      } as ActorAgentLlmRequest,
      createToolExecutionContext(controller.signal)
    );
    controller.abort(new Error('controller deadline'));

    await expect(result).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'LLM_PROVIDER_FAILED',
        message: 'Local MLX request was aborted for http://127.0.0.1:8080/v1/chat/completions.',
      },
    });
    expect(observedSignal?.aborted).toBe(true);
  });

  it('maps thrown controller provider errors to data failures', async () => {
    const snapshot = createStepperSnapshot(
      { left: createInitialPaddle('left'), right: createInitialPaddle('right') },
      0
    );

    await expect(
      runPongControllerWithLlmProvider('left', snapshot, async () => {
        throw new Error('provider exploded');
      })
    ).resolves.toEqual({
      ok: false,
      side: 'left',
      reason: 'provider-failed',
      error: {
        code: 'LLM_PROVIDER_ERROR',
        message: 'provider exploded',
      },
    });
  });

  it('aborts controller provider calls after the controller timeout', async () => {
    vi.useFakeTimers();
    try {
      const snapshot = createStepperSnapshot(
        { left: createInitialPaddle('left'), right: createInitialPaddle('right') },
        0
      );
      let observedSignal: AbortSignal | undefined;
      const result = runPongControllerWithLlmProvider('right', snapshot, (_request, options) => {
        observedSignal = options.signal;
        return new Promise<ActorAgentLlmResult>((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('controller aborted')));
        });
      });

      await vi.advanceTimersByTimeAsync(CONTROLLER_LLM_TIMEOUT_MS);

      await expect(result).resolves.toEqual({
        ok: false,
        side: 'right',
        reason: 'provider-failed',
        error: {
          code: 'LLM_PROVIDER_ERROR',
          message: 'controller aborted',
        },
      });
      expect(observedSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('enforces controller timeout through actor tool execution', async () => {
    let observedSignal: AbortSignal | undefined;
    const runtime = await startMeshPongLocal({
      tools: createActorAgentTools({
        llm: (_request, context) => {
          observedSignal = context.signal;
          return new Promise<ActorAgentLlmResult>((_resolve, reject) => {
            context.signal.addEventListener('abort', () => reject(new Error('tool aborted')));
          });
        },
      }),
    });
    startedRuntimes.push(runtime);
    const controllers = await resolveControllerRefs(runtime);
    const result = controllers.right.ask<PongControllerResult>({
      type: 'RUN_CONTROLLER',
      snapshot: await currentSnapshot(runtime),
    });

    await expect(result).resolves.toEqual({
      ok: false,
      side: 'right',
      reason: 'provider-failed',
      error: {
        code: 'LLM_PROVIDER_ERROR',
        message: `Actor tool "llm" timed out after ${CONTROLLER_LLM_TIMEOUT_MS}ms.`,
      },
    });
    expect(observedSignal?.aborted).toBe(true);
  });

  it('starts LLM-vs-LLM mode through controller actors with a deterministic fake provider', async () => {
    const runtime = await startMeshPongLocal({
      tools: createActorAgentTools({
        llm: createFakeMlxProvider((request) =>
          JSON.parse(request.messages.at(-1)?.content ?? '{}').side === 'left'
            ? '{"targetY":0,"biasY":0,"maxStep":12,"label":"planner-target"}'
            : `{"targetY":${PONG_FIELD.height - PONG_FIELD.paddleHeight},"biasY":0,"maxStep":9,"label":"planner-target"}`
        ),
      }),
    });
    startedRuntimes.push(runtime);
    const { lobby } = await resolveSessionRefs(runtime);
    const controllers = await resolveControllerRefs(runtime);

    await syncSyntheticMlxSession(lobby, 'left');
    await syncSyntheticMlxSession(lobby, 'right');
    await flush(runtime);

    await expect(
      lobby.ask<PongMatchStartResult>({
        type: 'START_MATCH',
        mode: {
          playerCount: 2,
          controllers: { left: 'mlx', right: 'mlx' },
        },
      })
    ).resolves.toEqual({
      ok: true,
      mode: {
        playerCount: 2,
        controllers: { left: 'mlx', right: 'mlx' },
      },
      controllers: [
        { sessionId: 'planner-left', controller: 'mlx', side: 'left', ready: true },
        { sessionId: 'planner-right', controller: 'mlx', side: 'right', ready: true },
      ],
    });

    const snapshot = await currentSnapshot(runtime);
    await expect(
      controllers.left.ask<PongControllerResult>({ type: 'RUN_CONTROLLER', snapshot })
    ).resolves.toEqual({
      ok: true,
      side: 'left',
      provider: 'llm',
      strategy: createPlannerStrategy('left', {
        targetY: 0,
        biasY: 0,
        maxStep: 12,
        label: 'planner-target',
      }),
    });
    await expect(
      controllers.right.ask<PongControllerResult>({ type: 'RUN_CONTROLLER', snapshot })
    ).resolves.toEqual({
      ok: true,
      side: 'right',
      provider: 'llm',
      strategy: createPlannerStrategy('right', {
        targetY: PONG_FIELD.height - PONG_FIELD.paddleHeight,
        biasY: 0,
        maxStep: 9,
        label: 'planner-target',
      }),
    });
  });

  it('preserves active MLX match mode and synthetic controller slots during storage sync', () => {
    const humanSession: PongPlayerSessionState = {
      sessionId: 'tab-a',
      controller: 'human',
      side: 'left',
      ready: true,
    };
    const startedLobby = startLobbyMatch(
      syncLobbySession(syncLobbySession(createInitialLobby(), humanSession), {
        sessionId: 'planner-right',
        controller: 'mlx',
        side: 'right',
        ready: true,
      }),
      {
        playerCount: 1,
        controllers: { left: 'human', right: 'mlx' },
      }
    ).lobby;

    expect(syncLobbySessionsFromStorage(startedLobby, [humanSession])).toEqual({
      ...startedLobby,
      sessions: [
        humanSession,
        {
          sessionId: 'planner-right',
          controller: 'mlx',
          side: 'right',
          ready: true,
        },
      ],
      controllers: [
        { sessionId: 'tab-a', controller: 'human', side: 'left', ready: true },
        { sessionId: 'planner-right', controller: 'mlx', side: 'right', ready: true },
      ],
    });
  });

  it('elects only the match owner tab to launch planner controller turns', () => {
    const mode = {
      playerCount: 2,
      controllers: { left: 'planner', right: 'human' },
    } as const;

    expect(
      shouldLaunchPlannerControllerForSide({
        browserSessionId: 'tab-a',
        matchOwnerSessionId: 'tab-a',
        mode,
        side: 'left',
      })
    ).toBe(true);
    expect(
      shouldLaunchPlannerControllerForSide({
        browserSessionId: 'tab-b',
        matchOwnerSessionId: 'tab-a',
        mode,
        side: 'left',
      })
    ).toBe(false);
    expect(
      shouldLaunchPlannerControllerForSide({
        browserSessionId: 'tab-a',
        matchOwnerSessionId: 'tab-a',
        mode,
        side: 'right',
      })
    ).toBe(false);
    expect(
      shouldLaunchPlannerControllerForSide({
        browserSessionId: 'tab-a',
        matchOwnerSessionId: null,
        mode,
        side: 'left',
      })
    ).toBe(false);
  });

  it('applies seated human input from a non-authority tab without advancing simulation', async () => {
    const mode = {
      playerCount: 2,
      controllers: { left: 'human', right: 'human' },
    } as const;
    const applyHumanInput = vi.fn(async () => true);
    const harness = createTurnStepperHarness(mode, {
      applyHumanInput,
    });
    harness.matchState.ownerSessionId = 'authority-tab';

    await harness.stepper.tick();

    expect(applyHumanInput).toHaveBeenCalledOnce();
    expect(applyHumanInput).toHaveBeenCalledWith(mode);
    expect(harness.renderedSnapshots).toHaveLength(1);
    expect(harness.statuses.at(-1)).toBe('projecting');
    expect(harness.commands).not.toContain('ball:TICK');
    expect(harness.tickCount()).toBe(0);
    expect(harness.leftAskCount()).toBe(0);
    expect(harness.rightAskCount()).toBe(0);
  });

  it('creates the synthetic controller-input payload that observer tabs replay for MLX turns', () => {
    expect(createPlannerSessionId('right')).toBe('planner-right');
    expect(normalizePongControllerType('mlx')).toBe('planner');
    expect(normalizePongControllerType('planner')).toBe('planner');
    expect(normalizePongControllerType('hybrid')).toBe('hybrid');
    expect(
      createSyntheticPlannerControllerInput('right', {
        side: 'right',
        direction: 'down',
        amount: 9,
      })
    ).toEqual({
      ok: true,
      sessionId: 'planner-right',
      side: 'right',
      direction: 'down',
      amount: 9,
    });
  });

  it('creates deterministic reflex targets and planner overlays in the pure contract core', () => {
    const snapshot = createStepperSnapshot(
      {
        left: createInitialPaddle('left'),
        right: createInitialPaddle('right'),
      },
      0
    );
    const reflexAim = createReflexControllerAim(snapshot, 'left');
    expect(reflexAim.reason).toBe('intercept');
    expect(reflexAim.interceptY).not.toBeNull();

    const mergedAim = createMergedControllerAim(
      snapshot,
      'left',
      createPlannerStrategy('left', {
        targetY: 42,
        biasY: -12,
        label: 'bait-high',
      })
    );
    expect(mergedAim.reason).toBe('planner-target');
    expect(mergedAim.targetY).toBe(30);
  });

  it('keeps planner-only turns nonblocking and unresolved without secretly running reflex', async () => {
    const harness = createTurnStepperHarness({
      playerCount: 1,
      controllers: { left: 'planner', right: 'human' },
    });

    await harness.stepper.tick();
    await harness.stepper.tick();

    expect(harness.tickCount()).toBe(2);
    expect(harness.leftAskCount()).toBe(1);
    expect(harness.commands.filter((command) => command === 'left:MOVE_PADDLE')).toHaveLength(0);
    expect(harness.commands.filter((command) => command === 'ball:TICK')).toHaveLength(2);
  });

  it('shows planner-only no-op turns as neutral after the fresh strategy window expires', async () => {
    const harness = createTurnStepperHarness(
      {
        playerCount: 1,
        controllers: { left: 'planner', right: 'human' },
      },
      {
        schedulePolicy: {
          ...DEFAULT_MESH_PONG_CONTROLLER_SCHEDULE_POLICY,
          plannerStrategyFreshTurnLimit: 1,
          plannerStrategyStaleTurnLimit: 0,
        },
      }
    );

    await harness.stepper.tick();
    harness.leftDeferreds[0]?.resolve({
      ok: true,
      provider: 'llm',
      side: 'left',
      strategy: createPlannerStrategy('left', {
        targetY: PONG_FIELD.height - PONG_FIELD.paddleHeight,
        biasY: 0,
        label: 'hug-bottom',
      }),
    });
    await flushMicrotasks();

    await harness.stepper.tick();
    const freshAppliedEvents = harness.telemetryEvents.filter(
      (
        event
      ): event is Extract<MeshPongTelemetryEvent, { readonly type: 'controller-intent-applied' }> =>
        event.type === 'controller-intent-applied' &&
        event.side === 'left' &&
        event.strategyStatus === 'fresh'
    );
    expect(freshAppliedEvents).toHaveLength(1);
    expect(harness.commands.filter((command) => command === 'left:MOVE_PADDLE')).toHaveLength(1);

    const beforeNeutralTick = harness.telemetryEvents.length;
    await harness.stepper.tick();
    const neutralTurnEvents = harness.telemetryEvents.slice(beforeNeutralTick);

    expect(
      neutralTurnEvents.some(
        (event) =>
          event.type === 'controller-state-observed' &&
          event.side === 'left' &&
          event.mode === 'planner' &&
          event.source === 'planner' &&
          event.strategyStatus === 'neutral' &&
          event.detail === 'neutral hug-bottom'
      )
    ).toBe(true);
    expect(
      neutralTurnEvents.some(
        (event) => event.type === 'controller-intent-applied' && event.side === 'left'
      )
    ).toBe(false);
    expect(harness.commands.filter((command) => command === 'left:MOVE_PADDLE')).toHaveLength(1);

    const telemetry = harness.telemetryEvents.reduce(
      reduceMeshPongTelemetry,
      createMeshPongTelemetryState(0)
    );
    expect(telemetry.controllers.left.mode).toBe('planner');
    expect(telemetry.controllers.left.appliedSource).toBe('planner');
    expect(telemetry.controllers.left.strategyStatus).toBe('neutral');
    expect(telemetry.controllers.left.detail).toBe('neutral hug-bottom');
    expect(telemetry.controllers.left.lastAppliedIntentAtMs).not.toBe(
      neutralTurnEvents.find((event) => event.type === 'controller-state-observed')?.nowMs
    );
    expect(telemetry.controllers.left.lastAppliedIntentAgeMs).toBeGreaterThan(0);
    expect(formatMeshPongTelemetry(telemetry).leftController).toContain('st neutral');
    expect(formatMeshPongTelemetry(telemetry).leftController).toContain('aim neutral hug-bottom');
  });

  it('runs reflex mode without any planner requests and targets the intercept lane', async () => {
    const harness = createTurnStepperHarness({
      playerCount: 1,
      controllers: { left: 'reflex', right: 'human' },
    });

    await harness.stepper.tick();

    expect(harness.leftAskCount()).toBe(0);
    expect(harness.commands).toContain('left:MOVE_PADDLE');
    expect(harness.commands).toContain('ball:TICK');
  });

  it('keeps hybrid mode on reflex while a slow planner stays pending, then reuses stale planner overlay only within budget', async () => {
    const harness = createTurnStepperHarness(
      {
        playerCount: 1,
        controllers: { left: 'hybrid', right: 'human' },
      },
      {
        schedulePolicy: {
          ...DEFAULT_MESH_PONG_CONTROLLER_SCHEDULE_POLICY,
          plannerStrategyFreshTurnLimit: 1,
          plannerStrategyStaleTurnLimit: 1,
        },
      }
    );

    await harness.stepper.tick();
    await harness.stepper.tick();

    expect(harness.leftAskCount()).toBe(1);
    expect(harness.commands.filter((command) => command === 'left:MOVE_PADDLE').length).toBe(2);

    harness.leftDeferreds[0]?.resolve({
      ok: true,
      provider: 'llm',
      side: 'left',
      strategy: createPlannerStrategy('left', {
        targetY: PONG_FIELD.height - PONG_FIELD.paddleHeight,
        biasY: 0,
        label: 'hug-bottom-wall',
      }),
    });
    await flushMicrotasks();

    await harness.stepper.tick();
    await harness.stepper.tick();
    await harness.stepper.tick();

    expect(harness.leftAskCount()).toBeGreaterThanOrEqual(2);
    expect(harness.commands.filter((command) => command === 'left:MOVE_PADDLE').length).toBe(5);
  });

  it('keeps owner ticks advancing while both MLX lanes are unresolved and stale intent stays bounded', async () => {
    const harness = createTurnStepperHarness({
      playerCount: 2,
      controllers: { left: 'planner', right: 'planner' },
    });

    await harness.stepper.tick();
    await harness.stepper.tick();

    expect(harness.tickCount()).toBe(2);
    expect(harness.leftAskCount()).toBe(1);
    expect(harness.rightAskCount()).toBe(1);
    expect(harness.commands.filter((command) => command === 'ball:TICK')).toHaveLength(2);
    expect(harness.telemetryEvents.some((event) => event.type === 'simulation-applied')).toBe(true);

    harness.rightDeferreds[0]?.resolve({
      ok: true,
      provider: 'llm',
      side: 'right',
      strategy: createPlannerStrategy('right', {
        targetY: PONG_FIELD.height - PONG_FIELD.paddleHeight,
        biasY: 0,
        label: 'shadow-bottom',
      }),
    });
    await flushMicrotasks();

    expect(harness.commands.filter((command) => command === 'right:MOVE_PADDLE')).toHaveLength(0);
    expect(harness.replayedInputs).toHaveLength(0);
    const rightFinishedEvent = [...harness.telemetryEvents]
      .reverse()
      .find(
        (
          event
        ): event is Extract<
          MeshPongTelemetryEvent,
          { readonly type: 'controller-request-finished' }
        > => event.type === 'controller-request-finished' && event.side === 'right'
      );
    expect(rightFinishedEvent?.outcome).toBe('ready');
    expect(
      harness.telemetryEvents.some(
        (event) => event.type === 'controller-intent-applied' && event.side === 'right'
      )
    ).toBe(false);

    await harness.stepper.tick();
    expect(
      harness.telemetryEvents.some(
        (event) => event.type === 'controller-intent-applied' && event.side === 'right'
      )
    ).toBe(true);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await harness.stepper.tick();
    }

    const rightMoves = harness.commands.filter((command) => command === 'right:MOVE_PADDLE');
    expect(rightMoves.length).toBeGreaterThanOrEqual(2);
    expect(rightMoves.length).toBeLessThan(6);
    expect(harness.rightAskCount()).toBe(2);
    expect(harness.renderedSnapshots.length).toBeGreaterThanOrEqual(3);
    expect(harness.statuses.at(-1)).toBe('running');
  });

  it('flushes each simulation tick before snapshotting while MLX controller turns are pending', async () => {
    const stepOrder: string[] = [];
    let tickCount = () => 0;
    const flushRuntime = vi.fn(async () => {
      stepOrder.push(`flush:${tickCount()}`);
    });
    const harness = createTurnStepperHarness(
      {
        playerCount: 2,
        controllers: { left: 'planner', right: 'planner' },
      },
      {
        flushRuntime,
        onSnapshot: () => {
          stepOrder.push(`snapshot:${tickCount()}`);
        },
      }
    );
    tickCount = harness.tickCount;

    await harness.stepper.tick();
    await harness.stepper.tick();

    expect(harness.leftAskCount()).toBe(1);
    expect(harness.rightAskCount()).toBe(1);
    expect(flushRuntime).toHaveBeenCalledTimes(2);
    expect(stepOrder).toEqual(['snapshot:0', 'flush:1', 'snapshot:1', 'flush:2']);
    expect(harness.tickCount()).toBe(2);
    expect(harness.renderedSnapshots).toHaveLength(2);
  });

  it('reports held telemetry instead of overlapping simulation ticks', async () => {
    const flushDeferred = createDeferred<void>();
    const flushRuntime = vi.fn(() => flushDeferred.promise);
    const harness = createTurnStepperHarness(
      {
        playerCount: 2,
        controllers: { left: 'human', right: 'human' },
      },
      {
        flushRuntime,
      }
    );

    const firstTick = harness.stepper.tick();
    for (let attempt = 0; attempt < 5 && flushRuntime.mock.calls.length === 0; attempt += 1) {
      await flushMicrotasks();
    }
    expect(flushRuntime).toHaveBeenCalledTimes(1);

    await harness.stepper.tick();
    expect(harness.commands.filter((command) => command === 'ball:TICK')).toHaveLength(1);
    expect(harness.telemetryEvents.some((event) => event.type === 'simulation-held')).toBe(true);
    const summary = harness.telemetryEvents.reduce(
      reduceMeshPongBenchmarkSummary,
      createMeshPongBenchmarkSummaryState(0)
    );
    expect(summary.simulation.heldCount).toBe(1);

    flushDeferred.resolve();
    await firstTick;
    expect(harness.renderedSnapshots).toHaveLength(1);
  });

  it('uses remote controller actors even when a shell MLX runner is supplied', async () => {
    const runMlxController = vi.fn(
      async (side: PongSide): Promise<PongControllerResult> => ({
        ok: true,
        provider: 'llm',
        side,
        strategy: createPlannerStrategy(side, {
          targetY: side === 'left' ? 0 : PONG_FIELD.height - PONG_FIELD.paddleHeight,
          biasY: 0,
          label: side === 'left' ? 'hug-top' : 'hug-bottom',
        }),
      })
    );
    const harness = createTurnStepperHarness(
      {
        playerCount: 2,
        controllers: { left: 'planner', right: 'planner' },
      },
      { runMlxController }
    );

    await harness.stepper.tick();
    await flushMicrotasks();
    await harness.stepper.tick();

    expect(runMlxController).not.toHaveBeenCalled();
    expect(harness.leftAskCount()).toBeGreaterThan(0);
    expect(harness.rightAskCount()).toBeGreaterThan(0);
    expect(harness.commands).toEqual(['ball:TICK', 'ball:TICK']);
  });

  it('reports coordinator command failures as status data instead of throwing from the turn stepper', async () => {
    const harness = createTurnStepperHarness(
      {
        playerCount: 2,
        controllers: { left: 'human', right: 'human' },
      },
      {
        tickFailure: {
          ok: false,
          reason: 'not-authority',
          authoritySessionId: 'other-tab',
          requestSessionId: 'owner-tab',
        },
      }
    );

    await expect(harness.stepper.tick()).resolves.toBeUndefined();
    expect(harness.statuses.at(-1)).toBe('not-authority');
    expect(harness.commands).toEqual([]);
  });

  it('uses controller schedule policy for ask timeout and stale intent reuse', async () => {
    expect(DEFAULT_MESH_PONG_CONTROLLER_SCHEDULE_POLICY).toEqual({
      simulationIntervalMs: 90,
      controllerAskTimeoutMs: 30_000,
      plannerStrategyFreshTurnLimit: 2,
      plannerStrategyStaleTurnLimit: 1,
    });
    const harness = createTurnStepperHarness(
      {
        playerCount: 1,
        controllers: { left: 'human', right: 'planner' },
      },
      {
        schedulePolicy: {
          ...DEFAULT_MESH_PONG_CONTROLLER_SCHEDULE_POLICY,
          controllerAskTimeoutMs: 1_234,
          plannerStrategyFreshTurnLimit: 1,
          plannerStrategyStaleTurnLimit: 0,
        },
      }
    );

    await harness.stepper.tick();
    expect(harness.rightAskTimeouts()).toEqual([1_234]);
    harness.rightDeferreds[0]?.resolve({
      ok: true,
      provider: 'llm',
      side: 'right',
      strategy: createPlannerStrategy('right', {
        targetY: PONG_FIELD.height - PONG_FIELD.paddleHeight,
        biasY: 0,
        label: 'hug-bottom',
      }),
    });
    await flushMicrotasks();

    await harness.stepper.tick();
    await harness.stepper.tick();
    await harness.stepper.tick();

    expect(harness.rightAskTimeouts()).toEqual([1_234, 1_234]);
    expect(harness.commands.filter((command) => command === 'right:MOVE_PADDLE')).toHaveLength(1);
  });

  it('summarizes one-player and mlx-vs-mlx benchmark telemetry without a live provider', async () => {
    const onePlayer = createTurnStepperHarness({
      playerCount: 1,
      controllers: { left: 'planner', right: 'human' },
    });
    await onePlayer.stepper.tick();
    onePlayer.leftDeferreds[0]?.resolve({
      ok: true,
      provider: 'llm',
      side: 'left',
      strategy: createPlannerStrategy('left', {
        targetY: 0,
        biasY: 0,
        label: 'hug-top',
      }),
    });
    await flushMicrotasks();
    await onePlayer.stepper.tick();

    const onePlayerSummary = onePlayer.telemetryEvents.reduce(
      reduceMeshPongBenchmarkSummary,
      createMeshPongBenchmarkSummaryState(0)
    );
    expect(onePlayerSummary.controllers.startedCount).toBeGreaterThanOrEqual(1);
    expect(onePlayerSummary.controllers.finishedCount).toBeGreaterThanOrEqual(1);
    expect(onePlayerSummary.simulation.appliedCount).toBeGreaterThanOrEqual(2);
    expect(onePlayerSummary.gameplayEffect).toBe('smooth');

    const mlxVsMlx = createTurnStepperHarness({
      playerCount: 2,
      controllers: { left: 'planner', right: 'planner' },
    });
    await mlxVsMlx.stepper.tick();
    mlxVsMlx.leftDeferreds[0]?.resolve({
      ok: true,
      provider: 'llm',
      side: 'left',
      strategy: createPlannerStrategy('left', {
        targetY: 0,
        biasY: 0,
        label: 'hug-top',
      }),
    });
    mlxVsMlx.rightDeferreds[0]?.reject(new Error('controller-timeout'));
    await flushMicrotasks();
    await mlxVsMlx.stepper.tick();

    const mlxVsMlxSummary = mlxVsMlx.telemetryEvents.reduce(
      reduceMeshPongBenchmarkSummary,
      createMeshPongBenchmarkSummaryState(0)
    );
    expect(mlxVsMlxSummary.controllers.startedCount).toBeGreaterThanOrEqual(2);
    expect(mlxVsMlxSummary.controllers.finishedCount).toBeGreaterThanOrEqual(2);
    expect(mlxVsMlxSummary.controllers.timeoutCount).toBe(1);
    expect(mlxVsMlxSummary.gameplayEffect).toBe('timeout-bound');
    expect(formatMeshPongBenchmarkSummary(mlxVsMlxSummary)).toContain('timeouts 1');
  });

  it('counts provider-returned MLX timeout failures through turn-stepper telemetry', async () => {
    const harness = createTurnStepperHarness({
      playerCount: 1,
      controllers: { left: 'planner', right: 'human' },
    });
    await harness.stepper.tick();
    harness.leftDeferreds[0]?.resolve({
      ok: false,
      side: 'left',
      reason: 'provider-failed',
      error: {
        code: 'LLM_PROVIDER_FAILED',
        message:
          'Local MLX request timed out after 20000ms for http://127.0.0.1:8080/v1/chat/completions.',
      },
    });
    await flushMicrotasks();

    const leftFinishedEvent = harness.telemetryEvents.find(
      (
        event
      ): event is Extract<
        MeshPongTelemetryEvent,
        { readonly type: 'controller-request-finished' }
      > => event.type === 'controller-request-finished' && event.side === 'left'
    );
    expect(leftFinishedEvent?.outcome).toBe('error');
    expect(leftFinishedEvent?.error).toContain('provider-failed');
    expect(leftFinishedEvent?.error).toContain('LLM_PROVIDER_FAILED');
    expect(leftFinishedEvent?.error).toContain('timed out');

    const summary = harness.telemetryEvents.reduce(
      reduceMeshPongBenchmarkSummary,
      createMeshPongBenchmarkSummaryState(0)
    );
    expect(summary.controllers.timeoutCount).toBe(1);
    expect(summary.timeoutRate).toBe(1);
    expect(summary.gameplayEffect).toBe('timeout-bound');
  });

  it('discards late MLX completions after the match generation changes', async () => {
    const harness = createTurnStepperHarness({
      playerCount: 1,
      controllers: { left: 'planner', right: 'human' },
    });

    await harness.stepper.tick();
    expect(harness.leftAskCount()).toBe(1);

    harness.matchState.generation += 1;
    harness.leftDeferreds[0]?.resolve({
      ok: true,
      provider: 'llm',
      side: 'left',
      strategy: createPlannerStrategy('left', {
        targetY: 0,
        biasY: 0,
        label: 'hug-top',
      }),
    });
    await flushMicrotasks();
    await harness.stepper.tick();

    expect(harness.commands.filter((command) => command === 'left:MOVE_PADDLE')).toHaveLength(0);
    expect(harness.replayedInputs).toHaveLength(0);
    expect(harness.leftAskCount()).toBe(2);
  });

  it('discards stale rejected MLX completions after the match generation changes', async () => {
    const harness = createTurnStepperHarness({
      playerCount: 1,
      controllers: { left: 'planner', right: 'human' },
    });

    await harness.stepper.tick();
    expect(harness.leftAskCount()).toBe(1);

    harness.matchState.generation += 1;
    harness.leftDeferreds[0]?.reject(new Error('stale provider timeout'));
    await flushMicrotasks();
    await harness.stepper.tick();

    expect(
      harness.telemetryEvents.some(
        (event) =>
          event.type === 'controller-request-finished' &&
          event.side === 'left' &&
          event.outcome === 'error'
      )
    ).toBe(false);
    expect(harness.commands.filter((command) => command === 'left:MOVE_PADDLE')).toHaveLength(0);
    expect(harness.replayedInputs).toHaveLength(0);
    expect(harness.leftAskCount()).toBe(2);
  });

  it('projects missing or unavailable LLM controller providers as data', async () => {
    const runtime = await startMeshPongLocal();
    startedRuntimes.push(runtime);
    const controllers = await resolveControllerRefs(runtime);

    await expect(
      controllers.left.ask<PongControllerResult>({
        type: 'RUN_CONTROLLER',
        snapshot: await currentSnapshot(runtime),
      })
    ).resolves.toEqual({
      ok: false,
      side: 'left',
      reason: 'llm-unavailable',
      error: {
        code: 'LLM_TOOL_UNAVAILABLE',
        message: 'Actor tool "llm" is not registered.',
      },
    });
  });

  it('keeps coordinator snapshot score totals authoritative across ticks', async () => {
    const runtime = await startMeshPongLocal();
    startedRuntimes.push(runtime);
    const matchCoordinator = await prepareRunningMatch(runtime);

    const firstScore = await driveUntilNextScore(runtime, matchCoordinator, 0);
    const secondScore = await driveUntilNextScore(
      runtime,
      matchCoordinator,
      firstScore.sequence.length
    );
    const latestPoint = secondScore.sequence[secondScore.sequence.length - 1];
    expect(secondScore.left + secondScore.right).toBe(firstScore.left + firstScore.right + 1);
    expect(latestPoint.left).toBe(secondScore.left);
    expect(latestPoint.right).toBe(secondScore.right);
  });

  it('does not bounce a ball that was already behind a paddle face', () => {
    const baseContext = createInitialBallContext(DEFAULT_PONG_SEED);
    const leftPaddleRight = PONG_FIELD.paddleMargin + PONG_FIELD.paddleWidth;
    const ballY = baseContext.leftPaddleY + 10;

    const result = advanceBall({
      ...baseContext,
      ball: {
        ...baseContext.ball,
        x: leftPaddleRight - PONG_FIELD.ballRadius - 1,
        y: ballY,
        vx: -PONG_FIELD.ballSpeedX,
        vy: 0,
      },
    });

    expect(result.context.ball.vx).toBeLessThan(0);
    expect(result.context.ball.x).toBeLessThan(leftPaddleRight);
  });

  it('cleans up partially started broadcast nodes when startup fails', async () => {
    const broadcastNetwork = new FakeBroadcastChannelNetwork();
    let createdChannels = 0;

    await expect(
      startMeshPongBroadcast({
        channelName: 'mesh-pong-broadcast-startup-failure',
        broadcastChannelFactory: (channelName) => {
          createdChannels += 1;
          if (createdChannels === 2) {
            throw new Error('broadcast channel setup failed');
          }
          return broadcastNetwork.create(channelName);
        },
        webLocks: new FakeWebLocks(),
      })
    ).rejects.toThrow('broadcast channel setup failed');

    expect(broadcastNetwork.size()).toBe(0);
  });

  it('stops a broadcast client when joining the host fails after node startup', async () => {
    const stop = vi.fn(async () => undefined);
    const client = {
      system: {
        join: vi.fn(async () => {
          throw new Error('client join failed');
        }),
        flush: vi.fn(async () => undefined),
      },
      stop,
    };

    await expect(
      startMeshPongBroadcastClient({
        channelName: 'mesh-pong-broadcast-client-failure',
        sessionId: 'guest-tab',
        startNode: (async () => client) as never,
      })
    ).rejects.toThrow('client join failed');
    expect(stop).toHaveBeenCalledOnce();
  });

  it('stops a partially created websocket client when player-session startup fails', async () => {
    const stop = vi.fn(async () => undefined);
    const client = {
      actors: {
        playerSession: {
          instance: vi.fn(async () => {
            throw new Error('player session failed');
          }),
        },
      },
      system: {
        flush: vi.fn(async () => undefined),
      },
      stop,
    };
    const result = await startMeshPongBrowserWebSocketClient({
      sessionId: 'browser-tab',
      helper: {
        getStatus: vi.fn(async () => ({
          state: 'ready' as const,
          transportUrl: 'ws://127.0.0.1:1',
          matchAddress: 'actor://pong-server/match-coordinator',
        })),
        flush: vi.fn(async () => undefined),
      },
      startClientNode: (async () => client) as never,
    });

    expect(result).toMatchObject({
      ok: false,
      state: 'transport-failed',
      message: 'player session failed',
    });
    expect(stop).toHaveBeenCalledOnce();
  });

  it('holds the broadcast host lease until stop, keeps concurrent joiners client-only, and releases on stop', async () => {
    const webLocks = new FakeWebLocks();
    const broadcastNetwork = new FakeBroadcastChannelNetwork();
    const channelName = 'mesh-pong-broadcast-lease';

    const host = await startMeshPongBroadcast({
      sessionId: 'host-tab',
      channelName,
      broadcastChannelFactory: broadcastNetwork.create,
      webLocks,
    });
    startedRuntimes.push(host);

    expect(host.hostAcquired).toBe(true);
    expect(webLocks.activeNames.has(`mesh-pong:${channelName}:host`)).toBe(true);

    const client = await startMeshPongBroadcast({
      sessionId: 'guest-tab',
      channelName,
      broadcastChannelFactory: broadcastNetwork.create,
      webLocks,
    });
    startedRuntimes.push(client);

    expect(client.hostAcquired).toBe(false);
    expect(client.server).toBeUndefined();
    expect(client.a).toBeUndefined();
    expect(client.b).toBeUndefined();
    expect(
      webLocks.requestLog.some(
        (entry) => entry.name === `mesh-pong:${channelName}:host` && entry.granted === false
      )
    ).toBe(true);

    await host.stop();
    await flushMicrotasks();
    expect(webLocks.activeNames.has(`mesh-pong:${channelName}:host`)).toBe(false);
    expect(webLocks.releasedNames).toContain(`mesh-pong:${channelName}:host`);
  });

  it('routes a client-only broadcast runtime through cluster refs without websocket addresses', async () => {
    const webLocks = new FakeWebLocks();
    const broadcastNetwork = new FakeBroadcastChannelNetwork();
    const channelName = 'mesh-pong-broadcast-client-ref-path';

    const host = await startMeshPongBroadcast({
      sessionId: 'host-tab',
      channelName,
      broadcastChannelFactory: broadcastNetwork.create,
      webLocks,
    });
    const client = await startMeshPongBroadcast({
      sessionId: 'guest-tab',
      channelName,
      broadcastChannelFactory: broadcastNetwork.create,
      webLocks,
    });
    startedRuntimes.push(host, client);

    expect(client.hostAcquired).toBe(false);
    expect(resolveBrowserRuntimeRefPath(client)).toBe('cluster');
    expect(resolveBrowserRuntimeRefPath({ mode: 'mesh' })).toBe('cluster');
    expect(resolveBrowserRuntimeRefPath({ mode: 'websocket' })).toBe('websocket');
    expect(resolveBrowserRuntimeRefPath({})).toBe('local');
    expect(client).not.toHaveProperty('playerSessionAddress');
    expect(client).not.toHaveProperty('matchCoordinatorAddress');
  });

  it('re-hydrates websocket player sessions and authoritative match state across reconnects', async () => {
    const runtime = await startMeshPongWebSocketLoopback();
    startedRuntimes.push(runtime);

    const server = serverNode(runtime);
    const matchCoordinator = server.requireActor('matchCoordinator') as ActorRef<
      PongMatchState,
      PongMatchCommand
    >;
    const session = await createPlayerSession(runtime, { sessionId: 'tab-a' });
    const reconnect = await createPlayerSession(runtime, { sessionId: 'tab-a' });
    const opponent = await createPlayerSession(runtime, { sessionId: 'tab-b' });

    await session.send({ type: 'CLAIM_SIDE', side: 'left' });
    await session.send({ type: 'SET_READY', ready: true });
    await opponent.send({ type: 'CLAIM_SIDE', side: 'right' });
    await opponent.send({ type: 'SET_READY', ready: true });
    await syncCoordinatorSession(matchCoordinator, session);
    await syncCoordinatorSession(matchCoordinator, opponent);
    await flush(runtime);

    await matchCoordinator.ask<PongMatchCommandResult>({
      type: 'START_MATCH',
      requestSessionId: 'tab-a',
      expectedGeneration: 0,
      mode: TWO_HUMAN_PONG_MATCH_MODE,
    });
    await matchCoordinator.ask<PongMatchCommandResult>({
      type: 'TICK_MATCH',
      requestSessionId: 'tab-a',
      expectedGeneration: 1,
    });
    await flush(runtime);

    expect(reconnect.address).toBe(session.address);
    await expect(reconnect.ask({ type: 'GET_SESSION' })).resolves.toEqual({
      sessionId: 'tab-a',
      controller: 'human',
      side: 'left',
      ready: true,
    });
    await expect(currentMatchState(matchCoordinator)).resolves.toMatchObject({
      generation: 1,
      phase: 'running',
      authoritySessionId: 'tab-a',
      tick: 1,
      sessions: expect.arrayContaining([
        expect.objectContaining({ sessionId: 'tab-a', side: 'left', ready: true }),
        expect.objectContaining({ sessionId: 'tab-b', side: 'right', ready: true }),
      ]),
    });
  });

  it('restores a replacement broadcast client from its authoritative same-id session', async () => {
    const broadcastNetwork = new FakeBroadcastChannelNetwork();
    const webLocks = new FakeWebLocks();
    const channelName = 'mesh-pong-broadcast-client-replacement';
    const host = await startMeshPongBroadcast({
      sessionId: 'host-tab',
      channelName,
      broadcastChannelFactory: broadcastNetwork.create,
      webLocks,
    });
    const guest = await startMeshPongBroadcast({
      sessionId: 'guest-tab',
      channelName,
      broadcastChannelFactory: broadcastNetwork.create,
      webLocks,
    });
    startedRuntimes.push(host, guest);

    const hostCoordinator = await resolveDistributedMatchCoordinator(host);
    const guestCoordinator = await resolveDistributedMatchCoordinator(guest);
    const hostSession = await createPlayerSession(host, { sessionId: 'host-tab' });
    const guestSession = await createPlayerSession(guest, { sessionId: 'guest-tab' });
    await hostSession.send({ type: 'CLAIM_SIDE', side: 'left' });
    await hostSession.send({ type: 'SET_READY', ready: true });
    await guestSession.send({ type: 'CLAIM_SIDE', side: 'right' });
    await guestSession.send({ type: 'SET_READY', ready: true });
    await syncCoordinatorSession(hostCoordinator, hostSession);
    await syncCoordinatorSession(guestCoordinator, guestSession);
    await flush(host);
    await flush(guest);

    await expect(
      hostCoordinator.ask<PongMatchCommandResult>({
        type: 'START_MATCH',
        requestSessionId: 'host-tab',
        expectedGeneration: 0,
        mode: TWO_HUMAN_PONG_MATCH_MODE,
      })
    ).resolves.toMatchObject({ ok: true });
    await flush(host);
    await flush(guest);

    await guest.stop();
    const replacement = await startMeshPongBroadcastClient({
      sessionId: 'guest-tab',
      channelName,
      broadcastChannelFactory: broadcastNetwork.create,
    });
    startedRuntimes.push(replacement);
    expect(replacement.client).not.toBe(guest.client);

    const replacementCoordinator = await resolveDistributedMatchCoordinator(replacement);
    const replacementSession = await createPlayerSession(replacement, {
      sessionId: 'guest-tab',
    });
    await expect(replacementSession.ask({ type: 'GET_SESSION' })).resolves.toEqual(
      createInitialPlayerSession('guest-tab')
    );

    const hydration = await restoreAndSyncMeshPongPlayerSession({
      playerSession: replacementSession,
      matchCoordinator: replacementCoordinator,
      flush: async () => {
        await replacement.flush();
        await host.flush();
      },
    });
    expect(hydration).toMatchObject({
      ok: true,
      session: {
        sessionId: 'guest-tab',
        controller: 'human',
        side: 'right',
        ready: true,
      },
      match: {
        phase: 'running',
        generation: 1,
        authoritySessionId: 'host-tab',
      },
    });
    await expect(replacementSession.ask({ type: 'GET_SESSION' })).resolves.toEqual({
      sessionId: 'guest-tab',
      controller: 'human',
      side: 'right',
      ready: true,
    });

    const beforeInput = await currentMatchState(hostCoordinator);
    const input = await replacementSession.ask<PongControllerInputResult>({
      type: 'MOVE_CONTROLLER',
      direction: 'down',
    });
    expect(input).toMatchObject({ ok: true, sessionId: 'guest-tab', side: 'right' });
    if (!input.ok) {
      throw new Error(`Expected restored guest input, received ${input.reason}.`);
    }
    await expect(
      replacementCoordinator.ask<PongMatchCommandResult>({
        type: 'APPLY_CONTROLLER_INPUT',
        requestSessionId: 'guest-tab',
        expectedGeneration: beforeInput.generation,
        input,
      })
    ).resolves.toMatchObject({ ok: true });
    await flush(host);
    await replacement.flush();

    const [hostAfterInput, replacementAfterInput] = await Promise.all([
      currentMatchState(hostCoordinator),
      currentMatchState(replacementCoordinator),
    ]);
    expect(hostAfterInput.snapshot.paddles.right.y).toBe(
      beforeInput.snapshot.paddles.right.y + input.amount
    );
    expect(replacementAfterInput.snapshot).toEqual(hostAfterInput.snapshot);
    await expect(
      replacementCoordinator.ask<PongMatchCommandResult>({
        type: 'TICK_MATCH',
        requestSessionId: 'guest-tab',
        expectedGeneration: hostAfterInput.generation,
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'not-authority',
      requestSessionId: 'guest-tab',
      authoritySessionId: 'host-tab',
    });
  });

  it('starts broadcast and mesh with one Web Locks host lease instead of booting server a and b in every client', async () => {
    const [broadcastMode, meshMode] = await Promise.all([
      readFile(path.resolve(meshPongExamplesDir, 'mesh-pong/modes/broadcast.ts'), 'utf8'),
      readFile(path.resolve(meshPongExamplesDir, 'mesh-pong/modes/mesh.ts'), 'utf8'),
    ]);

    expect(broadcastMode).toContain('navigator.locks.request');
    expect(broadcastMode).toContain('ifAvailable: true');
    expect(broadcastMode).toContain('startMeshPongBroadcastHost');
    expect(broadcastMode).toContain('startMeshPongBroadcastClient');
    expect(meshMode).toContain('startMeshPongMeshHost');
    expect(meshMode).toContain('startMeshPongMeshClient');
    expect(meshMode).toContain('createMeshOverlayForStartedNodes');
  });

  it('starts one websocket host and gives browser sessions unique client nodes without a provisioning route', async () => {
    const [websocketMode, viteConfig] = await Promise.all([
      readFile(path.resolve(meshPongExamplesDir, 'mesh-pong/modes/websocket.ts'), 'utf8'),
      readFile(path.resolve(meshPongExamplesDir, 'vite.config.ts'), 'utf8'),
    ]);

    expect(websocketMode).toContain('startMeshPongWebSocketHost');
    expect(websocketMode).toContain('startMeshPongBrowserWebSocketClient');
    expect(websocketMode).toContain('clientNodeAddress');
    expect(websocketMode).not.toContain('ensurePlayerSession');
    expect(viteConfig).not.toContain('/__mesh-pong/websocket/session');
    expect(viteConfig).toContain('matchAddress');
  });

  it('keeps score parity sourced from the coordinator snapshot instead of a separate score actor', () => {
    expect(MESH_PONG_SHARED_PARITY_PROOF.actors).not.toContain('score');
    expect(MESH_PONG_SHARED_PARITY_PROOF.actors).not.toContain('ball');
    expect(MESH_PONG_SHARED_PARITY_PROOF.actors).not.toContain('lobby');
    expect(MESH_PONG_SHARED_PARITY_PROOF.validationGate).toContain('coordinator');
  });

  it('keeps authoritative lifecycle convergence parity across local, broadcast, and websocket runtimes', async () => {
    const local = await startMeshPongLocal();
    const broadcast = await startMeshPongBroadcast({
      channelName: 'mesh-pong-lifecycle-parity',
      broadcastChannelFactory: new FakeBroadcastChannelNetwork().create,
      webLocks: new FakeWebLocks(),
    });
    const websocket = await startMeshPongWebSocketLoopback();
    startedRuntimes.push(local, broadcast, websocket);

    const exercise = async (runtime: StartedMeshPongRuntime) => {
      const { matchCoordinator, sessionA, sessionB } = await resolveSessionRefs(runtime);

      await sessionA.send({ type: 'CLAIM_SIDE', side: 'left' });
      await sessionA.send({ type: 'SET_READY', ready: true });
      await sessionB.send({ type: 'CLAIM_SIDE', side: 'right' });
      await sessionB.send({ type: 'SET_READY', ready: true });
      await syncCoordinatorSession(matchCoordinator, sessionA);
      await syncCoordinatorSession(matchCoordinator, sessionB);
      await flush(runtime);

      await matchCoordinator.ask<PongMatchCommandResult>({
        type: 'START_MATCH',
        requestSessionId: 'tab-a',
        expectedGeneration: 0,
        mode: TWO_HUMAN_PONG_MATCH_MODE,
      });
      await matchCoordinator.ask<PongMatchCommandResult>({
        type: 'TICK_MATCH',
        requestSessionId: 'tab-a',
        expectedGeneration: 1,
      });
      await matchCoordinator.ask<PongMatchCommandResult>({
        type: 'RESTART_MATCH',
        requestSessionId: 'tab-b',
        expectedGeneration: 1,
      });
      await flush(runtime);

      return currentMatchState(matchCoordinator);
    };

    const [localState, broadcastState, websocketState] = await Promise.all([
      exercise(local),
      exercise(broadcast),
      exercise(websocket),
    ]);

    expect(localState).toMatchObject({
      phase: 'running',
      generation: 2,
      authoritySessionId: 'tab-b',
      tick: 0,
      snapshot: {
        score: { left: 0, right: 0 },
      },
    });
    expect(broadcastState).toEqual(localState);
    expect(websocketState).toEqual(localState);
  });

  it('converges independent broadcast clients on the authoritative pre-start projection', async () => {
    const broadcastNetwork = new FakeBroadcastChannelNetwork();
    const webLocks = new FakeWebLocks();
    const channelName = 'mesh-pong-broadcast-pre-start-convergence';
    const host = await startMeshPongBroadcast({
      sessionId: 'host-tab',
      channelName,
      broadcastChannelFactory: broadcastNetwork.create,
      webLocks,
    });
    const client = await startMeshPongBroadcast({
      sessionId: 'guest-tab',
      channelName,
      broadcastChannelFactory: broadcastNetwork.create,
      webLocks,
    });
    startedRuntimes.push(host, client);

    const [hostCoordinator, guestCoordinator] = await Promise.all([
      resolveDistributedMatchCoordinator(host),
      resolveDistributedMatchCoordinator(client),
    ]);
    const [hostSession, guestSession] = await Promise.all([
      createPlayerSession(host, { sessionId: 'host-tab' }),
      createPlayerSession(client, { sessionId: 'guest-tab' }),
    ]);
    const hostSource = createActorSource<PongMatchState, PongMatchCommand>(hostCoordinator);
    const guestSource = createActorSource<PongMatchState, PongMatchCommand>(guestCoordinator);
    const hostSourceProjections: PongMatchState[] = [];
    const guestSourceProjections: PongMatchState[] = [];
    const unsubscribeHostSource = hostSource.subscribe((snapshot) => {
      hostSourceProjections.push(snapshot.context);
    });
    const unsubscribeGuestSource = guestSource.subscribe((snapshot) => {
      guestSourceProjections.push(snapshot.context);
    });
    const requestedMode: PongShellMatchMode = {
      playerCount: 2,
      controllers: { left: 'human', right: 'human' },
    };

    const [initialHostProjection, initialGuestProjection] = await Promise.all([
      currentMatchState(hostCoordinator),
      currentMatchState(guestCoordinator),
    ]);
    expect(initialGuestProjection).toEqual(initialHostProjection);
    expect(initialHostProjection.controllers).toHaveLength(0);
    expect(
      isProjectedMatchReadyToStart({
        match: initialHostProjection,
        session: createInitialPlayerSession('host-tab'),
        mode: requestedMode,
        expectedGeneration: initialHostProjection.generation,
      })
    ).toBe(false);

    await hostSession.send({ type: 'CLAIM_SIDE', side: 'left' });
    await hostSession.send({ type: 'SET_READY', ready: true });
    await syncCoordinatorSession(hostCoordinator, hostSession);
    await flush(host);
    await flush(client);

    const [oneReadyHostProjection, oneReadyGuestProjection] = await Promise.all([
      currentMatchState(hostCoordinator),
      currentMatchState(guestCoordinator),
    ]);
    const hostReadySession = await hostSession.ask<PongPlayerSessionState>({
      type: 'GET_SESSION',
    });
    expect(oneReadyGuestProjection).toEqual(oneReadyHostProjection);
    expect(oneReadyHostProjection.controllers).toEqual([
      { sessionId: 'host-tab', controller: 'human', side: 'left', ready: true },
    ]);
    expect(hostSourceProjections.at(-1)?.controllers).toEqual(oneReadyHostProjection.controllers);
    expect(guestSourceProjections.at(-1)?.controllers).toEqual(oneReadyGuestProjection.controllers);
    expect(
      isProjectedMatchReadyToStart({
        match: oneReadyHostProjection,
        session: hostReadySession,
        mode: requestedMode,
        expectedGeneration: oneReadyHostProjection.generation,
      })
    ).toBe(false);

    await guestSession.send({ type: 'CLAIM_SIDE', side: 'right' });
    await guestSession.send({ type: 'SET_READY', ready: true });
    await syncCoordinatorSession(guestCoordinator, guestSession);
    await flush(host);
    await flush(client);

    const [hostProjection, guestProjection] = await Promise.all([
      currentMatchState(hostCoordinator),
      currentMatchState(guestCoordinator),
    ]);
    const expectedControllers = [
      { sessionId: 'host-tab', controller: 'human', side: 'left', ready: true },
      { sessionId: 'guest-tab', controller: 'human', side: 'right', ready: true },
    ];
    expect(hostProjection).toMatchObject({
      phase: 'lobby',
      generation: 0,
      controllers: expectedControllers,
    });
    expect(guestProjection).toEqual(hostProjection);
    expect(hostSourceProjections.at(-1)?.controllers).toEqual(hostProjection.controllers);
    expect(guestSourceProjections.at(-1)?.controllers).toEqual(guestProjection.controllers);
    const guestReadySession = await guestSession.ask<PongPlayerSessionState>({
      type: 'GET_SESSION',
    });
    expect(
      isProjectedMatchReadyToStart({
        match: hostProjection,
        session: hostReadySession,
        mode: requestedMode,
        expectedGeneration: hostProjection.generation,
      })
    ).toBe(true);
    expect(
      isProjectedMatchReadyToStart({
        match: guestProjection,
        session: guestReadySession,
        mode: requestedMode,
        expectedGeneration: guestProjection.generation,
      })
    ).toBe(true);
    expect(
      isProjectedMatchReadyToStart({
        match: hostProjection,
        session: hostReadySession,
        mode: requestedMode,
        expectedGeneration: hostProjection.generation + 1,
      })
    ).toBe(false);
    expect(
      isProjectedMatchReadyToStart({
        match: hostProjection,
        session: hostReadySession,
        mode: {
          playerCount: 1,
          controllers: { left: 'human', right: 'planner' },
        },
        expectedGeneration: hostProjection.generation,
      })
    ).toBe(false);

    const [hostControllers, guestControllers] = await Promise.all([
      resolveControllerRefs(host),
      resolveControllerRefs(client),
    ]);
    await expect(
      Promise.all([
        hostControllers.left.ask({ type: 'GET_CONTROLLER' }),
        hostControllers.right.ask({ type: 'GET_CONTROLLER' }),
        guestControllers.left.ask({ type: 'GET_CONTROLLER' }),
        guestControllers.right.ask({ type: 'GET_CONTROLLER' }),
      ])
    ).resolves.toHaveLength(4);
    unsubscribeGuestSource();
    unsubscribeHostSource();
  });

  it('keeps independent broadcast clients converged across restarts from each seated player', async () => {
    const broadcastNetwork = new FakeBroadcastChannelNetwork();
    const webLocks = new FakeWebLocks();
    const channelName = 'mesh-pong-broadcast-independent-clients';
    const host = await startMeshPongBroadcast({
      sessionId: 'host-tab',
      channelName,
      broadcastChannelFactory: broadcastNetwork.create,
      webLocks,
    });
    const client = await startMeshPongBroadcast({
      sessionId: 'guest-tab',
      channelName,
      broadcastChannelFactory: broadcastNetwork.create,
      webLocks,
    });
    startedRuntimes.push(host, client);

    const hostCoordinator = await resolveDistributedMatchCoordinator(host);
    const guestCoordinator = await resolveDistributedMatchCoordinator(client);
    const hostSession = await createPlayerSession(host, { sessionId: 'host-tab' });
    const guestSession = await createPlayerSession(client, { sessionId: 'guest-tab' });

    await hostSession.send({ type: 'CLAIM_SIDE', side: 'left' });
    await hostSession.send({ type: 'SET_READY', ready: true });
    await guestSession.send({ type: 'CLAIM_SIDE', side: 'right' });
    await guestSession.send({ type: 'SET_READY', ready: true });
    await syncCoordinatorSession(hostCoordinator, hostSession);
    await syncCoordinatorSession(guestCoordinator, guestSession);
    await flush(host);
    await flush(client);

    await hostCoordinator.ask<PongMatchCommandResult>({
      type: 'START_MATCH',
      requestSessionId: 'host-tab',
      expectedGeneration: 0,
      mode: TWO_HUMAN_PONG_MATCH_MODE,
    });
    await expect(
      hostCoordinator.ask<PongMatchCommandResult>({
        type: 'TICK_MATCH',
        requestSessionId: 'host-tab',
        expectedGeneration: 1,
      })
    ).resolves.toMatchObject({ ok: true });
    await flush(host);
    await flush(client);

    const beforeGuestInput = await currentMatchState(hostCoordinator);
    const guestInput = await guestSession.ask<PongControllerInputResult>({
      type: 'MOVE_CONTROLLER',
      direction: 'down',
    });
    expect(guestInput).toMatchObject({
      ok: true,
      sessionId: 'guest-tab',
      side: 'right',
      direction: 'down',
    });
    if (!guestInput.ok) {
      throw new Error(`Expected guest controller input, received ${guestInput.reason}.`);
    }

    await expect(
      guestCoordinator.ask<PongMatchCommandResult>({
        type: 'APPLY_CONTROLLER_INPUT',
        requestSessionId: 'guest-tab',
        expectedGeneration: beforeGuestInput.generation,
        input: guestInput,
      })
    ).resolves.toMatchObject({ ok: true });
    await flush(host);
    await flush(client);

    const [hostAfterGuestInput, guestAfterGuestInput] = await Promise.all([
      currentMatchState(hostCoordinator),
      currentMatchState(guestCoordinator),
    ]);
    expect(hostAfterGuestInput.snapshot.paddles.right.y).toBe(
      beforeGuestInput.snapshot.paddles.right.y + guestInput.amount
    );
    expect(guestAfterGuestInput.snapshot).toEqual(hostAfterGuestInput.snapshot);

    await expect(
      guestCoordinator.ask<PongMatchCommandResult>({
        type: 'TICK_MATCH',
        requestSessionId: 'guest-tab',
        expectedGeneration: beforeGuestInput.generation,
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'not-authority',
      requestSessionId: 'guest-tab',
      authoritySessionId: 'host-tab',
    });

    const assertConverged = async (expectedGeneration: number, expectedAuthority: string) => {
      const [hostMatch, clientMatch] = await Promise.all([
        currentMatchState(hostCoordinator),
        currentMatchState(guestCoordinator),
      ]);

      expect(hostMatch).toMatchObject({
        phase: 'running',
        generation: expectedGeneration,
        authoritySessionId: expectedAuthority,
      });
      expect(clientMatch.phase).toBe(hostMatch.phase);
      expect(clientMatch.generation).toBe(hostMatch.generation);
      expect(clientMatch.snapshot.score).toEqual(hostMatch.snapshot.score);
      expect(clientMatch.snapshot.ball).toEqual(hostMatch.snapshot.ball);
      expect(clientMatch.snapshot.paddles).toEqual(hostMatch.snapshot.paddles);
    };

    await hostCoordinator.ask<PongMatchCommandResult>({
      type: 'RESTART_MATCH',
      requestSessionId: 'host-tab',
      expectedGeneration: 1,
    });
    await flush(host);
    await flush(client);
    await assertConverged(2, 'host-tab');

    await guestCoordinator.ask<PongMatchCommandResult>({
      type: 'RESTART_MATCH',
      requestSessionId: 'guest-tab',
      expectedGeneration: 2,
    });
    await flush(host);
    await flush(client);
    await assertConverged(3, 'guest-tab');
  });

  it('keeps the browser proof panel tied to shared behavior and mode-only startup files', () => {
    expect(MESH_PONG_SHARED_PARITY_PROOF).toMatchObject({
      topologyFile: 'pong-topology.ts',
      behaviorFile: 'pong-behaviors.ts',
      validationGate:
        'mesh-pong.test.ts: coordinator lifecycle + score parity across local, broadcast, websocket',
    });
    expect(MESH_PONG_SHARED_PARITY_PROOF.actors).toEqual([
      'room',
      'matchCoordinator',
      'playerSession',
      'controllerLeft',
      'controllerRight',
    ]);

    expect(Object.keys(MESH_PONG_MODE_PARITY_PROOF).sort()).toEqual([
      'broadcast',
      'local',
      'mesh',
      'websocket',
    ]);

    for (const [mode, proof] of Object.entries(MESH_PONG_MODE_PARITY_PROOF)) {
      expect(proof).toBe(parityProofForMode(mode as keyof typeof MESH_PONG_MODE_PARITY_PROOF));
      expect(proof.startupFile).toBe(`modes/${mode}.ts`);
    }

    expect(MESH_PONG_MODE_PARITY_PROOF.local.nodeLayout).toBe(
      'server / a / b / client in one runtime'
    );
    expect(MESH_PONG_MODE_PARITY_PROOF.broadcast.nodeLayout).toBe(
      'host server / a / b / client; joiners client only'
    );
    expect(MESH_PONG_MODE_PARITY_PROOF.mesh.nodeLayout).toBe(
      'host server / a / b / client; joiners client only; local overlays'
    );
    expect(MESH_PONG_MODE_PARITY_PROOF.websocket.nodeLayout).toBe(
      'helper host server / a / b / client; browser tabs client only'
    );

    expect(parityProofForMode('websocket').transportBoundary).toContain('browser');
    expect(parityProofForMode('websocket').startupCall).toContain('startMeshPongBrowserWebSocket');
  });

  it('documents the coordinator-only topology and host-client mesh node shape', async () => {
    const readme = await readFile(path.resolve(meshPongExamplesDir, 'mesh-pong/README.md'), 'utf8');

    expect(readme).toContain('client: node(clientNodeAddress)');
    expect(readme).toContain("node: 'client'");
    expect(readme).toContain('controllerLeft: actor({');
    expect(readme).toContain('controllerRight: actor({');
    expect(readme).toContain('subscriptions: []');
    expect(readme).toContain('server / a / b / client');
    expect(readme).not.toContain("ball: actor({ id: 'ball'");
    expect(readme).not.toContain("score: actor({ id: 'score'");
    expect(readme).not.toContain("lobby: actor({ id: 'lobby'");
    expect(readme).not.toContain("paddleA: actor({ id: 'paddle-a'");
    expect(readme).not.toContain("paddleB: actor({ id: 'paddle-b'");
    expect(readme).not.toContain("events: ['SCORED']");
    expect(readme).not.toContain('coordinator / ball / paddle / score / session / lobby behaviors');
    expect(readme).not.toContain('renders snapshots from the score/ball actors');
    expect(readme).not.toMatch(/resolves remote\s+paddle actors/);
    expect(readme).not.toContain('Mesh mode runs the demo across 3 peers');
    expect(readme).not.toContain('cross-tab controller-input replay latency');
  });

  it('shows every transport and the authoritative actor set in the active transport proof', async () => {
    const html = await readFile(
      path.resolve(meshPongExamplesDir, 'mesh-pong/ui/index.html'),
      'utf8'
    );

    expect(html).toContain('<code>local = broadcast = mesh = websocket</code>');
    expect(html).toContain(
      '<code>room / matchCoordinator / playerSession / controllerLeft / controllerRight</code>'
    );
    expect(html).toContain(
      '<code id="proof-actors">room, matchCoordinator, playerSession, controllerLeft, controllerRight</code>'
    );
    expect(html).not.toContain('ball / score / paddles');
  });

  it('keeps the Mesh Pong browser entry on the browser-safe agent/runtime boundary', async () => {
    const agentEntrypoint = await readFile(
      path.resolve(meshPongExamplesDir, '../packages/actor-agent/src/index.ts'),
      'utf8'
    );
    const websocketMode = await readFile(
      path.resolve(meshPongExamplesDir, 'mesh-pong/modes/websocket.ts'),
      'utf8'
    );

    expect(agentEntrypoint).toContain("from '@actor-web/runtime/browser'");
    expect(agentEntrypoint).not.toContain("import { defineBehavior } from '@actor-web/runtime';");
    expect(websocketMode).not.toContain("import { serveNode } from '@actor-web/runtime/node'");
    expect(websocketMode).toContain("await import('@actor-web/runtime/node')");
  });

  it('bounds browser startup waits so the UI can leave the starting state on hangs', async () => {
    vi.useFakeTimers();
    try {
      const startup = withMeshPongStartupTimeout(
        new Promise<never>(() => undefined),
        'local actor refs',
        25
      );
      const assertion = expect(startup).rejects.toThrow(
        'Timed out starting Mesh Pong local actor refs.'
      );

      await vi.advanceTimersByTimeAsync(25);

      await assertion;
      expect(MESH_PONG_STARTUP_TIMEOUT_MS).toBe(5_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fences late reset and session continuations after startup sub-stage timeouts', async () => {
    vi.useFakeTimers();
    try {
      for (const lateStage of ['reset', 'hydrate'] as const) {
        const deferred = createDeferred<void>();
        const match = createInitialMatchState();
        const applyMatch = vi.fn();
        const applySession = vi.fn();
        const render = vi.fn();
        const setStatus = vi.fn();
        const activate = vi.fn();
        let generation = 1;
        let stopped = false;
        const stop = vi.fn(async () => {
          stopped = true;
        });

        const startup = runMeshPongStartupSubstages({
          label: `broadcast ${lateStage}`,
          timeoutMs: 25,
          shouldApply: () => generation === 1,
          invalidate: () => {
            generation += 1;
          },
          reset: (shouldApply) =>
            lateStage === 'reset'
              ? resetRuntimeGame({} as never, {} as never, {
                  shouldApply,
                  flush: () => deferred.promise,
                  readMatch: async () => match,
                  applyMatch,
                })
              : Promise.resolve(match.snapshot),
          hydrate: async (shouldApply) => {
            if (lateStage === 'hydrate') {
              await deferred.promise;
            }
            if (!shouldApply()) {
              return { ok: false } as const;
            }
            applySession();
            return { ok: true } as const;
          },
          stop,
          activate: (nextSnapshot) => {
            activate();
            stopped = false;
            render(nextSnapshot);
          },
          setStatus,
        });

        await vi.advanceTimersByTimeAsync(25);
        await expect(startup).resolves.toBe(false);
        expect(generation).toBe(2);
        expect(stop).toHaveBeenCalledOnce();
        expect(stopped).toBe(true);
        expect(activate).not.toHaveBeenCalled();
        const projectionCountAtTimeout = applyMatch.mock.calls.length;
        const sessionCountAtTimeout = applySession.mock.calls.length;
        const renderCountAtTimeout = render.mock.calls.length;
        const statusCountAtTimeout = setStatus.mock.calls.length;
        expect(statusCountAtTimeout).toBe(1);

        deferred.resolve();
        await flushMicrotasks();
        await flushMicrotasks();

        expect(applyMatch).toHaveBeenCalledTimes(projectionCountAtTimeout);
        expect(applySession).toHaveBeenCalledTimes(sessionCountAtTimeout);
        expect(render).toHaveBeenCalledTimes(renderCountAtTimeout);
        expect(setStatus).toHaveBeenCalledTimes(statusCountAtTimeout);
        expect(activate).not.toHaveBeenCalled();
        expect(stop).toHaveBeenCalledOnce();
        expect(stopped).toBe(true);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('disposes a runtime exactly once when startup resolves after its timeout', async () => {
    vi.useFakeTimers();
    try {
      const operation = createDeferred<{ stop(): Promise<void> }>();
      const stop = vi.fn(async () => undefined);
      const startup = withMeshPongStartupTimeout(operation.promise, 'late runtime', 25, (runtime) =>
        runtime.stop()
      );
      const assertion = expect(startup).rejects.toThrow(
        'Timed out starting Mesh Pong late runtime.'
      );

      await vi.advanceTimersByTimeAsync(25);
      await assertion;
      operation.resolve({ stop });
      await flushMicrotasks();

      expect(stop).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('absorbs late startup and disposer rejections after timeout', async () => {
    vi.useFakeTimers();
    try {
      const lateResolve = createDeferred<{ readonly id: string }>();
      const dispose = vi.fn(async () => {
        throw new Error('late dispose failed');
      });
      const resolvedStartup = withMeshPongStartupTimeout(
        lateResolve.promise,
        'late resolved runtime',
        25,
        dispose
      );
      const resolvedAssertion = expect(resolvedStartup).rejects.toThrow(
        'Timed out starting Mesh Pong late resolved runtime.'
      );
      await vi.advanceTimersByTimeAsync(25);
      await resolvedAssertion;
      lateResolve.resolve({ id: 'late-runtime' });
      await flushMicrotasks();
      expect(dispose).toHaveBeenCalledOnce();

      const lateReject = createDeferred<never>();
      const rejectedStartup = withMeshPongStartupTimeout(
        lateReject.promise,
        'late rejected runtime',
        25
      );
      const rejectedAssertion = expect(rejectedStartup).rejects.toThrow(
        'Timed out starting Mesh Pong late rejected runtime.'
      );
      await vi.advanceTimersByTimeAsync(25);
      await rejectedAssertion;
      lateReject.reject(new Error('late startup failed'));
      await flushMicrotasks();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves browser websocket paddle actors from their owning browser nodes', async () => {
    const uiEntrypoint = await readFile(
      path.resolve(meshPongExamplesDir, 'mesh-pong/ui/main.ts'),
      'utf8'
    );

    expect(uiEntrypoint).not.toContain('ownedPaddleActor');
    expect(uiEntrypoint).toContain('snapshot: () => snapshot(nextRefs)');
    expect(uiEntrypoint).not.toContain('pong.actors.paddleB.address');
  });

  it('keeps ready-button copy distinct for ready and not-ready sessions', async () => {
    const uiEntrypoint = await readFile(
      path.resolve(meshPongExamplesDir, 'mesh-pong/ui/main.ts'),
      'utf8'
    );

    expect(uiEntrypoint).toContain("session?.ready ? 'Ready' : 'Mark ready'");
    expect(uiEntrypoint).not.toContain("session?.ready ? 'Ready' : 'Ready'");
  });

  it('keeps browser MLX controller turns on an explicit local-model ask timeout', async () => {
    const uiEntrypoint = await readFile(
      path.resolve(meshPongExamplesDir, 'mesh-pong/ui/main.ts'),
      'utf8'
    );

    expect(uiEntrypoint).toContain('DEFAULT_MESH_PONG_CONTROLLER_SCHEDULE_POLICY');
    expect(uiEntrypoint).toContain('controllerAskTimeoutMs: 30_000');
    expect(uiEntrypoint).toContain('plannerStrategyFreshTurnLimit: 2');
    expect(uiEntrypoint).toContain('plannerStrategyStaleTurnLimit: 1');
    expect(uiEntrypoint).toContain('schedulePolicy.controllerAskTimeoutMs');
    expect(uiEntrypoint).toContain('schedulePolicy.plannerStrategyFreshTurnLimit');
    expect(uiEntrypoint).toContain('schedulePolicy.plannerStrategyStaleTurnLimit');
    expect(uiEntrypoint).toContain('createMeshPongTurnStepper');
    expect(uiEntrypoint).toContain('readonly requestId: number;');
    expect(uiEntrypoint).toContain('readonly startedAtMs: number;');
    expect(uiEntrypoint).not.toContain('hasInFlightMlxControllerRequest');
    expect(uiEntrypoint).not.toContain('nextMlxControllerSide');
    expect(uiEntrypoint).toContain('lane.staleTurnsRemaining');
    expect(uiEntrypoint).toContain('const startedAtMs = deps.nowMs();');
    expect(uiEntrypoint).toContain('sentAtMs: request.startedAtMs');
    expect(uiEntrypoint).toContain("'controller-timeout'");
  });

  it('keeps browser startup channel ids on the secure-context-safe session id helper', async () => {
    const uiEntrypoint = await readFile(
      path.resolve(meshPongExamplesDir, 'mesh-pong/ui/main.ts'),
      'utf8'
    );

    expect(uiEntrypoint).toContain('function createSessionId(): string');
    expect(uiEntrypoint).toContain('globalThis.crypto.randomUUID()');
    expect(uiEntrypoint).toContain("channelName: 'mesh-pong-demo'");
    expect(uiEntrypoint).toContain("channelName: 'mesh-pong-demo-mesh'");
  });

  it('guards stale browser session actions before publishing shared UI state', async () => {
    const uiEntrypoint = await readFile(
      path.resolve(meshPongExamplesDir, 'mesh-pong/ui/main.ts'),
      'utf8'
    );

    expect(uiEntrypoint).toContain('function isCurrentRuntimeContext(');
    expect(uiEntrypoint).toContain(
      'shouldApply: () => isCurrentRuntimeContext(currentRuntime, currentRefs)'
    );
    expect(uiEntrypoint).toContain('options: { readonly shouldApply?: () => boolean } = {}');
    expect(uiEntrypoint).toContain('runMeshPongStartupSubstages({');
    expect(uiEntrypoint).toContain('hydrateCurrentSession(candidateRuntime, nextRefs, {');
    expect(uiEntrypoint).toContain('invalidateSwitchGeneration(generation)');
    expect(uiEntrypoint).toContain('() => isCurrentRuntimeContext(currentRuntime, currentRefs)');
    expect(uiEntrypoint).toContain('if (!isCurrentRuntimeContext(currentRuntime, currentRefs))');
    expect(uiEntrypoint).toContain('renderLobby(nextMatch);');
    expect(uiEntrypoint).not.toContain('lobbyChannel?.postMessage');

    const returnToRoomSection = uiEntrypoint.slice(
      uiEntrypoint.indexOf('async function returnToRoom(): Promise<void> {'),
      uiEntrypoint.indexOf('function isBrowserRuntimeStartFailure(')
    );
    const staleGuardIndex = returnToRoomSection.indexOf(
      'if (!isCurrentRuntimeContext(currentRuntime, currentRefs))'
    );
    expect(staleGuardIndex).toBeGreaterThan(-1);
    expect(staleGuardIndex).toBeLessThan(returnToRoomSection.indexOf('applyProjectedMatch'));
  });

  it('retries websocket helper startup after a transient status failure', async () => {
    const viteConfig = await readFile(path.resolve(meshPongExamplesDir, 'vite.config.ts'), 'utf8');
    const statusSection = viteConfig.slice(
      viteConfig.indexOf('async function meshPongWebSocketStatus()'),
      viteConfig.indexOf("name: 'mesh-pong-websocket-helper'")
    );

    expect(statusSection).toContain('await ensureMeshPongWebSocketServer()');
    expect(statusSection).not.toContain(
      'if (meshPongWebSocketServerFailure && !meshPongWebSocketServer)'
    );
  });

  it('accepts websocket as a real browser transport mode selection', () => {
    expect(resolveBrowserModeSelection('websocket', 'local')).toBe('websocket');
    expect(resolveBrowserModeSelection('mesh', 'local')).toBe('mesh');
    expect(resolveBrowserModeSelection('not-a-mode', 'broadcast')).toBe('broadcast');
  });

  it('returns websocket helper status facts and flushes without throwing on listener-missing states', async () => {
    const responses = [
      new Response(
        JSON.stringify({
          state: 'ready',
          transportUrl: 'ws://127.0.0.1:4102',
          matchAddress: 'actor://pong-server/match-coordinator',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      ),
      new Response(
        JSON.stringify({
          state: 'ready',
          transportUrl: 'ws://127.0.0.1:4102',
          matchAddress: 'actor://pong-server/match-coordinator',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      ),
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      new Response('missing', { status: 404 }),
      new Response(
        JSON.stringify({
          state: 'transport-failed',
          message: 'listener failed to start',
        }),
        {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }
      ),
    ];
    const fetch = vi.fn(async () => {
      const response = responses.shift();
      if (!response) {
        throw new Error('Unexpected Mesh Pong WebSocket helper request.');
      }
      return response;
    });
    const client = createMeshPongWebSocketDevHelperClient({
      baseUrl: 'http://127.0.0.1:4173',
      fetch: fetch as typeof globalThis.fetch,
    });

    await expect(client.getStatus()).resolves.toEqual({
      state: 'ready',
      transportUrl: 'ws://127.0.0.1:4102',
      matchAddress: 'actor://pong-server/match-coordinator',
    });
    await expect(client.getStatus()).resolves.toEqual({
      state: 'ready',
      transportUrl: 'ws://127.0.0.1:4102',
      matchAddress: 'actor://pong-server/match-coordinator',
    });
    await expect(client.flush()).resolves.toBeUndefined();
    await expect(client.getStatus()).resolves.toEqual({
      state: 'listener-missing',
      message: 'Mesh Pong WebSocket listener helper is unavailable.',
      transportUrl: null,
      matchAddress: null,
    });
    await expect(client.getStatus()).resolves.toEqual({
      state: 'transport-failed',
      message: 'listener failed to start',
      transportUrl: null,
      matchAddress: null,
    });
    expect(describeMeshPongWebSocketStatus('connecting')).toBe('connecting');
    expect(describeMeshPongWebSocketStatus('connected')).toBe('connected/lobby');
    expect(describeMeshPongWebSocketStatus('listener-missing')).toBe('listener-missing');
    expect(describeMeshPongWebSocketStatus('transport-failed')).toBe('transport-failed');
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('documents snapshot render cadence and planner decision age semantics', async () => {
    const readme = await readFile(path.resolve(meshPongExamplesDir, 'mesh-pong/README.md'), 'utf8');

    expect(readme).toContain('snapshot render cadence');
    expect(readme).not.toContain('browser paint cadence');
    expect(readme).toContain('High decision `age` includes local model decision time');
    expect(readme).toContain('visible controller mode');
    expect(readme).toMatch(/planner freshness or\s+fallback status/);
    expect(readme).toContain('target/intercept or strategy label');
    expect(readme).toContain('one human side plus one `reflex`, `planner`, or `hybrid` side');
    expect(readme).not.toContain('one human side plus one `mlx` side');
    expect(readme).toMatch(/Local\s+human input is applied immediately in the shell/);
  });

  it('documents a valid planner strategy json contract and keeps it aligned with the controller prompt', async () => {
    const readme = await readFile(path.resolve(meshPongExamplesDir, 'mesh-pong/README.md'), 'utf8');
    const request = createPongControllerRequest(
      'left',
      createStepperSnapshot(
        { left: createInitialPaddle('left'), right: createInitialPaddle('right') },
        0
      )
    );
    const prompt = String(request.messages.at(-1)?.content ?? '');
    const strategyExample = readme.match(/```json\n(\{[\s\S]*?\})\n```/)?.[1];

    expect(strategyExample).toBeDefined();
    expect(() => JSON.parse(strategyExample ?? '')).not.toThrow();
    expect(strategyExample).toContain('"targetY": 139');
    expect(strategyExample).toContain('"biasY": 0');
    expect(strategyExample).toContain('"maxStep": 14');
    expect(strategyExample).toContain('"label": "short reason string"');
    expect(strategyExample).toContain('"facts": ["short fact strings"]');
    expect(readme).toContain('`targetY` accepts values from 0 through 278');
    expect(readme).toMatch(/`biasY` accepts values from -82\s+through 82/);
    expect(readme).toMatch(/`maxStep` accepts values from 1\s+through 28/);
    expect(prompt).toContain('"targetY":"number"');
    expect(prompt).toContain('"biasY":"number"');
    expect(prompt).toContain('"maxStep":"number"');
    expect(prompt).toContain('"label":"string"');
    expect(prompt).toContain('"facts":"string[]"');
  });

  it('produces the same deterministic score sequence for local, broadcast, and websocket runtimes', async () => {
    const broadcastNetwork = new FakeBroadcastChannelNetwork();

    const [local, broadcast, websocket] = await Promise.all([
      captureSequence(() => startMeshPongLocal()),
      captureSequence(() =>
        startMeshPongBroadcast({
          channelName: 'mesh-pong-parity',
          broadcastChannelFactory: broadcastNetwork.create,
          webLocks: new FakeWebLocks(),
        })
      ),
      captureSequence(() => startMeshPongWebSocketLoopback()),
    ]);

    expect(local.length).toBeGreaterThan(0);
    expect(broadcast).toEqual(local);
    expect(websocket).toEqual(local);
  });
});
