import type { ActorMessage, ActorRef } from '@actor-web/runtime';
import { startMeshPongBroadcast } from '../modes/broadcast';
import { startMeshPongLocal } from '../modes/local';
import { startMeshPongMesh } from '../modes/mesh';
import {
  describeMeshPongWebSocketStatus,
  type MeshPongBrowserWebSocketStartResult,
  type StartedMeshPongBrowserWebSocketRuntime,
  startMeshPongBrowserWebSocket,
} from '../modes/websocket';
import {
  type BrowserPongTransportMode,
  MESH_PONG_SHARED_PARITY_PROOF,
  parityProofForMode,
} from '../parity-proof';
import type {
  ControllerCommand,
  PlayerSessionCommand,
  PlayerSessionRestoreResult,
  PongAdvisoryProposal,
  PongAdvisoryProposalRejectionReason,
  PongControllerActorState,
  PongControllerAim,
  PongControllerInputResult,
  PongControllerMode,
  PongControllerModeCompat,
  PongControllerResult,
  PongMatchCommand,
  PongMatchCommandResult,
  PongMatchMode,
  PongMatchPhase,
  PongMatchState,
  PongPlannerStrategy,
  PongPlayerSessionState,
  PongShellMatchMode,
  PongSide,
  PongSnapshot,
} from '../pong-contract';
import {
  admitPongAdvisoryProposal,
  createInitialPlayerSession,
  createMergedControllerAim,
  createReflexControllerAim,
  createSyntheticControllerSession,
  createSyntheticPlannerControllerInput,
  normalizePongControllerType,
  PONG_FIELD,
  resolveControllerIntentForAim,
  shouldLaunchPlannerControllerForSide,
  startMatchLifecycle,
  TWO_HUMAN_PONG_MATCH_MODE,
  toLegacyPongControllerType,
  usesPlannerController,
  usesSyntheticControllerSlot,
} from '../pong-contract';
import type { PongRoomCommand, PongRoomState } from '../pong-room-contract';
import { pong } from '../pong-topology';
import { mountMeshPongWorkflowHost } from '../workflow/mesh-pong-workflow-host';
import {
  createMeshPongWorkflowSource,
  isPongRoomResult,
  type MeshPongWorkflowSource,
} from '../workflow/mesh-pong-workflow-source';
import { drawPong } from './pong-canvas';
import { renderMeshPongWorkflowScreen } from './screens/workflow-screen';

type BrowserMode = BrowserPongTransportMode;
type BrowserRuntime =
  | Awaited<ReturnType<typeof startMeshPongLocal>>
  | Awaited<ReturnType<typeof startMeshPongBroadcast>>
  | Awaited<ReturnType<typeof startMeshPongMesh>>
  | StartedMeshPongBrowserWebSocketRuntime;

interface RuntimeRefs {
  readonly controllerLeft: ActorRef<PongControllerActorState, ControllerCommand>;
  readonly controllerRight: ActorRef<PongControllerActorState, ControllerCommand>;
  readonly matchCoordinator: ActorRef<PongMatchState, PongMatchCommand>;
  readonly room: ActorRef<PongRoomState, PongRoomCommand>;
  readonly playerSession: ActorRef<PongPlayerSessionState, PlayerSessionCommand>;
}

export interface MeshPongTelemetryControllerState {
  readonly inFlight: boolean;
  readonly mode: PongControllerMode | 'idle';
  readonly appliedSource: 'idle' | 'human' | 'reflex' | 'planner' | 'hybrid';
  readonly strategyStatus:
    | 'idle'
    | 'live'
    | 'pending'
    | 'fresh'
    | 'stale'
    | 'fallback'
    | 'neutral'
    | 'error';
  readonly detail: string | null;
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
  readonly gameplayEffect: 'stalled' | 'timeout-bound' | 'laggy' | 'controller-delayed' | 'smooth';
}

export type MeshPongTelemetryEvent =
  | { readonly type: 'rendered'; readonly nowMs: number }
  | { readonly type: 'simulation-scheduled'; readonly nowMs: number }
  | { readonly type: 'simulation-held'; readonly nowMs: number }
  | { readonly type: 'simulation-applied'; readonly nowMs: number }
  | {
      readonly type: 'controller-request-started';
      readonly side: PongSide;
      readonly mode: PongControllerMode;
      readonly nowMs: number;
    }
  | {
      readonly type: 'controller-request-finished';
      readonly side: PongSide;
      readonly mode: PongControllerMode;
      readonly nowMs: number;
      readonly outcome: 'ready' | 'error' | 'rejected';
      readonly reason?:
        | 'llm-unavailable'
        | 'timeout'
        | 'provider-failed'
        | 'invalid-response'
        | PongAdvisoryProposalRejectionReason;
      readonly strategyStatus?: 'fresh' | 'error';
      readonly detail?: string;
      readonly error?: string;
    }
  | {
      readonly type: 'controller-intent-applied';
      readonly side: PongSide;
      readonly mode: PongControllerMode;
      readonly source: 'human' | 'reflex' | 'planner' | 'hybrid';
      readonly strategyStatus: 'live' | 'fresh' | 'stale' | 'fallback' | 'neutral';
      readonly detail: string;
      readonly nowMs: number;
      readonly sentAtMs?: number;
    }
  | {
      readonly type: 'controller-state-observed';
      readonly side: PongSide;
      readonly mode: PongControllerMode;
      readonly source: 'human' | 'reflex' | 'planner' | 'hybrid';
      readonly strategyStatus: 'live' | 'fresh' | 'stale' | 'fallback' | 'neutral';
      readonly detail: string;
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

export const MESH_PONG_STARTUP_TIMEOUT_MS = 5_000;

export interface MeshPongControllerSchedulePolicy {
  readonly simulationIntervalMs: number;
  readonly controllerAskTimeoutMs: number;
  readonly plannerProposalMaxAgeMs: number;
  readonly plannerStrategyFreshTurnLimit: number;
  readonly plannerStrategyStaleTurnLimit: number;
}

export const DEFAULT_MESH_PONG_CONTROLLER_SCHEDULE_POLICY: MeshPongControllerSchedulePolicy = {
  simulationIntervalMs: 90,
  controllerAskTimeoutMs: 30_000,
  plannerProposalMaxAgeMs: 1_000,
  plannerStrategyFreshTurnLimit: 2,
  plannerStrategyStaleTurnLimit: 1,
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

export async function withMeshPongStartupTimeout<T>(
  operation: Promise<T>,
  label: string,
  timeoutMs = MESH_PONG_STARTUP_TIMEOUT_MS,
  disposeLateResult?: (value: T) => Promise<void> | void
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  let disposed = false;
  const observedOperation = operation.then(
    async (value) => {
      if (timedOut && disposeLateResult && !disposed) {
        disposed = true;
        try {
          await disposeLateResult(value);
        } catch {
          // Late cleanup is best-effort after the caller already received the timeout fact.
        }
      }
      return value;
    },
    (error: unknown) => {
      if (timedOut) {
        return undefined as T;
      }
      throw error;
    }
  );
  const timeout = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      reject(new Error(`Timed out starting Mesh Pong ${label}.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([observedOperation, timeout]);
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
}

function createTelemetryControllerState(): MeshPongTelemetryControllerState {
  return {
    inFlight: false,
    mode: 'idle',
    appliedSource: 'idle',
    strategyStatus: 'idle',
    detail: null,
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

function eventTimestamp(event: MeshPongTelemetryEvent): number {
  switch (event.type) {
    case 'rendered':
    case 'simulation-scheduled':
    case 'simulation-held':
    case 'simulation-applied':
    case 'controller-request-started':
    case 'controller-request-finished':
    case 'controller-intent-applied':
    case 'controller-state-observed':
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
  const simulationLagged = state.simulation.heldCount > 0 || state.simulation.droppedCount > 0;
  const controllerDelayed =
    averageLatencyMs !== null && averageLatencyMs > state.simulation.targetIntervalMs;
  const gameplayEffect =
    state.controllers.finishedCount === 0 || state.simulation.appliedCount === 0
      ? 'stalled'
      : timeoutRate >= 0.5
        ? 'timeout-bound'
        : simulationLagged
          ? 'laggy'
          : controllerDelayed
            ? 'controller-delayed'
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
          timeoutCount: state.controllers.timeoutCount + (event.reason === 'timeout' ? 1 : 0),
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
    case 'controller-state-observed':
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
            mode: event.mode,
            strategyStatus: 'pending',
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
            mode: event.mode,
            rttMs:
              controller.startedAtMs === null
                ? null
                : Math.max(0, event.nowMs - controller.startedAtMs),
            outcome: event.outcome,
            strategyStatus:
              event.outcome === 'error'
                ? 'error'
                : (event.strategyStatus ?? controller.strategyStatus),
            detail: event.detail ?? controller.detail,
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
            mode: event.mode,
            appliedSource: event.source,
            strategyStatus: event.strategyStatus,
            detail: event.detail,
            lastAppliedIntentAtMs: event.nowMs,
            lastAppliedIntentAgeMs:
              event.sentAtMs === undefined ? 0 : Math.max(0, event.nowMs - event.sentAtMs),
            outcome: 'applied',
            error: null,
          },
        },
      };
    }
    case 'controller-state-observed': {
      return {
        ...state,
        controllers: {
          ...state.controllers,
          [event.side]: {
            ...state.controllers[event.side],
            mode: event.mode,
            appliedSource: event.source,
            strategyStatus: event.strategyStatus,
            detail: event.detail,
            lastAppliedIntentAgeMs:
              event.sentAtMs === undefined ? null : Math.max(0, event.nowMs - event.sentAtMs),
            outcome: 'ready',
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

function summarizeControllerDetail(detail: string | null): string {
  return detail ? ` aim ${detail}` : ' aim --';
}

function formatControllerTelemetry(state: MeshPongTelemetryControllerState): string {
  const error = state.error ? ` err ${state.error}` : '';
  return `m ${state.mode} src ${state.appliedSource} st ${state.strategyStatus}${summarizeControllerDetail(state.detail)} age ${formatMs(state.lastAppliedIntentAgeMs)} rtt ${formatMs(state.rttMs)}${error}`;
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

export type MeshPongControllerReplayTelemetry = {
  readonly mode: PongControllerMode;
  readonly source: 'human' | 'reflex' | 'planner' | 'hybrid';
  readonly strategyStatus: 'live' | 'fresh' | 'stale' | 'fallback' | 'neutral';
  readonly detail: string;
};

export type LobbyReplayMetadata = {
  readonly originSessionId: string;
  readonly sentAtMs: number;
};

export type MeshPongControllerInputReplayMessage = {
  readonly type: 'controller-input';
  readonly input: Extract<PongControllerInputResult, { readonly ok: true }>;
  readonly replay?: LobbyReplayMetadata;
  readonly controllerTelemetry?: MeshPongControllerReplayTelemetry;
};

export type MeshPongControllerInputReplayEnvelope = MeshPongControllerInputReplayMessage & {
  readonly replay: LobbyReplayMetadata;
};

type PlannerControllerRequest = {
  readonly requestId: number;
  readonly proposalId: string;
  readonly correlationId: string;
  readonly sequence: number;
  readonly runtime: BrowserRuntime;
  readonly refs: RuntimeRefs;
  readonly side: PongSide;
  readonly mode: PongControllerMode;
  readonly controller: ActorRef<PongControllerActorState, ControllerCommand>;
  readonly snapshot: PongSnapshot;
  readonly matchGeneration: number;
  readonly baseTick: number;
  readonly ownerSessionId: string | null;
  readonly startedAtMs: number;
};

type PlannerDecisionState = PongAdvisoryProposal;

type PlannerControllerLaneState = {
  inFlight: PlannerControllerRequest | null;
  readyDecision: PlannerDecisionState | null;
  lastDecision: PlannerDecisionState | null;
  latestAcceptedSequence: number;
  freshTurnsRemaining: number;
  staleTurnsRemaining: number;
};

export interface MeshPongTurnMatchState {
  readonly phase: PongMatchPhase;
  readonly matchGeneration: number;
  readonly currentTick: number;
  readonly matchOwnerSessionId: string | null;
  readonly mode: PongShellMatchMode | null;
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
    input: Extract<PongControllerInputResult, { readonly ok: true }>,
    controllerTelemetry?: MeshPongControllerReplayTelemetry
  ) => void;
  readonly setControllerDiagnostic: (side: PongSide, reason: string) => void;
  readonly clearControllerDiagnostic: (side: PongSide) => void;
  readonly applyHumanInput?: (mode: PongShellMatchMode | null) => Promise<boolean>;
}

export interface MeshPongTurnStepper {
  tick(): Promise<void>;
  stop(): void;
}

const SESSION_ID_STORAGE_KEY = 'actor-web.mesh-pong.session-id';

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
let workflowRootElement: HTMLElement;
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
let matchState: PongMatchState | null = null;
let workflowSource: MeshPongWorkflowSource | null = null;
let stopWorkflowHost: (() => void) | null = null;
const keys = new Set<string>();
let lifecycleStatus = 'idle';
const controllerDiagnostics: Partial<Record<PongSide, string>> = {};
let telemetryState = createMeshPongTelemetryState(0);
let benchmarkSummaryState = createMeshPongBenchmarkSummaryState(0);
let turnStepper: MeshPongTurnStepper | null = null;
const meshPongClock = createMeshPongClock();

function nowMs(): number {
  return meshPongClock.nowMs();
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
  return error instanceof Error ? error.message : String(error);
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
  matchState = null;
}

function renderStatus(): void {
  const diagnostics = (['left', 'right'] as const)
    .flatMap((side) => {
      const reason = controllerDiagnostics[side];
      return reason ? [`${side} ${reason}`] : [];
    })
    .join('; ');
  const status = diagnostics ? `${lifecycleStatus}; ${diagnostics}` : lifecycleStatus;
  statusValueElement.textContent = status;
  statusValueElement.title = status;
}

function createSessionId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Fall through to a non-secure-context-safe local session id.
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

function isController(value: string): value is PongControllerModeCompat {
  return (
    value === 'human' ||
    value === 'mlx' ||
    value === 'reflex' ||
    value === 'planner' ||
    value === 'hybrid'
  );
}

export function resolveBrowserModeSelection(value: string, fallback: BrowserMode): BrowserMode {
  return value === 'local' || value === 'broadcast' || value === 'mesh' || value === 'websocket'
    ? value
    : fallback;
}

function selectedController(select: HTMLSelectElement): PongControllerMode {
  return normalizePongControllerType(isController(select.value) ? select.value : 'human');
}

function selectedMatchMode(): PongShellMatchMode {
  return {
    playerCount: playerCountSelectElement.value === '1' ? 1 : 2,
    controllers: {
      left: selectedController(leftControllerSelectElement),
      right: selectedController(rightControllerSelectElement),
    },
  };
}

function toLegacyMatchMode(mode: PongShellMatchMode): PongMatchMode {
  return {
    playerCount: mode.playerCount,
    controllers: {
      left: toLegacyPongControllerType(mode.controllers.left),
      right: toLegacyPongControllerType(mode.controllers.right),
    },
  };
}

function installControllerVocabulary(select: HTMLSelectElement, side: PongSide): void {
  const legacyValue = normalizePongControllerType(select.value);
  const labels: Array<{ value: PongControllerMode; label: string }> = [
    { value: 'human', label: `${side === 'left' ? 'Left' : 'Right'} human` },
    { value: 'reflex', label: `${side === 'left' ? 'Left' : 'Right'} reflex` },
    { value: 'planner', label: `${side === 'left' ? 'Left' : 'Right'} planner` },
    { value: 'hybrid', label: `${side === 'left' ? 'Left' : 'Right'} hybrid` },
  ];
  select.replaceChildren(
    ...labels.map(({ value, label }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    })
  );
  select.value = legacyValue;
}

export type MeshPongBrowserRuntimeRefPath = 'local' | 'cluster' | 'websocket';

export function resolveBrowserRuntimeRefPath(candidate: object): MeshPongBrowserRuntimeRefPath {
  const mode = 'mode' in candidate ? candidate.mode : undefined;
  if (mode === 'broadcast' || mode === 'mesh') {
    return 'cluster';
  }
  if (mode === 'websocket') {
    return 'websocket';
  }
  return 'local';
}

function isBrowserClusterRuntime(
  candidate: BrowserRuntime
): candidate is
  | Awaited<ReturnType<typeof startMeshPongBroadcast>>
  | Awaited<ReturnType<typeof startMeshPongMesh>> {
  return resolveBrowserRuntimeRefPath(candidate) === 'cluster';
}

function isBrowserWebSocketRuntime(
  candidate: BrowserRuntime
): candidate is StartedMeshPongBrowserWebSocketRuntime {
  return resolveBrowserRuntimeRefPath(candidate) === 'websocket';
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
  if (matchState) {
    renderLobby(matchState);
  }
}

function mountCanonicalWorkflow(nextRefs: RuntimeRefs): void {
  stopWorkflowHost?.();
  workflowSource?.close();
  const source = createMeshPongWorkflowSource({
    sessionId: browserSessionId,
    actors: {
      room: nextRefs.room,
      matchCoordinator: nextRefs.matchCoordinator,
    },
  });
  workflowSource = source;
  stopWorkflowHost = mountMeshPongWorkflowHost(source, {
    render: (projection) => {
      renderMeshPongWorkflowScreen(workflowRootElement, projection);
      startButtonElement.disabled = !projection.canStart;
    },
  });
  void source.refresh().catch((error: unknown) => {
    if (workflowSource !== source) {
      return;
    }
    setStatus(
      error instanceof Error ? `workflow sync failed: ${error.message}` : 'workflow sync failed'
    );
  });
}

export function isProjectedMatchReadyToStart(options: {
  readonly match: PongMatchState;
  readonly session: PongPlayerSessionState | null;
  readonly mode: PongShellMatchMode;
  readonly expectedGeneration: number;
}): boolean {
  if (!options.session) {
    return false;
  }

  return startMatchLifecycle(
    options.match,
    options.session.sessionId,
    options.expectedGeneration,
    toLegacyMatchMode(options.mode)
  ).ok;
}

function renderLobby(match: PongMatchState): void {
  const readyControllers = match.controllers.filter((controller) => controller.ready).length;
  lobbyValueElement.textContent = `${readyControllers} / 2`;
}

function applyProjectedMatch(
  nextMatch: PongMatchState,
  options: { readonly renderSnapshot?: boolean; readonly renderStatus?: boolean } = {}
): void {
  matchState = nextMatch;
  renderLobby(nextMatch);
  if (options.renderSnapshot !== false) {
    renderSnapshot(nextMatch.snapshot);
  }
  if (options.renderStatus !== false) {
    setStatus(statusForMatchPhase(nextMatch.phase));
  }
}

async function currentMatchState(nextRefs: RuntimeRefs): Promise<PongMatchState> {
  return nextRefs.matchCoordinator.ask<PongMatchState>({ type: 'GET_MATCH' });
}

export type MeshPongPlayerSessionHydrationResult =
  | {
      readonly ok: true;
      readonly session: PongPlayerSessionState;
      readonly match: PongMatchState;
    }
  | {
      readonly ok: false;
      readonly reason: 'cancelled';
    }
  | {
      readonly ok: false;
      readonly reason: 'restore-failed';
      readonly result: Extract<PlayerSessionRestoreResult, { readonly ok: false }>;
      readonly session: PongPlayerSessionState;
      readonly match: PongMatchState;
    }
  | {
      readonly ok: false;
      readonly reason: 'sync-failed';
      readonly result: Exclude<PongMatchCommandResult, { readonly ok: true }>;
      readonly session: PongPlayerSessionState;
      readonly match: PongMatchState;
    };

async function syncMeshPongPlayerSessionState(options: {
  readonly session: PongPlayerSessionState;
  readonly matchCoordinator: ActorRef<PongMatchState, PongMatchCommand>;
  readonly flush: () => Promise<void>;
  readonly shouldApply: () => boolean;
}): Promise<MeshPongPlayerSessionHydrationResult> {
  if (!options.shouldApply()) {
    return { ok: false, reason: 'cancelled' };
  }
  const syncResult = await options.matchCoordinator.ask<PongMatchCommandResult>({
    type: 'SYNC_SESSION',
    requestSessionId: options.session.sessionId,
    session: options.session,
  });
  if (!options.shouldApply()) {
    return { ok: false, reason: 'cancelled' };
  }
  await options.flush();
  if (!options.shouldApply()) {
    return { ok: false, reason: 'cancelled' };
  }
  const match = await options.matchCoordinator.ask<PongMatchState>({ type: 'GET_MATCH' });
  if (!options.shouldApply()) {
    return { ok: false, reason: 'cancelled' };
  }
  return syncResult.ok
    ? { ok: true, session: options.session, match }
    : {
        ok: false,
        reason: 'sync-failed',
        result: syncResult,
        session: options.session,
        match,
      };
}

export async function restoreAndSyncMeshPongPlayerSession(options: {
  readonly playerSession: ActorRef<PongPlayerSessionState, PlayerSessionCommand>;
  readonly matchCoordinator: ActorRef<PongMatchState, PongMatchCommand>;
  readonly flush: () => Promise<void>;
  readonly shouldApply?: () => boolean;
}): Promise<MeshPongPlayerSessionHydrationResult> {
  const shouldApply = options.shouldApply ?? (() => true);
  if (!shouldApply()) {
    return { ok: false, reason: 'cancelled' };
  }

  const localSession = await options.playerSession.ask<PongPlayerSessionState>({
    type: 'GET_SESSION',
  });
  if (!shouldApply()) {
    return { ok: false, reason: 'cancelled' };
  }

  const authoritativeMatch = await options.matchCoordinator.ask<PongMatchState>({
    type: 'GET_MATCH',
  });
  if (!shouldApply()) {
    return { ok: false, reason: 'cancelled' };
  }

  const authoritativeSession = authoritativeMatch.sessions.find(
    (candidate) => candidate.sessionId === localSession.sessionId
  );
  let session = localSession;
  if (authoritativeSession) {
    const restoreResult = await options.playerSession.ask<PlayerSessionRestoreResult>({
      type: 'RESTORE_SESSION',
      session: authoritativeSession,
    });
    if (!shouldApply()) {
      return { ok: false, reason: 'cancelled' };
    }
    if (!restoreResult.ok) {
      return {
        ok: false,
        reason: 'restore-failed',
        result: restoreResult,
        session,
        match: authoritativeMatch,
      };
    }
    session = restoreResult.session;
  }

  return syncMeshPongPlayerSessionState({
    session,
    matchCoordinator: options.matchCoordinator,
    flush: options.flush,
    shouldApply,
  });
}

async function syncLocalMeshPongPlayerSession(options: {
  readonly playerSession: ActorRef<PongPlayerSessionState, PlayerSessionCommand>;
  readonly matchCoordinator: ActorRef<PongMatchState, PongMatchCommand>;
  readonly flush: () => Promise<void>;
  readonly shouldApply: () => boolean;
}): Promise<MeshPongPlayerSessionHydrationResult> {
  if (!options.shouldApply()) {
    return { ok: false, reason: 'cancelled' };
  }
  const session = await options.playerSession.ask<PongPlayerSessionState>({
    type: 'GET_SESSION',
  });
  if (!options.shouldApply()) {
    return { ok: false, reason: 'cancelled' };
  }
  return syncMeshPongPlayerSessionState({
    session,
    matchCoordinator: options.matchCoordinator,
    flush: options.flush,
    shouldApply: options.shouldApply,
  });
}

function isCurrentRuntimeContext(
  candidateRuntime: BrowserRuntime,
  candidateRefs: RuntimeRefs
): boolean {
  return runtime === candidateRuntime && refs === candidateRefs;
}

function isCurrentWorkflowRuntimeContext(
  candidateRuntime: BrowserRuntime,
  candidateRefs: RuntimeRefs,
  candidateWorkflow: MeshPongWorkflowSource
): boolean {
  return (
    isCurrentRuntimeContext(candidateRuntime, candidateRefs) && workflowSource === candidateWorkflow
  );
}

async function syncMatchForMode(
  nextRuntime: BrowserRuntime,
  nextRefs: RuntimeRefs,
  mode: PongShellMatchMode,
  shouldContinue: () => boolean = () => true
): Promise<boolean> {
  const syncSession = async (session: PongPlayerSessionState): Promise<boolean> => {
    const result = await nextRefs.matchCoordinator.ask<PongMatchCommandResult>({
      type: 'SYNC_SESSION',
      requestSessionId: session.sessionId,
      session,
    });
    if (!shouldContinue()) {
      return false;
    }
    if (!result.ok) {
      setStatus(formatMatchCommandFailure(result));
      return false;
    }
    matchState = result.match;
    return true;
  };

  if (playerSessionState) {
    if (!(await syncSession(playerSessionState))) {
      return false;
    }
  }
  for (const side of ['left', 'right'] as const) {
    if (usesSyntheticControllerSlot(mode.controllers[side])) {
      const session = createSyntheticControllerSession(side);
      if (!(await syncSession(session))) {
        return false;
      }
    }
  }
  await flushRuntime(nextRuntime);
  return shouldContinue();
}

async function syncCurrentSession(
  nextRuntime: BrowserRuntime,
  nextRefs: RuntimeRefs,
  options: {
    readonly shouldApply?: () => boolean;
    readonly restoreAuthoritative?: boolean;
  } = {}
): Promise<{ readonly ok: true } | { readonly ok: false; readonly status?: string }> {
  const shouldApply = options.shouldApply ?? (() => true);
  const hydration =
    options.restoreAuthoritative === false
      ? await syncLocalMeshPongPlayerSession({
          playerSession: nextRefs.playerSession,
          matchCoordinator: nextRefs.matchCoordinator,
          flush: () => flushRuntime(nextRuntime),
          shouldApply,
        })
      : await restoreAndSyncMeshPongPlayerSession({
          playerSession: nextRefs.playerSession,
          matchCoordinator: nextRefs.matchCoordinator,
          flush: () => flushRuntime(nextRuntime),
          shouldApply,
        });
  if (!shouldApply()) {
    return { ok: false };
  }

  if (!hydration.ok && hydration.reason === 'cancelled') {
    return { ok: false };
  }
  matchState = hydration.match;
  if (!shouldApply()) {
    return { ok: false };
  }
  renderLobby(hydration.match);
  if (!shouldApply()) {
    return { ok: false };
  }
  if (!hydration.ok) {
    const projectedSession =
      hydration.match.sessions.find(
        (candidate) => candidate.sessionId === hydration.session.sessionId
      ) ?? createInitialPlayerSession(hydration.session.sessionId);
    playerSessionState = projectedSession;
    if (!shouldApply()) {
      return { ok: false };
    }
    renderPlayerSession(projectedSession);
    if (!shouldApply()) {
      return { ok: false };
    }
    return {
      ok: false,
      status:
        hydration.reason === 'restore-failed'
          ? hydration.result.reason
          : formatMatchCommandFailure(hydration.result),
    };
  }
  playerSessionState = hydration.session;
  if (!shouldApply()) {
    return { ok: false };
  }
  renderPlayerSession(hydration.session);
  return { ok: true };
}

async function hydrateCurrentSession(
  nextRuntime: BrowserRuntime,
  nextRefs: RuntimeRefs,
  options: { readonly shouldApply?: () => boolean } = {}
): Promise<{ readonly ok: true } | { readonly ok: false; readonly status?: string }> {
  const shouldApply = options.shouldApply ?? (() => true);
  return syncCurrentSession(nextRuntime, nextRefs, { shouldApply });
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
  if ('flush' in candidate) {
    await candidate.flush();
    return;
  }

  for (const nodeRuntime of Object.values(candidate.nodes)) {
    await nodeRuntime?.system.flush();
  }
}

function lookupNode(candidate: BrowserRuntime) {
  if (isBrowserWebSocketRuntime(candidate)) {
    return candidate.lookupNode;
  }
  if (isBrowserClusterRuntime(candidate)) {
    return candidate.server ?? candidate.lookupNode;
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
  const server = lookupNode(candidate);
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
  const playerSession = isBrowserWebSocketRuntime(candidate)
    ? await waitForActor<PongPlayerSessionState, PlayerSessionCommand>(
        candidate,
        candidate.playerSessionAddress
      )
    : isBrowserClusterRuntime(candidate)
      ? await candidate.client.actors.playerSession.instance({ sessionId: browserSessionId })
      : await (() => {
          const clientNode = candidate.nodes.client;
          if (!clientNode) {
            throw new Error('Mesh Pong local runtime did not start the client node.');
          }
          return clientNode.actors.playerSession.instance({ sessionId: browserSessionId });
        })();
  return {
    controllerLeft: await waitForActor<PongControllerActorState, ControllerCommand>(
      candidate,
      pong.actors.controllerLeft.address
    ),
    controllerRight: await waitForActor<PongControllerActorState, ControllerCommand>(
      candidate,
      pong.actors.controllerRight.address
    ),
    matchCoordinator: await waitForActor<PongMatchState, PongMatchCommand>(
      candidate,
      isBrowserWebSocketRuntime(candidate)
        ? candidate.matchCoordinatorAddress
        : pong.actors.matchCoordinator.address
    ),
    room: await waitForActor<PongRoomState, PongRoomCommand>(candidate, pong.actors.room.address),
    playerSession,
  };
}

async function snapshot(nextRefs: RuntimeRefs): Promise<PongSnapshot> {
  return matchState?.snapshot ?? (await currentMatchState(nextRefs)).snapshot;
}

interface MeshPongRuntimeResetOptions {
  readonly shouldApply?: () => boolean;
  readonly flush?: (runtime: BrowserRuntime) => Promise<void>;
  readonly readMatch?: (refs: RuntimeRefs) => Promise<PongMatchState>;
  readonly applyMatch?: (match: PongMatchState) => void;
}

export async function resetRuntimeGame(
  nextRuntime: BrowserRuntime,
  nextRefs: RuntimeRefs,
  options: MeshPongRuntimeResetOptions = {}
): Promise<PongSnapshot | null> {
  const shouldApply = options.shouldApply ?? (() => true);
  const flush = options.flush ?? flushRuntime;
  const readMatch = options.readMatch ?? currentMatchState;
  const applyMatch = options.applyMatch ?? applyProjectedMatch;
  if (!shouldApply()) {
    return null;
  }
  await flush(nextRuntime);
  if (!shouldApply()) {
    return null;
  }
  const nextMatch = await readMatch(nextRefs);
  if (!shouldApply()) {
    return null;
  }
  applyMatch(nextMatch);
  return nextMatch.snapshot;
}

export async function runMeshPongStartupSubstages(options: {
  readonly label: string;
  readonly timeoutMs?: number;
  readonly shouldApply: () => boolean;
  readonly invalidate: () => void;
  readonly reset: (shouldApply: () => boolean) => Promise<PongSnapshot | null>;
  readonly hydrate: (
    shouldApply: () => boolean
  ) => Promise<{ readonly ok: true } | { readonly ok: false; readonly status?: string }>;
  readonly stop: () => Promise<void>;
  readonly activate: (snapshot: PongSnapshot) => void;
  readonly setStatus: (status: string) => void;
}): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? MESH_PONG_STARTUP_TIMEOUT_MS;
  const stop = async (): Promise<void> => {
    await options.stop().catch(() => undefined);
  };
  const fail = async (status?: string): Promise<false> => {
    const isCurrent = options.shouldApply();
    if (isCurrent) {
      options.invalidate();
    }
    await stop();
    if (isCurrent && status) {
      options.setStatus(status);
    }
    return false;
  };

  try {
    const nextSnapshot = await withMeshPongStartupTimeout(
      options.reset(options.shouldApply),
      `${options.label} game reset`,
      timeoutMs
    );
    if (!nextSnapshot || !options.shouldApply()) {
      await stop();
      return false;
    }

    const hydration = await withMeshPongStartupTimeout(
      options.hydrate(options.shouldApply),
      `${options.label} session hydrate`,
      timeoutMs
    );
    if (!hydration.ok) {
      return fail(hydration.status);
    }
    if (!options.shouldApply()) {
      await stop();
      return false;
    }

    options.activate(nextSnapshot);
    return true;
  } catch (error) {
    return fail(error instanceof Error ? `start failed: ${error.message}` : 'start failed');
  }
}

function renderSnapshot(nextSnapshot: PongSnapshot): void {
  updateTelemetry({ type: 'rendered', nowMs: nowMs() });
  drawPong(canvasElement, nextSnapshot);
  scoreValueElement.textContent = `${nextSnapshot.score.left} : ${nextSnapshot.score.right}`;
}

async function resetGame(): Promise<void> {
  const currentRuntime = runtime;
  const currentRefs = refs;
  if (!currentRuntime || !currentRefs) {
    return;
  }

  clearControllerDiagnostics();
  const currentMatch = await currentMatchState(currentRefs);
  const result = await currentRefs.matchCoordinator.ask<PongMatchCommandResult>({
    type: 'RESTART_MATCH',
    requestSessionId: browserSessionId,
    expectedGeneration: currentMatch.generation,
  });
  await flushRuntime(currentRuntime);
  if (!result.ok) {
    setStatus(formatMatchCommandFailure(result));
    return;
  }
  if (runtime === currentRuntime && refs === currentRefs) {
    applyProjectedMatch(result.match);
    ensureProjectionLoop();
  }
}

async function returnToRoom(): Promise<void> {
  const currentRuntime = runtime;
  const currentRefs = refs;
  if (!currentRuntime || !currentRefs) {
    return;
  }

  const currentMatch = await currentMatchState(currentRefs);
  const result = await currentRefs.matchCoordinator.ask<PongMatchCommandResult>({
    type: 'RETURN_TO_ROOM',
    requestSessionId: browserSessionId,
    expectedGeneration: currentMatch.generation,
  });
  await flushRuntime(currentRuntime);
  if (!isCurrentRuntimeContext(currentRuntime, currentRefs)) {
    return;
  }
  if (!result.ok) {
    setStatus(formatMatchCommandFailure(result));
    return;
  }
  applyProjectedMatch(result.match);
}

function isBrowserRuntimeStartFailure(
  candidate: BrowserRuntime | MeshPongBrowserWebSocketStartResult
): candidate is Extract<MeshPongBrowserWebSocketStartResult, { readonly ok: false }> {
  return 'ok' in candidate && candidate.ok === false;
}

function startStatusForMode(mode: BrowserMode): string {
  return mode === 'websocket' ? describeMeshPongWebSocketStatus('connecting') : 'starting';
}

function statusForMatchPhase(phase: PongMatchPhase): string {
  switch (phase) {
    case 'lobby':
      return 'lobby';
    case 'paused':
      return 'paused';
    case 'running':
      return 'running';
  }
}

function failureStatusForMode(
  result: Extract<MeshPongBrowserWebSocketStartResult, { readonly ok: false }>
): string {
  return describeMeshPongWebSocketStatus(result.state);
}

async function startRuntimeForMode(
  mode: BrowserMode
): Promise<BrowserRuntime | MeshPongBrowserWebSocketStartResult> {
  if (mode === 'local') {
    return startMeshPongLocal({ sessionId: browserSessionId });
  }
  if (mode === 'broadcast') {
    return startMeshPongBroadcast({
      sessionId: browserSessionId,
      channelName: 'mesh-pong-demo',
    });
  }
  if (mode === 'websocket') {
    return startMeshPongBrowserWebSocket({ sessionId: browserSessionId });
  }
  return startMeshPongMesh({
    sessionId: browserSessionId,
    channelName: 'mesh-pong-demo-mesh',
  });
}

async function disposeLateRuntimeStart(
  startedRuntime: BrowserRuntime | MeshPongBrowserWebSocketStartResult
): Promise<void> {
  if (isBrowserRuntimeStartFailure(startedRuntime)) {
    return;
  }
  const lateRuntime = 'ok' in startedRuntime ? startedRuntime.runtime : startedRuntime;
  await lateRuntime.stop().catch(() => undefined);
}

function ensureProjectionLoop(): void {
  if (!turnStepper || !runtime || !refs || loopHandle !== null) {
    return;
  }
  loopHandle = window.setTimeout(
    tick,
    DEFAULT_MESH_PONG_CONTROLLER_SCHEDULE_POLICY.simulationIntervalMs
  );
}

function invalidateSwitchGeneration(generation: number): boolean {
  if (switchGeneration !== generation) {
    return false;
  }
  switchGeneration = generation + 1;
  return true;
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
  stopWorkflowHost?.();
  stopWorkflowHost = null;
  workflowSource?.close();
  workflowSource = null;
  playerSessionState = null;
  matchState = null;
  stopTurnStepper();
  clearControllerDiagnostics();
  resetTelemetry();

  if (previous) {
    try {
      await previous.stop();
    } catch (error) {
      if (invalidateSwitchGeneration(generation)) {
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
  setStatus(startStatusForMode(mode));

  let nextRuntime: BrowserRuntime | null = null;
  try {
    const startedRuntime = await withMeshPongStartupTimeout(
      startRuntimeForMode(mode),
      `${mode} runtime`,
      MESH_PONG_STARTUP_TIMEOUT_MS,
      disposeLateRuntimeStart
    );
    if (isBrowserRuntimeStartFailure(startedRuntime)) {
      if (invalidateSwitchGeneration(generation)) {
        setStatus(failureStatusForMode(startedRuntime));
      }
      return;
    }
    nextRuntime = 'ok' in startedRuntime ? startedRuntime.runtime : startedRuntime;
    const candidateRuntime = nextRuntime;
    const nextRefs = await withMeshPongStartupTimeout(
      resolveRefs(candidateRuntime),
      `${mode} actor refs`
    );
    const activated = await runMeshPongStartupSubstages({
      label: mode,
      shouldApply: () => switchGeneration === generation,
      invalidate: () => {
        invalidateSwitchGeneration(generation);
      },
      reset: (shouldApply) =>
        resetRuntimeGame(candidateRuntime, nextRefs, {
          shouldApply,
        }),
      hydrate: (shouldApply) =>
        hydrateCurrentSession(candidateRuntime, nextRefs, {
          shouldApply,
        }),
      stop: () => candidateRuntime.stop(),
      activate: (nextSnapshot) => {
        runtime = candidateRuntime;
        refs = nextRefs;
        mountCanonicalWorkflow(nextRefs);
        const activeRuntime = candidateRuntime;
        turnStepper = createMeshPongTurnStepper({
          runtime: activeRuntime,
          refs: nextRefs,
          browserSessionId,
          getMatchState: () => ({
            phase: matchState?.phase ?? 'lobby',
            matchGeneration: matchState?.generation ?? 0,
            currentTick: matchState?.tick ?? 0,
            matchOwnerSessionId: matchState?.authoritySessionId ?? null,
            mode: matchState
              ? ({
                  playerCount:
                    matchState.mode?.playerCount ?? TWO_HUMAN_PONG_MATCH_MODE.playerCount,
                  controllers: {
                    left: normalizePongControllerType(matchState.mode?.controllers.left ?? 'human'),
                    right: normalizePongControllerType(
                      matchState.mode?.controllers.right ?? 'human'
                    ),
                  },
                } satisfies PongShellMatchMode)
              : null,
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
        setStatus(statusForMatchPhase((matchState as PongMatchState | null)?.phase ?? 'lobby'));
        ensureProjectionLoop();
      },
      setStatus,
    });
    if (!activated) {
      return;
    }
  } catch (error) {
    const isCurrent = invalidateSwitchGeneration(generation);
    if (nextRuntime) {
      await nextRuntime.stop().catch(() => undefined);
    }
    if (isCurrent) {
      runtime = null;
      refs = null;
      loopHandle = null;
      clearMatchOwner();
      setStatus(error instanceof Error ? `start failed: ${error.message}` : 'start failed');
    }
  }
}

export function createMeshPongControllerInputReplayMessage(options: {
  readonly input: Extract<PongControllerInputResult, { readonly ok: true }>;
  readonly originSessionId: string;
  readonly sentAtMs: number;
  readonly controllerTelemetry?: MeshPongControllerReplayTelemetry;
}): MeshPongControllerInputReplayEnvelope {
  const baseMessage = {
    type: 'controller-input',
    input: options.input,
    replay: {
      originSessionId: options.originSessionId,
      sentAtMs: options.sentAtMs,
    },
  } satisfies MeshPongControllerInputReplayEnvelope;
  if (!options.controllerTelemetry) {
    return baseMessage;
  }
  return {
    ...baseMessage,
    controllerTelemetry: options.controllerTelemetry,
  };
}

function postControllerInput(
  input: Extract<PongControllerInputResult, { readonly ok: true }>,
  controllerTelemetry?: MeshPongControllerReplayTelemetry
): void {
  void input;
  void controllerTelemetry;
}

async function applyControllerInput(
  nextRuntime: BrowserRuntime,
  nextRefs: RuntimeRefs,
  input: Extract<PongControllerInputResult, { readonly ok: true }>,
  metadata?: {
    readonly appliedAtMs?: number;
    readonly detail?: string;
    readonly flushRuntime?: (runtime: BrowserRuntime) => Promise<void>;
    readonly mode?: PongControllerMode;
    readonly sentAtMs?: number;
    readonly source?: 'human' | 'reflex' | 'planner' | 'hybrid';
    readonly strategyStatus?: 'live' | 'fresh' | 'stale' | 'fallback' | 'neutral';
    readonly syncRuntime?: boolean;
    readonly updateTelemetry?: (event: MeshPongTelemetryEvent) => void;
  }
): Promise<boolean> {
  const appliedAtMs = metadata?.appliedAtMs ?? nowMs();
  const currentMatch = matchState ?? (await currentMatchState(nextRefs));
  const result = await nextRefs.matchCoordinator.ask<PongMatchCommandResult>({
    type: 'APPLY_CONTROLLER_INPUT',
    requestSessionId: input.sessionId,
    expectedGeneration: currentMatch.generation,
    input,
  });
  if (!result.ok) {
    setStatus(formatMatchCommandFailure(result));
    return false;
  }
  matchState = result.match;
  if (metadata?.syncRuntime !== false) {
    const flush = metadata?.flushRuntime ?? flushRuntime;
    await flush(nextRuntime);
  }
  const reportTelemetry = metadata?.updateTelemetry ?? updateTelemetry;
  reportTelemetry({
    type: 'controller-intent-applied',
    side: input.side,
    mode: metadata?.mode ?? 'human',
    source: metadata?.source ?? 'human',
    strategyStatus: metadata?.strategyStatus ?? 'live',
    detail: metadata?.detail ?? '--',
    nowMs: appliedAtMs,
    sentAtMs: metadata?.sentAtMs,
  });
  return true;
}

async function applyPaddleInput(
  nextRuntime: BrowserRuntime,
  nextRefs: RuntimeRefs,
  mode: PongShellMatchMode | null
): Promise<boolean> {
  const session = playerSessionState;
  if (!session?.side || normalizePongControllerType(mode?.controllers[session.side]) !== 'human') {
    return true;
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
    return true;
  }

  const input = await nextRefs.playerSession.ask<PongControllerInputResult>({
    type: 'MOVE_CONTROLLER',
    direction,
  });
  if (!input.ok) {
    setStatus(input.reason);
    return false;
  }

  const appliedAtMs = nowMs();
  return applyControllerInput(nextRuntime, nextRefs, input, {
    appliedAtMs,
    detail: direction,
    mode: 'human',
    source: 'human',
    strategyStatus: 'live',
    syncRuntime: true,
  });
}

function formatAimDetail(aim: PongControllerAim): string {
  const target = `t${Math.round(aim.targetY)}`;
  const intercept = aim.interceptY === null ? '' : `/i${Math.round(aim.interceptY)}`;
  const label = aim.strategyLabel ? ` ${aim.strategyLabel}` : '';
  return `${target}${intercept}${label}`;
}

function createEmptyPlannerLaneState(): PlannerControllerLaneState {
  return {
    inFlight: null,
    readyDecision: null,
    lastDecision: null,
    latestAcceptedSequence: 0,
    freshTurnsRemaining: 0,
    staleTurnsRemaining: 0,
  };
}

export function createMeshPongTurnStepper(deps: MeshPongTurnStepperDeps): MeshPongTurnStepper {
  const schedulePolicy = deps.schedulePolicy ?? DEFAULT_MESH_PONG_CONTROLLER_SCHEDULE_POLICY;
  const lanes: Record<PongSide, PlannerControllerLaneState> = {
    left: createEmptyPlannerLaneState(),
    right: createEmptyPlannerLaneState(),
  };
  let active = true;
  let turnInProgress = false;
  let nextRequestId = 1;
  let lastMatchGeneration: number | null = null;

  function resetLane(side: PongSide): void {
    lanes[side] = createEmptyPlannerLaneState();
  }

  function ownsRequest(request: PlannerControllerRequest): boolean {
    const matchState = deps.getMatchState();
    return (
      active &&
      deps.runtime === request.runtime &&
      deps.refs === request.refs &&
      matchState.phase === 'running' &&
      matchState.matchGeneration === request.matchGeneration &&
      shouldLaunchPlannerControllerForSide({
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
      const lane = lanes[side];
      const currentMode = normalizePongControllerType(
        matchState.mode?.controllers[side] ?? 'human'
      );
      const proposalModeChanged =
        (lane.inFlight !== null && lane.inFlight.mode !== currentMode) ||
        (lane.readyDecision !== null && lane.readyDecision.controllerMode !== currentMode) ||
        (lane.lastDecision !== null && lane.lastDecision.controllerMode !== currentMode);
      if (
        !shouldLaunchPlannerControllerForSide({
          browserSessionId: deps.browserSessionId,
          matchOwnerSessionId: matchState.matchOwnerSessionId,
          mode: matchState.mode,
          side,
        }) ||
        proposalModeChanged
      ) {
        resetLane(side);
      }
    }
  }

  async function resolvePlannerControllerInput(request: PlannerControllerRequest): Promise<void> {
    const lane = lanes[request.side];
    try {
      const result =
        request.side === 'left'
          ? await request.refs.controllerLeft.ask<PongControllerResult>(
              {
                type: 'RUN_CONTROLLER',
                snapshot: request.snapshot,
              },
              schedulePolicy.controllerAskTimeoutMs
            )
          : await request.refs.controllerRight.ask<PongControllerResult>(
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
          mode: request.mode,
          nowMs: deps.nowMs(),
          outcome: 'error',
          reason: result.reason,
          strategyStatus: 'error',
          error: formatControllerFailureTelemetryError(result),
        });
        deps.setControllerDiagnostic(result.side, result.reason);
        return;
      }

      if (lane.inFlight?.requestId !== request.requestId) {
        return;
      }

      const completedAtMs = deps.nowMs();
      const currentMatch = deps.getMatchState();
      const proposal: PongAdvisoryProposal = {
        proposalId: request.proposalId,
        correlationId: request.correlationId,
        sequence: request.sequence,
        side: request.side,
        matchGeneration: request.matchGeneration,
        baseTick: request.baseTick,
        ownerSessionId: request.ownerSessionId,
        controllerMode: request.mode,
        requestedAtMs: request.startedAtMs,
        completedAtMs,
        strategy: result.strategy,
      };
      const admission = admitPongAdvisoryProposal(proposal, {
        browserSessionId: deps.browserSessionId,
        matchGeneration: currentMatch.matchGeneration,
        currentTick: currentMatch.currentTick,
        matchOwnerSessionId: currentMatch.matchOwnerSessionId,
        mode: currentMatch.mode,
        nowMs: completedAtMs,
        maxAgeMs: schedulePolicy.plannerProposalMaxAgeMs,
        latestAcceptedSequence: lane.latestAcceptedSequence,
        cancelledProposalIds: [],
      });
      if (!admission.ok) {
        deps.updateTelemetry({
          type: 'controller-request-finished',
          side: result.side,
          mode: request.mode,
          nowMs: completedAtMs,
          outcome: 'rejected',
          reason: admission.reason,
          strategyStatus: 'error',
          error: admission.reason,
        });
        deps.setControllerDiagnostic(result.side, admission.reason);
        return;
      }

      deps.clearControllerDiagnostic(result.side);
      lane.readyDecision = admission.proposal;
      deps.updateTelemetry({
        type: 'controller-request-finished',
        side: result.side,
        mode: request.mode,
        nowMs: completedAtMs,
        outcome: 'ready',
        strategyStatus: 'fresh',
        detail: `t${Math.round(result.strategy.targetY)} ${result.strategy.label}`,
      });
    } catch (error) {
      const errorReason = formatMlxControllerError(error);
      if (!ownsRequest(request)) {
        return;
      }
      deps.updateTelemetry({
        type: 'controller-request-finished',
        side: request.side,
        mode: request.mode,
        nowMs: deps.nowMs(),
        outcome: 'error',
        reason: 'provider-failed',
        strategyStatus: 'error',
        error: errorReason,
      });
      deps.setControllerDiagnostic(request.side, errorReason);
    } finally {
      if (lane.inFlight?.requestId === request.requestId) {
        lane.inFlight = null;
      }
    }
  }

  function launchPlannerControllerInput(
    side: PongSide,
    mode: PongControllerMode,
    controller: ActorRef<PongControllerActorState, ControllerCommand>,
    snapshotState: PongSnapshot,
    matchGenerationValue: number,
    baseTick: number,
    ownerSessionId: string | null
  ): void {
    const lane = lanes[side];
    if (lane.inFlight) {
      return;
    }

    const startedAtMs = deps.nowMs();
    deps.updateTelemetry({ type: 'controller-request-started', side, mode, nowMs: startedAtMs });
    const request: PlannerControllerRequest = {
      requestId: nextRequestId,
      proposalId: `proposal-${side}-${nextRequestId}`,
      correlationId: `controller-${side}-${nextRequestId}`,
      sequence: nextRequestId,
      runtime: deps.runtime,
      refs: deps.refs,
      side,
      mode,
      controller,
      snapshot: snapshotState,
      matchGeneration: matchGenerationValue,
      baseTick,
      ownerSessionId,
      startedAtMs,
    };
    nextRequestId += 1;
    lane.inFlight = request;
    void resolvePlannerControllerInput(request);
  }

  function consumePlannerStrategy(
    side: PongSide,
    mode: PongControllerMode,
    matchGenerationValue: number
  ): {
    readonly strategy: PongPlannerStrategy;
    readonly sentAtMs: number;
    readonly freshness: 'fresh' | 'stale';
  } | null {
    const lane = lanes[side];
    if (lane.readyDecision && lane.readyDecision.matchGeneration === matchGenerationValue) {
      const readyDecision = lane.readyDecision;
      lane.readyDecision = null;
      lane.lastDecision = readyDecision;
      lane.latestAcceptedSequence = readyDecision.sequence;
      lane.freshTurnsRemaining = schedulePolicy.plannerStrategyFreshTurnLimit;
      lane.staleTurnsRemaining = schedulePolicy.plannerStrategyStaleTurnLimit;
    }

    if (!lane.lastDecision || lane.lastDecision.matchGeneration !== matchGenerationValue) {
      return null;
    }

    if (lane.freshTurnsRemaining > 0) {
      lane.freshTurnsRemaining -= 1;
      return {
        strategy: lane.lastDecision.strategy,
        sentAtMs: lane.lastDecision.requestedAtMs,
        freshness: 'fresh',
      };
    }

    if (mode === 'hybrid' && lane.staleTurnsRemaining > 0) {
      lane.staleTurnsRemaining -= 1;
      return {
        strategy: lane.lastDecision.strategy,
        sentAtMs: lane.lastDecision.requestedAtMs,
        freshness: 'stale',
      };
    }

    return null;
  }

  function describePlannerNeutralState(
    side: PongSide,
    matchGenerationValue: number
  ): { readonly detail: string; readonly sentAtMs?: number } {
    const lastDecision = lanes[side].lastDecision;
    if (!lastDecision || lastDecision.matchGeneration !== matchGenerationValue) {
      return { detail: 'neutral' };
    }
    return {
      detail: `neutral ${lastDecision.strategy.label}`,
      sentAtMs: lastDecision.requestedAtMs,
    };
  }

  function resolveAimForMode(
    snapshotState: PongSnapshot,
    side: PongSide,
    mode: PongControllerMode,
    strategy: PongPlannerStrategy | null
  ): PongControllerAim | null {
    if (mode === 'human') {
      return null;
    }
    if (mode === 'reflex') {
      return createReflexControllerAim(snapshotState, side);
    }
    if (mode === 'planner') {
      return strategy ? createMergedControllerAim(snapshotState, side, strategy) : null;
    }
    return createMergedControllerAim(snapshotState, side, strategy);
  }

  function resolveAppliedTelemetry(
    mode: PongControllerMode,
    plannerDecision: {
      readonly strategy: PongPlannerStrategy;
      readonly sentAtMs: number;
      readonly freshness: 'fresh' | 'stale';
    } | null
  ): {
    readonly source: 'human' | 'reflex' | 'planner' | 'hybrid';
    readonly strategyStatus: 'live' | 'fresh' | 'stale' | 'fallback' | 'neutral';
  } {
    if (mode === 'reflex') {
      return { source: 'reflex', strategyStatus: 'live' };
    }
    if (mode === 'planner') {
      return plannerDecision
        ? { source: 'planner', strategyStatus: 'fresh' }
        : { source: 'planner', strategyStatus: 'neutral' };
    }
    if (mode === 'hybrid') {
      if (!plannerDecision) {
        return { source: 'reflex', strategyStatus: 'fallback' };
      }
      return {
        source: 'hybrid',
        strategyStatus: plannerDecision.freshness,
      };
    }
    return { source: 'human', strategyStatus: 'live' };
  }

  async function tick(): Promise<void> {
    const currentTurnMatch = deps.getMatchState();
    const browserSessionId = deps.browserSessionId;
    const matchOwnerSessionId = currentTurnMatch.matchOwnerSessionId;
    const ownsProjection = matchOwnerSessionId === browserSessionId;
    syncLanes(currentTurnMatch);
    if (!active) {
      return;
    }
    if (currentTurnMatch.phase !== 'running') {
      const projectedSnapshot = await deps.snapshot();
      if (!active) {
        return;
      }
      deps.renderSnapshot(projectedSnapshot);
      deps.setStatus(statusForMatchPhase(currentTurnMatch.phase));
      return;
    }

    const scheduledAtMs = deps.nowMs();
    deps.updateTelemetry({ type: 'simulation-scheduled', nowMs: scheduledAtMs });
    if (turnInProgress) {
      deps.updateTelemetry({ type: 'simulation-held', nowMs: deps.nowMs() });
      return;
    }

    turnInProgress = true;
    try {
      const humanInputApplied = await deps.applyHumanInput?.(currentTurnMatch.mode);
      if (humanInputApplied === false || !active) {
        return;
      }
      if (!ownsProjection) {
        const projectedSnapshot = await deps.snapshot();
        if (!active) {
          return;
        }
        deps.renderSnapshot(projectedSnapshot);
        deps.setStatus('projecting');
        return;
      }

      const currentSnapshot = await deps.snapshot();
      const paddles = currentSnapshot.paddles;

      for (const side of ['left', 'right'] as const) {
        const controllerMode = currentTurnMatch.mode?.controllers[side] ?? 'human';
        const normalizedMode = normalizePongControllerType(controllerMode);
        const plannerDecision = usesPlannerController(normalizedMode)
          ? consumePlannerStrategy(side, normalizedMode, currentTurnMatch.matchGeneration)
          : null;
        const aim = resolveAimForMode(
          currentSnapshot,
          side,
          normalizedMode,
          plannerDecision?.strategy ?? null
        );
        if (!aim) {
          if (normalizedMode === 'planner') {
            const neutralState = describePlannerNeutralState(
              side,
              currentTurnMatch.matchGeneration
            );
            deps.updateTelemetry({
              type: 'controller-state-observed',
              side,
              mode: normalizedMode,
              source: 'planner',
              strategyStatus: 'neutral',
              detail: neutralState.detail,
              nowMs: deps.nowMs(),
              sentAtMs: neutralState.sentAtMs,
            });
          }
          continue;
        }
        const intent = resolveControllerIntentForAim(
          side === 'left' ? paddles.left : paddles.right,
          aim,
          plannerDecision?.strategy.maxStep ?? PONG_FIELD.paddleStep
        );
        const appliedTelemetry = resolveAppliedTelemetry(normalizedMode, plannerDecision);
        if (!intent) {
          deps.updateTelemetry({
            type: 'controller-state-observed',
            side,
            mode: normalizedMode,
            source: appliedTelemetry.source,
            strategyStatus: appliedTelemetry.strategyStatus,
            detail: formatAimDetail(aim),
            nowMs: deps.nowMs(),
            sentAtMs: plannerDecision?.sentAtMs,
          });
          continue;
        }
        const input: Extract<PongControllerInputResult, { readonly ok: true }> =
          normalizedMode === 'human'
            ? {
                ok: true,
                sessionId: deps.browserSessionId,
                side,
                direction: intent.direction,
                amount: intent.amount,
              }
            : createSyntheticPlannerControllerInput(side, intent);
        const detail = formatAimDetail(aim);
        const applied = await applyControllerInput(deps.runtime, deps.refs, input, {
          appliedAtMs: deps.nowMs(),
          detail,
          mode: normalizedMode,
          sentAtMs: plannerDecision?.sentAtMs,
          source: appliedTelemetry.source,
          strategyStatus: appliedTelemetry.strategyStatus,
          syncRuntime: false,
          updateTelemetry: deps.updateTelemetry,
        });
        if (!applied) {
          return;
        }
        deps.postControllerInput(input, {
          detail,
          mode: normalizedMode,
          source: appliedTelemetry.source,
          strategyStatus: appliedTelemetry.strategyStatus,
        });
      }

      const coordinatorState = await currentMatchState(deps.refs);
      const tickResult = await deps.refs.matchCoordinator.ask<PongMatchCommandResult>({
        type: 'TICK_MATCH',
        requestSessionId: deps.browserSessionId,
        expectedGeneration: coordinatorState.generation,
      });
      if (!tickResult.ok) {
        deps.setStatus(formatMatchCommandFailure(tickResult));
        return;
      }
      matchState = tickResult.match;
      await deps.flushRuntime(deps.runtime);
      deps.updateTelemetry({ type: 'simulation-applied', nowMs: deps.nowMs() });
      const nextSnapshot = tickResult.match.snapshot;
      if (!active) {
        return;
      }

      deps.renderSnapshot(nextSnapshot);
      deps.setStatus(statusForMatchPhase(tickResult.match.phase));

      const refreshedMatchState = deps.getMatchState();
      syncLanes(refreshedMatchState);
      for (const side of ['left', 'right'] as const) {
        const controllerMode = normalizePongControllerType(
          refreshedMatchState.mode?.controllers[side] ?? 'human'
        );
        if (
          shouldLaunchPlannerControllerForSide({
            browserSessionId: deps.browserSessionId,
            matchOwnerSessionId: refreshedMatchState.matchOwnerSessionId,
            mode: refreshedMatchState.mode,
            side,
          })
        ) {
          launchPlannerControllerInput(
            side,
            controllerMode,
            side === 'left' ? deps.refs.controllerLeft : deps.refs.controllerRight,
            nextSnapshot,
            refreshedMatchState.matchGeneration,
            refreshedMatchState.currentTick,
            refreshedMatchState.matchOwnerSessionId
          );
        }
      }
    } catch (error) {
      deps.setStatus(error instanceof Error ? error.message : 'runtime error');
    } finally {
      turnInProgress = false;
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
    const refreshedMatch = await currentMatchState(currentRefs);
    if (!isCurrentRuntimeContext(currentRuntime, currentRefs)) {
      return;
    }
    applyProjectedMatch(refreshedMatch, { renderSnapshot: false, renderStatus: false });
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
  const currentWorkflow = workflowSource;
  if (!currentRuntime || !currentRefs || !currentWorkflow) {
    return;
  }

  await currentWorkflow.refresh();
  if (!isCurrentWorkflowRuntimeContext(currentRuntime, currentRefs, currentWorkflow)) {
    return;
  }
  let room = currentWorkflow.snapshot().context.room;
  if (!room || room.phase === 'empty') {
    const created = await currentWorkflow.send({ type: 'CREATE_ROOM', code: 'MESH' });
    if (!isCurrentWorkflowRuntimeContext(currentRuntime, currentRefs, currentWorkflow)) {
      return;
    }
    if (!isPongRoomResult(created)) {
      setStatus('workflow create projection failed');
      return;
    }
    if (!created.ok && created.reason !== 'already-created') {
      setStatus(created.reason);
      return;
    }
    await currentWorkflow.refresh();
    if (!isCurrentWorkflowRuntimeContext(currentRuntime, currentRefs, currentWorkflow)) {
      return;
    }
    room = currentWorkflow.snapshot().context.room;
  }
  if (!room?.members.some((member) => member.sessionId === browserSessionId)) {
    const joined = await currentWorkflow.send({ type: 'JOIN_ROOM' });
    if (!isCurrentWorkflowRuntimeContext(currentRuntime, currentRefs, currentWorkflow)) {
      return;
    }
    if (!isPongRoomResult(joined)) {
      setStatus('workflow join projection failed');
      return;
    }
    if (!joined.ok) {
      setStatus(joined.reason);
      return;
    }
  }
  const claimed = await currentWorkflow.send({ type: 'CLAIM_SEAT', side, controller: 'human' });
  if (!isCurrentWorkflowRuntimeContext(currentRuntime, currentRefs, currentWorkflow)) {
    return;
  }
  if (!isPongRoomResult(claimed)) {
    setStatus('workflow seat projection failed');
    return;
  }
  if (!claimed.ok) {
    setStatus(claimed.reason);
    return;
  }

  await currentRefs.playerSession.send({
    type: 'CLAIM_SIDE',
    side,
    controller: 'human',
  });
  if (!isCurrentWorkflowRuntimeContext(currentRuntime, currentRefs, currentWorkflow)) {
    return;
  }
  await flushRuntime(currentRuntime);
  if (!isCurrentWorkflowRuntimeContext(currentRuntime, currentRefs, currentWorkflow)) {
    return;
  }
  const synced = await syncCurrentSession(currentRuntime, currentRefs, {
    shouldApply: () =>
      isCurrentWorkflowRuntimeContext(currentRuntime, currentRefs, currentWorkflow),
    restoreAuthoritative: false,
  });
  if (!isCurrentWorkflowRuntimeContext(currentRuntime, currentRefs, currentWorkflow)) {
    return;
  }
  if (!synced.ok) {
    if (synced.status) {
      setStatus(synced.status);
    }
    return;
  }
  setStatus('claimed');
}

async function markReady(): Promise<void> {
  const currentRuntime = runtime;
  const currentRefs = refs;
  const currentWorkflow = workflowSource;
  if (!currentRuntime || !currentRefs || !currentWorkflow) {
    return;
  }

  const roomReady = await currentWorkflow.send({ type: 'SET_READY', ready: true });
  if (!isCurrentWorkflowRuntimeContext(currentRuntime, currentRefs, currentWorkflow)) {
    return;
  }
  if (!isPongRoomResult(roomReady)) {
    setStatus('workflow readiness projection failed');
    return;
  }
  if (!roomReady.ok) {
    setStatus(roomReady.reason);
    return;
  }

  await currentRefs.playerSession.send({ type: 'SET_READY', ready: true });
  if (!isCurrentWorkflowRuntimeContext(currentRuntime, currentRefs, currentWorkflow)) {
    return;
  }
  await flushRuntime(currentRuntime);
  if (!isCurrentWorkflowRuntimeContext(currentRuntime, currentRefs, currentWorkflow)) {
    return;
  }
  const synced = await syncCurrentSession(currentRuntime, currentRefs, {
    shouldApply: () =>
      isCurrentWorkflowRuntimeContext(currentRuntime, currentRefs, currentWorkflow),
    restoreAuthoritative: false,
  });
  if (!isCurrentWorkflowRuntimeContext(currentRuntime, currentRefs, currentWorkflow)) {
    return;
  }
  if (!synced.ok) {
    if (synced.status) {
      setStatus(synced.status);
    }
    return;
  }
  setStatus('ready');
}

function formatMatchCommandFailure(
  result: Exclude<PongMatchCommandResult, { readonly ok: true }>
): string {
  if ('missing' in result) {
    return `${result.reason}: ${result.missing.join(', ')}`;
  }
  if ('actualGeneration' in result) {
    return `${result.reason}: expected ${result.expectedGeneration}, actual ${result.actualGeneration}`;
  }
  return result.reason;
}

async function startMatch(
  mode: PongShellMatchMode,
  ownerSessionId: string = browserSessionId
): Promise<void> {
  const currentRuntime = runtime;
  const currentRefs = refs;
  const currentWorkflow = workflowSource;
  if (!currentRuntime || !currentRefs || !currentWorkflow) {
    return;
  }

  clearControllerDiagnostics();
  const roomStart = await currentWorkflow.send({ type: 'BEGIN_MATCH' });
  if (!isCurrentWorkflowRuntimeContext(currentRuntime, currentRefs, currentWorkflow)) {
    return;
  }
  if (!isPongRoomResult(roomStart)) {
    setStatus('workflow start projection failed');
    return;
  }
  if (!roomStart.ok) {
    setStatus(roomStart.reason);
    return;
  }
  const synced = await syncMatchForMode(currentRuntime, currentRefs, mode, () =>
    isCurrentWorkflowRuntimeContext(currentRuntime, currentRefs, currentWorkflow)
  );
  if (!synced || !isCurrentWorkflowRuntimeContext(currentRuntime, currentRefs, currentWorkflow)) {
    return;
  }
  const currentMatch = await currentMatchState(currentRefs);
  if (!isCurrentWorkflowRuntimeContext(currentRuntime, currentRefs, currentWorkflow)) {
    return;
  }
  const result = await currentRefs.matchCoordinator.ask<PongMatchCommandResult>({
    type: 'START_MATCH',
    requestSessionId: ownerSessionId,
    expectedGeneration: currentMatch.generation,
    mode: toLegacyMatchMode(mode),
  });
  if (!isCurrentWorkflowRuntimeContext(currentRuntime, currentRefs, currentWorkflow)) {
    return;
  }
  await flushRuntime(currentRuntime);
  if (!isCurrentWorkflowRuntimeContext(currentRuntime, currentRefs, currentWorkflow)) {
    return;
  }
  const projectedMatch = await currentMatchState(currentRefs);
  if (!isCurrentWorkflowRuntimeContext(currentRuntime, currentRefs, currentWorkflow)) {
    return;
  }
  applyProjectedMatch(projectedMatch, { renderStatus: false });
  if (!result.ok) {
    setStatus(formatMatchCommandFailure(result));
    return;
  }

  applyProjectedMatch(result.match);
  ensureProjectionLoop();
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
  startButtonElement.disabled = true;
  resetButtonElement = queryRequired<HTMLButtonElement>(document, '#reset-game');
  modeValueElement = queryRequired<HTMLElement>(document, '#mode-value');
  scoreValueElement = queryRequired<HTMLElement>(document, '#score-value');
  statusValueElement = queryRequired<HTMLElement>(document, '#status-value');
  sessionValueElement = queryRequired<HTMLElement>(document, '#session-value');
  sideValueElement = queryRequired<HTMLElement>(document, '#side-value');
  lobbyValueElement = queryRequired<HTMLElement>(document, '#lobby-value');
  workflowRootElement = queryRequired<HTMLElement>(document, '#workflow-screen');
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
  installControllerVocabulary(leftControllerSelectElement, 'left');
  installControllerVocabulary(rightControllerSelectElement, 'right');
  playerCountSelectElement.value = String(TWO_HUMAN_PONG_MATCH_MODE.playerCount);
  leftControllerSelectElement.value = normalizePongControllerType(
    TWO_HUMAN_PONG_MATCH_MODE.controllers.left
  );
  rightControllerSelectElement.value = normalizePongControllerType(
    TWO_HUMAN_PONG_MATCH_MODE.controllers.right
  );
  renderPlayerSession(null);
  resetTelemetry();

  modeSelectElement.addEventListener('change', () => {
    const mode = resolveBrowserModeSelection(modeSelectElement.value, selectedMode);
    modeSelectElement.value = mode;
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

  for (const select of [
    playerCountSelectElement,
    leftControllerSelectElement,
    rightControllerSelectElement,
  ]) {
    select.addEventListener('change', () => {
      if (matchState) {
        renderLobby(matchState);
      }
    });
  }

  startButtonElement.addEventListener('click', () => {
    void startMatch(selectedMatchMode()).catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : 'start failed');
    });
  });

  resetButtonElement.addEventListener('click', () => {
    void resetGame().catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : 'reset failed');
    });
  });
  resetButtonElement.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    void returnToRoom().catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : 'return failed');
    });
  });

  window.addEventListener('keydown', (event) => {
    keys.add(event.key.toLowerCase());
  });

  window.addEventListener('keyup', (event) => {
    keys.delete(event.key.toLowerCase());
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
