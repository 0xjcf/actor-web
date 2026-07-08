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

export interface MeshPongTelemetryControllerState {
  readonly inFlight: boolean;
  readonly startedAtMs: number | null;
  readonly rttMs: number | null;
  readonly outcome: 'idle' | 'pending' | 'ready' | 'applied' | 'error';
  readonly error: string | null;
  readonly lastAppliedIntentAtMs: number | null;
  readonly lastAppliedIntentAgeMs: number | null;
}

export interface MeshPongTelemetryState {
  readonly createdAtMs: number;
  readonly render: {
    readonly count: number;
    readonly lastAtMs: number | null;
    readonly lastGapMs: number | null;
  };
  readonly simulation: {
    readonly targetIntervalMs: number;
    readonly scheduledCount: number;
    readonly appliedCount: number;
    readonly heldCount: number;
    readonly droppedCount: number;
    readonly lastScheduledAtMs: number | null;
    readonly lastScheduledGapMs: number | null;
    readonly lastAppliedAtMs: number | null;
    readonly lastAppliedGapMs: number | null;
  };
  readonly controllers: Record<PongSide, MeshPongTelemetryControllerState>;
  readonly replay: {
    readonly originSessionId: string | null;
    readonly sentAtMs: number | null;
    readonly receivedAtMs: number | null;
    readonly latencyMs: number | null;
  };
}

export interface MeshPongBenchmarkSummaryState {
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly lastScheduledAtMs: number | null;
  readonly controllerRequestStartedAtMs: Record<PongSide, number | null>;
  readonly controllers: {
    readonly startedCount: number;
    readonly finishedCount: number;
    readonly timeoutCount: number;
    readonly latency: {
      readonly count: number;
      readonly totalMs: number;
      readonly minMs: number | null;
      readonly maxMs: number | null;
      readonly averageMs: number | null;
    };
    readonly throughputPerSec: number;
  };
  readonly simulation: {
    readonly targetIntervalMs: number;
    readonly scheduledCount: number;
    readonly appliedCount: number;
    readonly heldCount: number;
    readonly droppedCount: number;
    readonly appliedPerSec: number;
  };
  readonly timeoutRate: number;
  readonly gameplayEffect: 'stalled' | 'timeout-bound' | 'laggy' | 'smooth';
}

export type MeshPongTelemetryEvent =
  | { readonly type: 'rendered'; readonly nowMs: number }
  | { readonly type: 'simulation-scheduled'; readonly nowMs: number }
  | { readonly type: 'simulation-held'; readonly nowMs: number }
  | { readonly type: 'simulation-applied'; readonly nowMs: number }
  | {
      readonly type: 'controller-request-started';
      readonly side: PongSide;
      readonly nowMs: number;
    }
  | {
      readonly type: 'controller-request-finished';
      readonly side: PongSide;
      readonly nowMs: number;
      readonly outcome: 'ready' | 'error';
      readonly error?: string;
    }
  | {
      readonly type: 'controller-intent-applied';
      readonly side: PongSide;
      readonly nowMs: number;
      readonly sentAtMs?: number;
    }
  | {
      readonly type: 'replay-sent';
      readonly originSessionId: string;
      readonly sentAtMs: number;
    }
  | {
      readonly type: 'replay-received';
      readonly originSessionId: string;
      readonly sentAtMs: number;
      readonly receivedAtMs: number;
    };

export interface MeshPongTelemetryDisplay {
  readonly render: string;
  readonly simulation: string;
  readonly leftController: string;
  readonly rightController: string;
  readonly replay: string;
}

export interface MeshPongClock {
  readonly nowMs: () => number;
  readonly nowEpochMs: () => number;
}

export interface MeshPongClockSource {
  readonly timeOrigin?: number;
  readonly now: () => number;
}

export interface MeshPongControllerSchedulePolicy {
  readonly simulationIntervalMs: number;
  readonly controllerAskTimeoutMs: number;
  readonly staleIntentTurnLimit: number;
}

export const DEFAULT_MESH_PONG_CONTROLLER_SCHEDULE_POLICY: MeshPongControllerSchedulePolicy = {
  simulationIntervalMs: 90,
  controllerAskTimeoutMs: 30_000,
  staleIntentTurnLimit: 3,
};

function defaultClockSource(): MeshPongClockSource | undefined {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance
    : undefined;
}

export function createMeshPongClock(source = defaultClockSource()): MeshPongClock {
  return {
    nowMs: () => source?.now() ?? Date.now(),
    nowEpochMs: () => {
      if (source && typeof source.timeOrigin === 'number') {
        return source.timeOrigin + source.now();
      }
      return Date.now();
    },
  };
}

function createTelemetryControllerState(): MeshPongTelemetryControllerState {
  return {
    inFlight: false,
    startedAtMs: null,
    rttMs: null,
    outcome: 'idle',
    error: null,
    lastAppliedIntentAtMs: null,
    lastAppliedIntentAgeMs: null,
  };
}

export function createMeshPongTelemetryState(nowMs: number): MeshPongTelemetryState {
  return {
    createdAtMs: nowMs,
    render: {
      count: 0,
      lastAtMs: null,
      lastGapMs: null,
    },
    simulation: {
      targetIntervalMs: DEFAULT_MESH_PONG_CONTROLLER_SCHEDULE_POLICY.simulationIntervalMs,
      scheduledCount: 0,
      appliedCount: 0,
      heldCount: 0,
      droppedCount: 0,
      lastScheduledAtMs: null,
      lastScheduledGapMs: null,
      lastAppliedAtMs: null,
      lastAppliedGapMs: null,
    },
    controllers: {
      left: createTelemetryControllerState(),
      right: createTelemetryControllerState(),
    },
    replay: {
      originSessionId: null,
      sentAtMs: null,
      receivedAtMs: null,
      latencyMs: null,
    },
  };
}

export function createMeshPongBenchmarkSummaryState(nowMs: number): MeshPongBenchmarkSummaryState {
  return {
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    lastScheduledAtMs: null,
    controllerRequestStartedAtMs: {
      left: null,
      right: null,
    },
    controllers: {
      startedCount: 0,
      finishedCount: 0,
      timeoutCount: 0,
      latency: {
        count: 0,
        totalMs: 0,
        minMs: null,
        maxMs: null,
        averageMs: null,
      },
      throughputPerSec: 0,
    },
    simulation: {
      targetIntervalMs: DEFAULT_MESH_PONG_CONTROLLER_SCHEDULE_POLICY.simulationIntervalMs,
      scheduledCount: 0,
      appliedCount: 0,
      heldCount: 0,
      droppedCount: 0,
      appliedPerSec: 0,
    },
    timeoutRate: 0,
    gameplayEffect: 'stalled',
  };
}

function measureGap(previousAtMs: number | null, nowMs: number): number | null {
  if (previousAtMs === null) {
    return null;
  }
  return Math.max(0, nowMs - previousAtMs);
}

function droppedTurnCount(targetIntervalMs: number, gapMs: number | null): number {
  if (gapMs === null) {
    return 0;
  }
  return Math.max(0, Math.floor(gapMs / targetIntervalMs) - 1);
}

function isTimeoutError(error: string | undefined): boolean {
  if (!error) {
    return false;
  }
  return error.includes('timeout') || error.includes('timed out');
}

function eventTimestamp(event: MeshPongTelemetryEvent): number {
  switch (event.type) {
    case 'rendered':
    case 'simulation-scheduled':
    case 'simulation-held':
    case 'simulation-applied':
    case 'controller-request-started':
    case 'controller-request-finished':
      return event.nowMs;
    case 'controller-intent-applied':
      return event.nowMs;
    case 'replay-sent':
      return event.sentAtMs;
    case 'replay-received':
      return event.receivedAtMs;
  }
}

function deriveBenchmarkSummary(
  state: Omit<
    MeshPongBenchmarkSummaryState,
    'controllers' | 'simulation' | 'timeoutRate' | 'gameplayEffect'
  > & {
    readonly controllers: Omit<
      MeshPongBenchmarkSummaryState['controllers'],
      'throughputPerSec' | 'latency'
    > & {
      readonly latency: Omit<MeshPongBenchmarkSummaryState['controllers']['latency'], 'averageMs'>;
    };
    readonly simulation: Omit<MeshPongBenchmarkSummaryState['simulation'], 'appliedPerSec'>;
  }
): MeshPongBenchmarkSummaryState {
  const elapsedMs = Math.max(0, state.updatedAtMs - state.createdAtMs);
  const elapsedSeconds = elapsedMs === 0 ? 0 : elapsedMs / 1000;
  const averageLatencyMs =
    state.controllers.latency.count === 0
      ? null
      : state.controllers.latency.totalMs / state.controllers.latency.count;
  const controllerThroughputPerSec =
    elapsedSeconds === 0 ? 0 : state.controllers.finishedCount / elapsedSeconds;
  const appliedPerSec = elapsedSeconds === 0 ? 0 : state.simulation.appliedCount / elapsedSeconds;
  const timeoutRate =
    state.controllers.finishedCount === 0
      ? 0
      : state.controllers.timeoutCount / state.controllers.finishedCount;
  const gameplayEffect =
    state.controllers.finishedCount === 0 || state.simulation.appliedCount === 0
      ? 'stalled'
      : timeoutRate >= 0.5
        ? 'timeout-bound'
        : (averageLatencyMs !== null && averageLatencyMs > state.simulation.targetIntervalMs) ||
            state.simulation.heldCount > 0 ||
            state.simulation.droppedCount > 0
          ? 'laggy'
          : 'smooth';

  return {
    ...state,
    controllers: {
      ...state.controllers,
      latency: {
        ...state.controllers.latency,
        averageMs: averageLatencyMs,
      },
      throughputPerSec: controllerThroughputPerSec,
    },
    simulation: {
      ...state.simulation,
      appliedPerSec,
    },
    timeoutRate,
    gameplayEffect,
  };
}

export function reduceMeshPongBenchmarkSummary(
  state: MeshPongBenchmarkSummaryState,
  event: MeshPongTelemetryEvent
): MeshPongBenchmarkSummaryState {
  switch (event.type) {
    case 'simulation-scheduled': {
      const gapMs = measureGap(state.lastScheduledAtMs, event.nowMs);
      return deriveBenchmarkSummary({
        ...state,
        updatedAtMs: event.nowMs,
        lastScheduledAtMs: event.nowMs,
        simulation: {
          ...state.simulation,
          scheduledCount: state.simulation.scheduledCount + 1,
          droppedCount:
            state.simulation.droppedCount +
            droppedTurnCount(state.simulation.targetIntervalMs, gapMs),
        },
      });
    }
    case 'simulation-held': {
      return deriveBenchmarkSummary({
        ...state,
        updatedAtMs: event.nowMs,
        simulation: {
          ...state.simulation,
          heldCount: state.simulation.heldCount + 1,
        },
      });
    }
    case 'simulation-applied': {
      return deriveBenchmarkSummary({
        ...state,
        updatedAtMs: event.nowMs,
        simulation: {
          ...state.simulation,
          appliedCount: state.simulation.appliedCount + 1,
        },
      });
    }
    case 'controller-request-started': {
      return deriveBenchmarkSummary({
        ...state,
        updatedAtMs: event.nowMs,
        controllerRequestStartedAtMs: {
          ...state.controllerRequestStartedAtMs,
          [event.side]: event.nowMs,
        },
        controllers: {
          ...state.controllers,
          startedCount: state.controllers.startedCount + 1,
        },
      });
    }
    case 'controller-request-finished': {
      const startedAtMs = state.controllerRequestStartedAtMs[event.side];
      const latencyMs = startedAtMs === null ? 0 : Math.max(0, event.nowMs - startedAtMs);
      const latencyCount = state.controllers.latency.count + 1;
      const latencyTotalMs = state.controllers.latency.totalMs + latencyMs;
      return deriveBenchmarkSummary({
        ...state,
        updatedAtMs: event.nowMs,
        controllerRequestStartedAtMs: {
          ...state.controllerRequestStartedAtMs,
          [event.side]: null,
        },
        controllers: {
          ...state.controllers,
          finishedCount: state.controllers.finishedCount + 1,
          timeoutCount: state.controllers.timeoutCount + (isTimeoutError(event.error) ? 1 : 0),
          latency: {
            count: latencyCount,
            totalMs: latencyTotalMs,
            minMs:
              state.controllers.latency.minMs === null
                ? latencyMs
                : Math.min(state.controllers.latency.minMs, latencyMs),
            maxMs:
              state.controllers.latency.maxMs === null
                ? latencyMs
                : Math.max(state.controllers.latency.maxMs, latencyMs),
          },
        },
      });
    }
    case 'controller-intent-applied':
    case 'replay-sent':
    case 'replay-received': {
      return state;
    }
    default: {
      return deriveBenchmarkSummary({
        ...state,
        updatedAtMs: eventTimestamp(event),
      });
    }
  }
}

export function reduceMeshPongTelemetry(
  state: MeshPongTelemetryState,
  event: MeshPongTelemetryEvent
): MeshPongTelemetryState {
  switch (event.type) {
    case 'rendered': {
      return {
        ...state,
        render: {
          count: state.render.count + 1,
          lastAtMs: event.nowMs,
          lastGapMs: measureGap(state.render.lastAtMs, event.nowMs),
        },
      };
    }
    case 'simulation-scheduled': {
      const gapMs = measureGap(state.simulation.lastScheduledAtMs, event.nowMs);
      return {
        ...state,
        simulation: {
          ...state.simulation,
          scheduledCount: state.simulation.scheduledCount + 1,
          droppedCount:
            state.simulation.droppedCount +
            droppedTurnCount(state.simulation.targetIntervalMs, gapMs),
          lastScheduledAtMs: event.nowMs,
          lastScheduledGapMs: gapMs,
        },
      };
    }
    case 'simulation-held': {
      return {
        ...state,
        simulation: {
          ...state.simulation,
          heldCount: state.simulation.heldCount + 1,
        },
      };
    }
    case 'simulation-applied': {
      return {
        ...state,
        simulation: {
          ...state.simulation,
          appliedCount: state.simulation.appliedCount + 1,
          lastAppliedAtMs: event.nowMs,
          lastAppliedGapMs: measureGap(state.simulation.lastAppliedAtMs, event.nowMs),
        },
      };
    }
    case 'controller-request-started': {
      return {
        ...state,
        controllers: {
          ...state.controllers,
          [event.side]: {
            ...state.controllers[event.side],
            inFlight: true,
            startedAtMs: event.nowMs,
            outcome: 'pending',
            error: null,
          },
        },
      };
    }
    case 'controller-request-finished': {
      const controller = state.controllers[event.side];
      return {
        ...state,
        controllers: {
          ...state.controllers,
          [event.side]: {
            ...controller,
            inFlight: false,
            rttMs:
              controller.startedAtMs === null
                ? null
                : Math.max(0, event.nowMs - controller.startedAtMs),
            outcome: event.outcome,
            error: event.error ?? null,
          },
        },
      };
    }
    case 'controller-intent-applied': {
      return {
        ...state,
        controllers: {
          ...state.controllers,
          [event.side]: {
            ...state.controllers[event.side],
            lastAppliedIntentAtMs: event.nowMs,
            lastAppliedIntentAgeMs:
              event.sentAtMs === undefined ? 0 : Math.max(0, event.nowMs - event.sentAtMs),
            outcome: 'applied',
            error: null,
          },
        },
      };
    }
    case 'replay-sent': {
      return {
        ...state,
        replay: {
          originSessionId: event.originSessionId,
          sentAtMs: event.sentAtMs,
          receivedAtMs: null,
          latencyMs: null,
        },
      };
    }
    case 'replay-received': {
      return {
        ...state,
        replay: {
          originSessionId: event.originSessionId,
          sentAtMs: event.sentAtMs,
          receivedAtMs: event.receivedAtMs,
          latencyMs: Math.max(0, event.receivedAtMs - event.sentAtMs),
        },
      };
    }
  }
}

function formatMs(value: number | null): string {
  return value === null ? '--' : `${Math.round(value)}ms`;
}

function formatControllerTelemetry(state: MeshPongTelemetryControllerState): string {
  const status = state.inFlight ? 'in-flight' : state.outcome;
  const error = state.error ? ` err ${state.error}` : '';
  return `state ${status} rtt ${formatMs(state.rttMs)} age ${formatMs(state.lastAppliedIntentAgeMs)}${error}`;
}

function formatRate(value: number): string {
  return `${value.toFixed(2)}/s`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatMeshPongBenchmarkSummary(state: MeshPongBenchmarkSummaryState): string {
  return `ctrl ${state.controllers.startedCount}/${state.controllers.finishedCount} timeouts ${state.controllers.timeoutCount} latency avg ${formatMs(state.controllers.latency.averageMs)} min ${formatMs(state.controllers.latency.minMs)} max ${formatMs(state.controllers.latency.maxMs)} thr ${formatRate(state.controllers.throughputPerSec)} sim sched ${state.simulation.scheduledCount} applied ${state.simulation.appliedCount} held ${state.simulation.heldCount} dropped ${state.simulation.droppedCount} apply ${formatRate(state.simulation.appliedPerSec)} timeout ${formatPercent(state.timeoutRate)} effect ${state.gameplayEffect}`;
}

export function formatMeshPongTelemetry(state: MeshPongTelemetryState): MeshPongTelemetryDisplay {
  return {
    render: `${state.render.count} frames gap ${formatMs(state.render.lastGapMs)}`,
    simulation: `${state.simulation.targetIntervalMs}ms sched ${state.simulation.scheduledCount} applied ${state.simulation.appliedCount} held ${state.simulation.heldCount} dropped ${state.simulation.droppedCount} sgap ${formatMs(state.simulation.lastScheduledGapMs)} agap ${formatMs(state.simulation.lastAppliedGapMs)}`,
    leftController: formatControllerTelemetry(state.controllers.left),
    rightController: formatControllerTelemetry(state.controllers.right),
    replay:
      state.replay.originSessionId === null
        ? 'idle'
        : `${state.replay.originSessionId.slice(0, 8)} latency ${formatMs(state.replay.latencyMs)}`,
  };
}

type TelemetryValueElements = Record<keyof MeshPongTelemetryDisplay, HTMLElement> & {
  readonly benchmark: HTMLElement;
};

type LobbyReplayMetadata = {
  readonly originSessionId: string;
  readonly sentAtMs: number;
};

type LobbyChannelMessage =
  | { readonly type: 'sessions-updated' }
  | {
      readonly type: 'controller-input';
      readonly input: Extract<PongControllerInputResult, { readonly ok: true }>;
      readonly replay?: LobbyReplayMetadata;
    }
  | {
      readonly type: 'match-started';
      readonly mode: PongMatchMode;
      readonly ownerSessionId: string;
    };

type MlxControllerRequest = {
  readonly requestId: number;
  readonly runtime: BrowserRuntime;
  readonly refs: RuntimeRefs;
  readonly side: PongSide;
  readonly controller: ActorRef<PongControllerActorState, ControllerCommand>;
  readonly snapshot: PongSnapshot;
  readonly matchGeneration: number;
  readonly startedAtMs: number;
};

type ResolvedMlxIntent = {
  readonly requestId: number;
  readonly matchGeneration: number;
  readonly input: Extract<PongControllerInputResult, { readonly ok: true }>;
  readonly sentAtMs: number;
};

type MlxControllerLaneState = {
  inFlight: MlxControllerRequest | null;
  readyIntent: ResolvedMlxIntent | null;
  lastIntent: Extract<PongControllerInputResult, { readonly ok: true }> | null;
  lastIntentSentAtMs: number | null;
  staleTurnsRemaining: number;
};

export interface MeshPongTurnMatchState {
  readonly matchStarted: boolean;
  readonly matchGeneration: number;
  readonly matchOwnerSessionId: string | null;
  readonly mode: PongMatchMode | null;
}

export interface MeshPongTurnStepperDeps {
  readonly runtime: BrowserRuntime;
  readonly refs: RuntimeRefs;
  readonly browserSessionId: string;
  readonly getMatchState: () => MeshPongTurnMatchState;
  readonly nowMs: () => number;
  readonly schedulePolicy?: MeshPongControllerSchedulePolicy;
  readonly flushRuntime: (runtime: BrowserRuntime) => Promise<void>;
  readonly snapshot: () => Promise<PongSnapshot>;
  readonly renderSnapshot: (snapshot: PongSnapshot) => void;
  readonly setStatus: (status: string) => void;
  readonly updateTelemetry: (event: MeshPongTelemetryEvent) => void;
  readonly postControllerInput: (
    input: Extract<PongControllerInputResult, { readonly ok: true }>
  ) => void;
  readonly setControllerDiagnostic: (side: PongSide, reason: string) => void;
  readonly clearControllerDiagnostic: (side: PongSide) => void;
  readonly applyHumanInput?: (mode: PongMatchMode | null) => Promise<void>;
}

export interface MeshPongTurnStepper {
  tick(): Promise<void>;
  stop(): void;
}

const SESSION_ID_STORAGE_KEY = 'actor-web.mesh-pong.session-id';
const LOBBY_STORAGE_KEY = 'actor-web.mesh-pong.sessions';
const LOBBY_CHANNEL_NAME = 'actor-web.mesh-pong.lobby';

let canvasElement: HTMLCanvasElement;
let modeSelectElement: HTMLSelectElement;
let playerCountSelectElement: HTMLSelectElement;
let leftControllerSelectElement: HTMLSelectElement;
let rightControllerSelectElement: HTMLSelectElement;
let claimLeftButtonElement: HTMLButtonElement;
let claimRightButtonElement: HTMLButtonElement;
let readyButtonElement: HTMLButtonElement;
let startButtonElement: HTMLButtonElement;
let resetButtonElement: HTMLButtonElement;
let modeValueElement: HTMLElement;
let scoreValueElement: HTMLElement;
let statusValueElement: HTMLElement;
let sessionValueElement: HTMLElement;
let sideValueElement: HTMLElement;
let lobbyValueElement: HTMLElement;
let proofTopologyElement: HTMLElement;
let proofBehaviorsElement: HTMLElement;
let proofActorsElement: HTMLElement;
let proofGateElement: HTMLElement;
let proofStartupElement: HTMLElement;
let proofCallElement: HTMLElement;
let proofTransportElement: HTMLElement;
let proofNodesElement: HTMLElement;
let telemetryValues: TelemetryValueElements;
let uiBootstrapped = false;

let runtime: BrowserRuntime | null = null;
let refs: RuntimeRefs | null = null;
let selectedMode: BrowserMode = 'local';
let loopHandle: number | null = null;
let switchGeneration = 0;
let playerSessionState: PongPlayerSessionState | null = null;
let matchStarted = false;
let matchOwnerSessionId: string | null = null;
let matchGeneration = 0;
let matchMode: PongMatchMode | null = null;
const keys = new Set<string>();
let lifecycleStatus = 'idle';
const controllerDiagnostics: Partial<Record<PongSide, string>> = {};
let telemetryState = createMeshPongTelemetryState(0);
let benchmarkSummaryState = createMeshPongBenchmarkSummaryState(0);
let turnStepper: MeshPongTurnStepper | null = null;

const lobbyChannel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(LOBBY_CHANNEL_NAME);
const meshPongClock = createMeshPongClock();

function nowMs(): number {
  return meshPongClock.nowMs();
}

function nowEpochMs(): number {
  return meshPongClock.nowEpochMs();
}

function resetTelemetry(): void {
  telemetryState = createMeshPongTelemetryState(nowMs());
  benchmarkSummaryState = createMeshPongBenchmarkSummaryState(telemetryState.createdAtMs);
  renderTelemetry();
}

function updateTelemetry(event: MeshPongTelemetryEvent): void {
  telemetryState = reduceMeshPongTelemetry(telemetryState, event);
  benchmarkSummaryState = reduceMeshPongBenchmarkSummary(benchmarkSummaryState, event);
  renderTelemetry();
}

function renderTelemetry(): void {
  if (!uiBootstrapped) {
    return;
  }
  const formatted = formatMeshPongTelemetry(telemetryState);
  telemetryValues.render.textContent = formatted.render;
  telemetryValues.simulation.textContent = formatted.simulation;
  telemetryValues.leftController.textContent = formatted.leftController;
  telemetryValues.rightController.textContent = formatted.rightController;
  telemetryValues.replay.textContent = formatted.replay;
  telemetryValues.benchmark.textContent = formatMeshPongBenchmarkSummary(benchmarkSummaryState);
}

function queryRequired<T extends Element>(documentRef: Document, selector: string): T {
  const element = documentRef.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Mesh Pong UI failed to bind required DOM node: ${selector}`);
  }
  return element;
}

function appendTelemetryStat(
  documentRef: Document,
  panelElement: HTMLElement,
  label: string
): HTMLElement {
  const stat = documentRef.createElement('div');
  stat.className = 'stat';
  const labelElement = documentRef.createElement('span');
  labelElement.className = 'label';
  labelElement.textContent = label;
  const valueElement = documentRef.createElement('span');
  valueElement.className = 'value';
  valueElement.textContent = '--';
  stat.append(labelElement, valueElement);
  panelElement.append(stat);
  return valueElement;
}

function bindTelemetryPanel(documentRef: Document): TelemetryValueElements {
  const panelElement = queryRequired<HTMLElement>(documentRef, '.panel');
  return {
    render: appendTelemetryStat(documentRef, panelElement, 'Render'),
    simulation: appendTelemetryStat(documentRef, panelElement, 'Simulation'),
    leftController: appendTelemetryStat(documentRef, panelElement, 'Left control'),
    rightController: appendTelemetryStat(documentRef, panelElement, 'Right control'),
    replay: appendTelemetryStat(documentRef, panelElement, 'Replay'),
    benchmark: appendTelemetryStat(documentRef, panelElement, 'Benchmark'),
  };
}

function formatMlxControllerError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('timed out') ? 'controller-timeout' : message;
}

function formatControllerFailureTelemetryError(
  result: Extract<PongControllerResult, { readonly ok: false }>
): string {
  return `${result.reason} ${result.error.code}: ${result.error.message}`;
}

function stopTurnStepper(): void {
  turnStepper?.stop();
  turnStepper = null;
}

function clearMatchOwner(): void {
  matchOwnerSessionId = null;
  matchMode = null;
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
  readyButtonElement.textContent = session?.ready ? 'Ready' : 'Mark ready';
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
  updateTelemetry({ type: 'rendered', nowMs: nowMs() });
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
  stopTurnStepper();
  clearControllerDiagnostics();
  resetTelemetry();

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
    const activeRuntime = nextRuntime;
    turnStepper = createMeshPongTurnStepper({
      runtime: activeRuntime,
      refs: nextRefs,
      browserSessionId,
      getMatchState: () => ({
        matchStarted,
        matchGeneration,
        matchOwnerSessionId,
        mode: matchMode,
      }),
      nowMs,
      flushRuntime,
      snapshot: () => snapshot(nextRefs),
      renderSnapshot,
      setStatus,
      updateTelemetry,
      postControllerInput,
      setControllerDiagnostic,
      clearControllerDiagnostic,
      applyHumanInput: (mode) => applyPaddleInput(activeRuntime, nextRefs, mode),
    });
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

function postControllerInput(
  input: Extract<PongControllerInputResult, { readonly ok: true }>
): void {
  const sentAtMs = nowEpochMs();
  updateTelemetry({
    type: 'replay-sent',
    originSessionId: browserSessionId,
    sentAtMs,
  });
  lobbyChannel?.postMessage({
    type: 'controller-input',
    input,
    replay: {
      originSessionId: browserSessionId,
      sentAtMs,
    },
  } satisfies LobbyChannelMessage);
}

async function applyControllerInput(
  nextRuntime: BrowserRuntime,
  nextRefs: RuntimeRefs,
  input: Extract<PongControllerInputResult, { readonly ok: true }>,
  metadata?: {
    readonly appliedAtMs?: number;
    readonly flushRuntime?: (runtime: BrowserRuntime) => Promise<void>;
    readonly sentAtMs?: number;
    readonly updateTelemetry?: (event: MeshPongTelemetryEvent) => void;
  }
): Promise<void> {
  const appliedAtMs = metadata?.appliedAtMs ?? nowMs();
  const paddle = input.side === 'left' ? nextRefs.paddleA : nextRefs.paddleB;
  await paddle.send({
    type: 'MOVE_PADDLE',
    direction: input.direction,
    amount: input.amount,
  });
  const flush = metadata?.flushRuntime ?? flushRuntime;
  await flush(nextRuntime);
  const reportTelemetry = metadata?.updateTelemetry ?? updateTelemetry;
  reportTelemetry({
    type: 'controller-intent-applied',
    side: input.side,
    nowMs: appliedAtMs,
    sentAtMs: metadata?.sentAtMs,
  });
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

  const appliedAtMs = nowMs();
  await applyControllerInput(nextRuntime, nextRefs, input, { appliedAtMs });
  postControllerInput(input);
}

function createEmptyMlxLaneState(): MlxControllerLaneState {
  return {
    inFlight: null,
    readyIntent: null,
    lastIntent: null,
    lastIntentSentAtMs: null,
    staleTurnsRemaining: 0,
  };
}

export function createMeshPongTurnStepper(deps: MeshPongTurnStepperDeps): MeshPongTurnStepper {
  const schedulePolicy = deps.schedulePolicy ?? DEFAULT_MESH_PONG_CONTROLLER_SCHEDULE_POLICY;
  const lanes: Record<PongSide, MlxControllerLaneState> = {
    left: createEmptyMlxLaneState(),
    right: createEmptyMlxLaneState(),
  };
  let active = true;
  let nextRequestId = 1;
  let lastMatchGeneration: number | null = null;

  function resetLane(side: PongSide): void {
    lanes[side] = createEmptyMlxLaneState();
  }

  function ownsRequest(request: MlxControllerRequest): boolean {
    const matchState = deps.getMatchState();
    return (
      active &&
      deps.runtime === request.runtime &&
      deps.refs === request.refs &&
      matchState.matchStarted &&
      matchState.matchGeneration === request.matchGeneration &&
      shouldLaunchMlxControllerForSide({
        browserSessionId: deps.browserSessionId,
        matchOwnerSessionId: matchState.matchOwnerSessionId,
        mode: matchState.mode,
        side: request.side,
      })
    );
  }

  function syncLanes(matchState: MeshPongTurnMatchState): void {
    if (lastMatchGeneration !== matchState.matchGeneration) {
      resetLane('left');
      resetLane('right');
      lastMatchGeneration = matchState.matchGeneration;
      return;
    }

    for (const side of ['left', 'right'] as const) {
      if (
        !shouldLaunchMlxControllerForSide({
          browserSessionId: deps.browserSessionId,
          matchOwnerSessionId: matchState.matchOwnerSessionId,
          mode: matchState.mode,
          side,
        })
      ) {
        resetLane(side);
      }
    }
  }

  async function resolveMlxControllerInput(request: MlxControllerRequest): Promise<void> {
    const lane = lanes[request.side];
    try {
      const result = await request.controller.ask<PongControllerResult>(
        {
          type: 'RUN_CONTROLLER',
          snapshot: request.snapshot,
        },
        schedulePolicy.controllerAskTimeoutMs
      );
      if (!ownsRequest(request)) {
        return;
      }
      if (!result.ok) {
        deps.updateTelemetry({
          type: 'controller-request-finished',
          side: result.side,
          nowMs: deps.nowMs(),
          outcome: 'error',
          error: formatControllerFailureTelemetryError(result),
        });
        deps.setControllerDiagnostic(result.side, result.reason);
        return;
      }

      if (lane.inFlight?.requestId !== request.requestId) {
        return;
      }

      deps.clearControllerDiagnostic(result.side);
      lane.readyIntent = {
        requestId: request.requestId,
        matchGeneration: request.matchGeneration,
        input: createSyntheticMlxControllerInput(result),
        sentAtMs: request.startedAtMs,
      };
      deps.updateTelemetry({
        type: 'controller-request-finished',
        side: result.side,
        nowMs: deps.nowMs(),
        outcome: 'ready',
      });
    } catch (error) {
      const errorReason = formatMlxControllerError(error);
      if (!ownsRequest(request)) {
        return;
      }
      deps.updateTelemetry({
        type: 'controller-request-finished',
        side: request.side,
        nowMs: deps.nowMs(),
        outcome: 'error',
        error: errorReason,
      });
      deps.setControllerDiagnostic(request.side, errorReason);
    } finally {
      if (lane.inFlight?.requestId === request.requestId) {
        lane.inFlight = null;
      }
    }
  }

  function launchMlxControllerInput(
    side: PongSide,
    controller: ActorRef<PongControllerActorState, ControllerCommand>,
    snapshotState: PongSnapshot,
    matchGenerationValue: number
  ): void {
    const lane = lanes[side];
    if (lane.inFlight) {
      return;
    }

    const startedAtMs = deps.nowMs();
    deps.updateTelemetry({ type: 'controller-request-started', side, nowMs: startedAtMs });
    const request: MlxControllerRequest = {
      requestId: nextRequestId,
      runtime: deps.runtime,
      refs: deps.refs,
      side,
      controller,
      snapshot: snapshotState,
      matchGeneration: matchGenerationValue,
      startedAtMs,
    };
    nextRequestId += 1;
    lane.inFlight = request;
    void resolveMlxControllerInput(request);
  }

  function consumeUsableIntent(
    side: PongSide,
    matchGenerationValue: number
  ): { input: Extract<PongControllerInputResult, { readonly ok: true }>; sentAtMs: number } | null {
    const lane = lanes[side];
    if (lane.readyIntent && lane.readyIntent.matchGeneration === matchGenerationValue) {
      const readyIntent = lane.readyIntent;
      lane.readyIntent = null;
      lane.lastIntent = readyIntent.input;
      lane.lastIntentSentAtMs = readyIntent.sentAtMs;
      lane.staleTurnsRemaining = schedulePolicy.staleIntentTurnLimit;
      return {
        input: readyIntent.input,
        sentAtMs: readyIntent.sentAtMs,
      };
    }

    if (lane.lastIntent && lane.lastIntentSentAtMs !== null && lane.staleTurnsRemaining > 0) {
      lane.staleTurnsRemaining -= 1;
      return {
        input: lane.lastIntent,
        sentAtMs: lane.lastIntentSentAtMs,
      };
    }

    return null;
  }

  async function tick(): Promise<void> {
    const matchState = deps.getMatchState();
    syncLanes(matchState);
    if (!active || !matchState.matchStarted) {
      return;
    }

    const scheduledAtMs = deps.nowMs();
    deps.updateTelemetry({ type: 'simulation-scheduled', nowMs: scheduledAtMs });

    try {
      await deps.applyHumanInput?.(matchState.mode);

      for (const side of ['left', 'right'] as const) {
        const usableIntent = consumeUsableIntent(side, matchState.matchGeneration);
        if (!usableIntent) {
          continue;
        }
        await applyControllerInput(deps.runtime, deps.refs, usableIntent.input, {
          appliedAtMs: deps.nowMs(),
          flushRuntime: deps.flushRuntime,
          sentAtMs: usableIntent.sentAtMs,
          updateTelemetry: deps.updateTelemetry,
        });
        deps.postControllerInput(usableIntent.input);
      }

      const paddles = await Promise.all([
        deps.refs.paddleA.ask<PongPaddleState>({ type: 'GET_PADDLE' }),
        deps.refs.paddleB.ask<PongPaddleState>({ type: 'GET_PADDLE' }),
      ]);
      await deps.refs.ball.send({
        type: 'SET_PADDLES',
        leftY: paddles[0].y,
        rightY: paddles[1].y,
      });
      await deps.refs.ball.send({ type: 'TICK' });
      await deps.flushRuntime(deps.runtime);
      deps.updateTelemetry({ type: 'simulation-applied', nowMs: deps.nowMs() });
      const nextSnapshot = await deps.snapshot();
      if (!active) {
        return;
      }

      deps.renderSnapshot(nextSnapshot);
      deps.setStatus('running');

      const refreshedMatchState = deps.getMatchState();
      syncLanes(refreshedMatchState);
      for (const side of ['left', 'right'] as const) {
        if (
          shouldLaunchMlxControllerForSide({
            browserSessionId: deps.browserSessionId,
            matchOwnerSessionId: refreshedMatchState.matchOwnerSessionId,
            mode: refreshedMatchState.mode,
            side,
          })
        ) {
          launchMlxControllerInput(
            side,
            side === 'left' ? deps.refs.controllerLeft : deps.refs.controllerRight,
            nextSnapshot,
            refreshedMatchState.matchGeneration
          );
        }
      }
    } catch (error) {
      deps.setStatus(error instanceof Error ? error.message : 'runtime error');
    }
  }

  return {
    tick,
    stop() {
      active = false;
      resetLane('left');
      resetLane('right');
    },
  };
}

async function tick(): Promise<void> {
  const currentStepper = turnStepper;
  const currentRuntime = runtime;
  const currentRefs = refs;
  if (!currentStepper || !currentRuntime || !currentRefs) {
    return;
  }

  try {
    await currentStepper.tick();
  } finally {
    if (turnStepper === currentStepper && runtime === currentRuntime && refs === currentRefs) {
      loopHandle = window.setTimeout(
        tick,
        DEFAULT_MESH_PONG_CONTROLLER_SCHEDULE_POLICY.simulationIntervalMs
      );
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
  matchMode = mode;
  setStatus('running');
  if (loopHandle === null) {
    loopHandle = window.setTimeout(
      tick,
      DEFAULT_MESH_PONG_CONTROLLER_SCHEDULE_POLICY.simulationIntervalMs
    );
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

export function bootstrapMeshPongUI(): void {
  if (uiBootstrapped || typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }

  canvasElement = queryRequired<HTMLCanvasElement>(document, '#pong-canvas');
  modeSelectElement = queryRequired<HTMLSelectElement>(document, '#transport-mode');
  playerCountSelectElement = queryRequired<HTMLSelectElement>(document, '#player-count');
  leftControllerSelectElement = queryRequired<HTMLSelectElement>(document, '#left-controller');
  rightControllerSelectElement = queryRequired<HTMLSelectElement>(document, '#right-controller');
  claimLeftButtonElement = queryRequired<HTMLButtonElement>(document, '#claim-left');
  claimRightButtonElement = queryRequired<HTMLButtonElement>(document, '#claim-right');
  readyButtonElement = queryRequired<HTMLButtonElement>(document, '#ready-player');
  startButtonElement = queryRequired<HTMLButtonElement>(document, '#start-game');
  resetButtonElement = queryRequired<HTMLButtonElement>(document, '#reset-game');
  modeValueElement = queryRequired<HTMLElement>(document, '#mode-value');
  scoreValueElement = queryRequired<HTMLElement>(document, '#score-value');
  statusValueElement = queryRequired<HTMLElement>(document, '#status-value');
  sessionValueElement = queryRequired<HTMLElement>(document, '#session-value');
  sideValueElement = queryRequired<HTMLElement>(document, '#side-value');
  lobbyValueElement = queryRequired<HTMLElement>(document, '#lobby-value');
  proofTopologyElement = queryRequired<HTMLElement>(document, '#proof-topology');
  proofBehaviorsElement = queryRequired<HTMLElement>(document, '#proof-behaviors');
  proofActorsElement = queryRequired<HTMLElement>(document, '#proof-actors');
  proofGateElement = queryRequired<HTMLElement>(document, '#proof-gate');
  proofStartupElement = queryRequired<HTMLElement>(document, '#proof-startup');
  proofCallElement = queryRequired<HTMLElement>(document, '#proof-call');
  proofTransportElement = queryRequired<HTMLElement>(document, '#proof-transport');
  proofNodesElement = queryRequired<HTMLElement>(document, '#proof-nodes');
  telemetryValues = bindTelemetryPanel(document);

  uiBootstrapped = true;
  playerCountSelectElement.value = String(TWO_HUMAN_PONG_MATCH_MODE.playerCount);
  leftControllerSelectElement.value = TWO_HUMAN_PONG_MATCH_MODE.controllers.left;
  rightControllerSelectElement.value = TWO_HUMAN_PONG_MATCH_MODE.controllers.right;
  renderPlayerSession(null);
  resetTelemetry();

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
      const appliedAtMs = nowEpochMs();
      if (message.replay) {
        updateTelemetry({
          type: 'replay-received',
          originSessionId: message.replay.originSessionId,
          sentAtMs: message.replay.sentAtMs,
          receivedAtMs: appliedAtMs,
        });
      }
      void applyControllerInput(currentRuntime, currentRefs, message.input, {
        appliedAtMs,
        sentAtMs: message.replay?.sentAtMs,
      }).catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : 'remote input failed');
      });
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
}

if (
  typeof document !== 'undefined' &&
  typeof window !== 'undefined' &&
  document.querySelector('#pong-canvas')
) {
  bootstrapMeshPongUI();
}
