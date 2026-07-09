import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ActorAgentLlmProvider,
  type ActorAgentLlmRequest,
  type ActorAgentLlmResult,
  createActorAgentTools,
} from '@actor-web/agent';
import type { ActorMessage, ActorRef } from '@actor-web/runtime';
import type { ActorToolExecutionContext, BroadcastChannelLike } from '@actor-web/runtime/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserMlxLlmProvider,
  resolveBrowserMlxProviderConfig,
  type StorageLike,
} from './mlx-provider';
import { startMeshPongBroadcast } from './modes/broadcast';
import { startMeshPongLocal } from './modes/local';
import { startMeshPongWebSocketLoopback } from './modes/websocket';
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
  PongMatchStartResult,
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
  shouldLaunchPlannerControllerForSide,
  startLobbyMatch,
  syncLobbySession,
  syncLobbySessionsFromStorage,
  toLegacyPongControllerType,
  usesSyntheticControllerSlot,
} from './pong-contract';
import {
  CONTROLLER_LLM_TIMEOUT_MS,
  createPongControllerRequest,
  runPongControllerWithLlmProvider,
} from './pong-controller';
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
  type MeshPongControllerSchedulePolicy,
  type MeshPongTelemetryEvent,
  reduceMeshPongBenchmarkSummary,
  reduceMeshPongTelemetry,
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

const startedRuntimes: StartedMeshPongRuntime[] = [];

interface MeshPongTestRefs {
  readonly ball: ActorRef<PongBallContext, BallCommand>;
  readonly score: ActorRef<PongScoreState, ScoreCommand>;
  readonly paddleA: ActorRef<PongPaddleState, PaddleCommand>;
  readonly paddleB: ActorRef<PongPaddleState, PaddleCommand>;
}

interface MeshPongSessionRefs {
  readonly lobby: ActorRef<PongLobbyState, PongLobbyCommand>;
  readonly sessionA: ActorRef<PongPlayerSessionState, PlayerSessionCommand>;
  readonly sessionB: ActorRef<PongPlayerSessionState, PlayerSessionCommand>;
}

interface MeshPongControllerRefs {
  readonly left: ActorRef<PongControllerActorState, ControllerCommand>;
  readonly right: ActorRef<PongControllerActorState, ControllerCommand>;
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

  await Promise.all(Object.values(runtime.nodes).map((nodeRuntime) => nodeRuntime?.system.flush()));
}

function serverNode(runtime: StartedMeshPongRuntime) {
  if ('server' in runtime) {
    return runtime.server;
  }

  const server = runtime.nodes.server;
  if (!server) {
    throw new Error('Mesh Pong local runtime did not start the server node.');
  }
  return server;
}

async function waitForActor<TContext, TMessage extends ActorMessage>(
  runtime: StartedMeshPongRuntime,
  address: string
): Promise<ActorRef<TContext, TMessage>> {
  const server = serverNode(runtime);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const actorRef = await server.system.lookup<TContext, TMessage>(address);
    if (actorRef) {
      return actorRef;
    }
    await flush(runtime);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error(`Timed out resolving Mesh Pong actor ${address} from the server node.`);
}

async function resolvePongRefs(runtime: StartedMeshPongRuntime): Promise<MeshPongTestRefs> {
  const server = serverNode(runtime);
  return {
    ball: server.requireActor('ball') as ActorRef<PongBallContext, BallCommand>,
    score: server.requireActor('score') as ActorRef<PongScoreState, ScoreCommand>,
    paddleA: await waitForActor<PongPaddleState, PaddleCommand>(
      runtime,
      pong.actors.paddleA.address
    ),
    paddleB: await waitForActor<PongPaddleState, PaddleCommand>(
      runtime,
      pong.actors.paddleB.address
    ),
  };
}

async function createPlayerSession(
  runtime: StartedMeshPongRuntime,
  params: PongPlayerSessionParams
): Promise<ActorRef<PongPlayerSessionState, PlayerSessionCommand>> {
  const server = serverNode(runtime);
  return server.actors.playerSession.instance(params);
}

async function resolveSessionRefs(runtime: StartedMeshPongRuntime): Promise<MeshPongSessionRefs> {
  const server = serverNode(runtime);
  return {
    lobby: server.requireActor('lobby') as ActorRef<PongLobbyState, PongLobbyCommand>,
    sessionA: await createPlayerSession(runtime, { sessionId: 'tab-a' }),
    sessionB: await createPlayerSession(runtime, { sessionId: 'tab-b' }),
  };
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
  const refs = await resolvePongRefs(runtime);
  const ball = await refs.ball.ask<PongBallContext>({ type: 'GET_BALL' });
  const score = await refs.score.ask<PongScoreState>({ type: 'GET_SCORE' });
  const [left, right] = await Promise.all([
    refs.paddleA.ask<PongPaddleState>({ type: 'GET_PADDLE' }),
    refs.paddleB.ask<PongPaddleState>({ type: 'GET_PADDLE' }),
  ]);

  return {
    ball: ball.ball,
    score,
    paddles: { left, right },
  };
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

async function centerPaddles(
  runtime: StartedMeshPongRuntime,
  refs: Pick<MeshPongTestRefs, 'paddleA' | 'paddleB'>
): Promise<void> {
  const centerY = PONG_FIELD.height / 2 - PONG_FIELD.paddleHeight / 2;
  await refs.paddleA.send({ type: 'SET_PADDLE', y: centerY });
  await refs.paddleB.send({ type: 'SET_PADDLE', y: centerY });
  await flush(runtime);
}

async function stepSimulation(
  runtime: StartedMeshPongRuntime,
  refs: MeshPongTestRefs
): Promise<void> {
  await centerPaddles(runtime, refs);

  const [left, right] = await Promise.all([
    refs.paddleA.ask<PongPaddleState>({ type: 'GET_PADDLE' }),
    refs.paddleB.ask<PongPaddleState>({ type: 'GET_PADDLE' }),
  ]);
  await refs.ball.send({ type: 'SET_PADDLES', leftY: left.y, rightY: right.y });
  await refs.ball.send({ type: 'TICK' });
  await flush(runtime);
}

async function driveUntilNextScore(
  runtime: StartedMeshPongRuntime,
  refs: MeshPongTestRefs,
  currentSequenceLength: number
): Promise<PongScoreState> {
  for (let tick = 0; tick < 40; tick += 1) {
    await stepSimulation(runtime, refs);

    const score = await refs.score.ask<PongScoreState>({ type: 'GET_SCORE' });
    if (score.sequence.length > currentSequenceLength) {
      return score;
    }
  }

  throw new Error('Mesh Pong did not score within the expected tick window.');
}

async function runScoreSequence(runtime: StartedMeshPongRuntime): Promise<string[]> {
  const refs = await resolvePongRefs(runtime);

  await refs.ball.send({ type: 'RESET_BALL', seed: DEFAULT_PONG_SEED });
  await refs.score.send({ type: 'RESET_SCORE' });
  await flush(runtime);

  for (let tick = 0; tick < 28; tick += 1) {
    await stepSimulation(runtime, refs);
  }

  const finalScore = await refs.score.ask<PongScoreState>({ type: 'GET_SCORE' });
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
    readonly flushRuntime?: () => Promise<void>;
    readonly runMlxController?: (
      side: PongSide,
      snapshot: PongSnapshot
    ) => Promise<PongControllerResult>;
    readonly onSnapshot?: () => void;
    readonly schedulePolicy?: MeshPongControllerSchedulePolicy;
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
      matchStarted: matchState.started,
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
    runMlxController: options.runMlxController,
    setControllerDiagnostic: () => undefined,
    clearControllerDiagnostic: () => undefined,
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

    expect(sessionA.address).toBe('actor://pong-server/player-session-tab-a');
    expect(sessionB.address).toBe('actor://pong-server/player-session-tab-b');
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
    expect(stepOrder).toEqual([
      'snapshot:0',
      'flush:1',
      'snapshot:1',
      'snapshot:1',
      'flush:2',
      'snapshot:2',
    ]);
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

  it('uses the shell MLX runner when present instead of blocking browser controller actors', async () => {
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

    expect(runMlxController).toHaveBeenCalled();
    expect(harness.leftAskCount()).toBe(0);
    expect(harness.rightAskCount()).toBe(0);
    expect(harness.commands).toContain('left:MOVE_PADDLE');
    expect(harness.commands).toContain('right:MOVE_PADDLE');
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

  it('keeps the score actor as the only source of scoreboard totals', async () => {
    const runtime = await startMeshPongLocal();
    startedRuntimes.push(runtime);
    const refs = await resolvePongRefs(runtime);

    await refs.ball.send({ type: 'RESET_BALL', seed: DEFAULT_PONG_SEED });
    await refs.score.send({ type: 'RESET_SCORE' });
    await flush(runtime);

    const firstScore = await driveUntilNextScore(runtime, refs, 0);
    await refs.ball.send({ type: 'RESET_BALL', seed: DEFAULT_PONG_SEED });
    await flush(runtime);

    const secondScore = await driveUntilNextScore(runtime, refs, firstScore.sequence.length);
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
      })
    ).rejects.toThrow('broadcast channel setup failed');

    expect(broadcastNetwork.size()).toBe(0);
  });

  it('keeps the browser proof panel tied to shared behavior and mode-only startup files', () => {
    expect(MESH_PONG_SHARED_PARITY_PROOF).toMatchObject({
      topologyFile: 'pong-topology.ts',
      behaviorFile: 'pong-behaviors.ts',
      validationGate: 'mesh-pong.test.ts: local = broadcast = websocket',
    });
    expect(MESH_PONG_SHARED_PARITY_PROOF.actors).toEqual(['ball', 'score', 'paddleA', 'paddleB']);

    expect(Object.keys(MESH_PONG_MODE_PARITY_PROOF).sort()).toEqual(['broadcast', 'local', 'mesh']);

    for (const [mode, proof] of Object.entries(MESH_PONG_MODE_PARITY_PROOF)) {
      expect(proof).toBe(parityProofForMode(mode as keyof typeof MESH_PONG_MODE_PARITY_PROOF));
      expect(proof.startupFile).toBe(`modes/${mode}.ts`);
      expect(proof.nodeLayout).toBe('server / a / b');
    }
  });

  it('keeps the Mesh Pong browser entry on the browser-safe agent/runtime boundary', async () => {
    const agentEntrypoint = await readFile(
      path.resolve(meshPongExamplesDir, '../packages/actor-agent/src/index.ts'),
      'utf8'
    );

    expect(agentEntrypoint).toContain("from '@actor-web/runtime/browser'");
    expect(agentEntrypoint).not.toContain("import { defineBehavior } from '@actor-web/runtime';");
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
    expect(uiEntrypoint).toContain('channelName: `mesh-pong-demo-$' + '{createSessionId()}`');
    expect(uiEntrypoint).not.toContain('channelName: `mesh-pong-demo-$' + '{crypto.randomUUID()}`');
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
    expect(uiEntrypoint).toContain(
      'await hydrateCurrentSession(nextRuntime, nextRefs, {\n      shouldApply: () => switchGeneration === generation,\n    });'
    );
    expect(uiEntrypoint).toContain('() => isCurrentRuntimeContext(currentRuntime, currentRefs)');
    expect(uiEntrypoint).toContain('if (!isCurrentRuntimeContext(currentRuntime, currentRefs))');
    expect(uiEntrypoint).toContain('renderLobby(lobbyState);');
    expect(uiEntrypoint).toContain("lobbyChannel?.postMessage({\n      type: 'match-started'");
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

  it('documents the planner strategy json contract and keeps it aligned with the controller prompt', async () => {
    const readme = await readFile(path.resolve(meshPongExamplesDir, 'mesh-pong/README.md'), 'utf8');
    const request = createPongControllerRequest(
      'left',
      createStepperSnapshot(
        { left: createInitialPaddle('left'), right: createInitialPaddle('right') },
        0
      )
    );
    const prompt = String(request.messages.at(-1)?.content ?? '');

    expect(readme).toContain('"targetY": 0..278');
    expect(readme).toContain('"biasY": -82..82');
    expect(readme).toContain('"maxStep": 1..28');
    expect(readme).toContain('"label": "short reason string"');
    expect(readme).toContain('"facts": ["short fact strings"]');
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
        })
      ),
      captureSequence(() => startMeshPongWebSocketLoopback()),
    ]);

    expect(local.length).toBeGreaterThan(0);
    expect(broadcast).toEqual(local);
    expect(websocket).toEqual(local);
  });
});
