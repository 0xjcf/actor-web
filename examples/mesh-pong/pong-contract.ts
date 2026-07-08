export const DEFAULT_PONG_SEED = 42;

export const PONG_FIELD = {
  width: 640,
  height: 360,
  paddleMargin: 32,
  paddleWidth: 12,
  paddleHeight: 82,
  paddleStep: 28,
  ballRadius: 8,
  ballSpeedX: 42,
  ballSpeedY: 7,
} as const;

export const PONG_NODE_ADDRESSES = {
  server: 'pong-server',
  a: 'pong-a',
  b: 'pong-b',
} as const;

export type PongSide = 'left' | 'right';
export type PongTransportMode = 'local' | 'broadcast' | 'websocket' | 'mesh';

export interface PongBallState {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly radius: number;
  readonly rally: number;
  readonly seed: number;
}

export interface PongPaddleState {
  readonly side: PongSide;
  readonly y: number;
  readonly height: number;
}

export interface PongScorePoint {
  readonly scorer: PongSide;
  readonly left: number;
  readonly right: number;
  readonly rally: number;
  readonly tick: number;
}

export interface PongScoredSignal {
  readonly scorer: PongSide;
  readonly rally: number;
  readonly tick: number;
}

export interface PongScoreState {
  readonly left: number;
  readonly right: number;
  readonly sequence: readonly PongScorePoint[];
}

export interface PongBallContext {
  readonly ball: PongBallState;
  readonly leftPaddleY: number;
  readonly rightPaddleY: number;
  readonly tick: number;
}

export type BallCommand =
  | { readonly type: 'RESET_BALL'; readonly seed?: number }
  | { readonly type: 'SET_PADDLES'; readonly leftY: number; readonly rightY: number }
  | { readonly type: 'TICK'; readonly count?: number }
  | { readonly type: 'GET_BALL' };

export type BallEvent =
  | { readonly type: 'BALL_MOVED'; readonly ball: PongBallState }
  | { readonly type: 'SCORED'; readonly point: PongScoredSignal; readonly ball: PongBallState };

export type PaddleCommand =
  | { readonly type: 'MOVE_PADDLE'; readonly direction: 'up' | 'down'; readonly amount?: number }
  | { readonly type: 'SET_PADDLE'; readonly y: number }
  | { readonly type: 'GET_PADDLE' };

export type PaddleEvent = {
  readonly type: 'PADDLE_MOVED';
  readonly paddle: PongPaddleState;
};

export type ScoreCommand =
  | { readonly type: 'RESET_SCORE' }
  | { readonly type: 'GET_SCORE' }
  | Extract<BallEvent, { readonly type: 'SCORED' }>;

export type ScoreEvent =
  | {
      readonly type: 'SCORE_CHANGED';
      readonly score: PongScoreState;
      readonly point: PongScorePoint;
    }
  | { readonly type: 'SCORE_RESET'; readonly score: PongScoreState };

export interface PongSnapshot {
  readonly ball: PongBallState;
  readonly paddles: {
    readonly left: PongPaddleState;
    readonly right: PongPaddleState;
  };
  readonly score: PongScoreState;
}

export interface PongControllerIntent {
  readonly side: PongSide;
  readonly direction: 'up' | 'down';
  readonly amount: number;
}

export type PongControllerResult =
  | ({
      readonly ok: true;
      readonly provider: 'llm';
    } & PongControllerIntent)
  | {
      readonly ok: false;
      readonly side: PongSide;
      readonly reason: 'llm-unavailable' | 'provider-failed' | 'invalid-response';
      readonly error: {
        readonly code: string;
        readonly message: string;
      };
    };

export interface PongControllerActorState {
  readonly side: PongSide;
  readonly lastResult: PongControllerResult | null;
}

export type ControllerCommand =
  | { readonly type: 'GET_CONTROLLER' }
  | { readonly type: 'RUN_CONTROLLER'; readonly snapshot: PongSnapshot };

export type PongControllerType = 'human' | 'mlx';
export type PongPlayerCount = 1 | 2;

export interface PongMatchMode {
  readonly playerCount: PongPlayerCount;
  readonly controllers: Record<PongSide, PongControllerType>;
}

export interface PongMatchControllerAuthority {
  readonly browserSessionId: string;
  readonly matchOwnerSessionId: string | null;
  readonly mode: PongMatchMode | null;
  readonly side: PongSide;
}

export interface PongPlayerSessionParams {
  readonly sessionId: string;
}

export interface PongPlayerSessionState {
  readonly sessionId: string;
  readonly controller: PongControllerType;
  readonly side: PongSide | null;
  readonly ready: boolean;
}

export interface PongControllerSlot {
  readonly sessionId: string;
  readonly controller: PongControllerType;
  readonly side: PongSide;
  readonly ready: boolean;
}

export type PongMatchStartResult =
  | {
      readonly ok: true;
      readonly mode: PongMatchMode;
      readonly controllers: readonly PongControllerSlot[];
    }
  | {
      readonly ok: false;
      readonly reason: 'missing-controller' | 'controller-not-ready' | 'invalid-command';
      readonly missing: readonly PongSide[];
    };

export type PongControllerInputResult =
  | {
      readonly ok: true;
      readonly sessionId: string;
      readonly side: PongSide;
      readonly direction: 'up' | 'down';
      readonly amount: number;
    }
  | {
      readonly ok: false;
      readonly sessionId: string;
      readonly reason: 'side-unclaimed' | 'invalid-command';
    };

export interface PongLobbyState {
  readonly sessions: readonly PongPlayerSessionState[];
  readonly controllers: readonly PongControllerSlot[];
  readonly started: boolean;
  readonly mode: PongMatchMode | null;
  readonly lastStart: PongMatchStartResult | null;
}

export type PlayerSessionCommand =
  | { readonly type: 'GET_SESSION' }
  | {
      readonly type: 'CLAIM_SIDE';
      readonly side: PongSide;
      readonly controller?: PongControllerType;
    }
  | { readonly type: 'SET_READY'; readonly ready: boolean }
  | {
      readonly type: 'MOVE_CONTROLLER';
      readonly direction: 'up' | 'down';
      readonly amount?: number;
    };

export type PlayerSessionEvent =
  | { readonly type: 'PLAYER_SESSION_CHANGED'; readonly session: PongPlayerSessionState }
  | {
      readonly type: 'PADDLE_INPUT';
      readonly input: Extract<PongControllerInputResult, { readonly ok: true }>;
    };

export type PongLobbyCommand =
  | { readonly type: 'GET_LOBBY' }
  | { readonly type: 'RESET_LOBBY' }
  | { readonly type: 'SYNC_SESSION'; readonly session: PongPlayerSessionState }
  | { readonly type: 'REMOVE_SESSION'; readonly sessionId: string }
  | { readonly type: 'START_MATCH'; readonly mode: PongMatchMode };

export type PongLobbyEvent =
  | { readonly type: 'LOBBY_CHANGED'; readonly lobby: PongLobbyState }
  | {
      readonly type: 'MATCH_STARTED';
      readonly mode: PongMatchMode;
      readonly controllers: readonly PongControllerSlot[];
    }
  | {
      readonly type: 'MATCH_START_REJECTED';
      readonly result: Exclude<PongMatchStartResult, { ok: true }>;
    };

const PONG_SIDES: readonly PongSide[] = ['left', 'right'];

export const TWO_HUMAN_PONG_MATCH_MODE: PongMatchMode = {
  playerCount: 2,
  controllers: {
    left: 'human',
    right: 'human',
  },
};

export function clampPaddleY(y: number): number {
  return Math.max(0, Math.min(PONG_FIELD.height - PONG_FIELD.paddleHeight, y));
}

export function createPlayerSessionActorId(params: PongPlayerSessionParams): string {
  const safeSessionId = params.sessionId
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `player-session-${safeSessionId || 'anonymous'}`;
}

export function createInitialPlayerSession(sessionId: string): PongPlayerSessionState {
  return {
    sessionId,
    controller: 'human',
    side: null,
    ready: false,
  };
}

export function claimPlayerSessionSide(
  session: PongPlayerSessionState,
  side: PongSide,
  controller: PongControllerType = 'human'
): PongPlayerSessionState {
  return {
    ...session,
    controller,
    side,
    ready: session.side === side && session.controller === controller ? session.ready : false,
  };
}

export function setPlayerSessionReady(
  session: PongPlayerSessionState,
  ready: boolean
): PongPlayerSessionState {
  return {
    ...session,
    ready: Boolean(session.side && ready),
  };
}

export function createPlayerSessionInput(
  session: PongPlayerSessionState,
  direction: 'up' | 'down',
  amount: number = PONG_FIELD.paddleStep
): PongControllerInputResult {
  if (!session.side) {
    return {
      ok: false,
      sessionId: session.sessionId,
      reason: 'side-unclaimed',
    };
  }

  return {
    ok: true,
    sessionId: session.sessionId,
    side: session.side,
    direction,
    amount,
  };
}

export function createInitialLobby(): PongLobbyState {
  return {
    sessions: [],
    controllers: [],
    started: false,
    mode: null,
    lastStart: null,
  };
}

export function shouldLaunchMlxControllerForSide(authority: PongMatchControllerAuthority): boolean {
  return (
    authority.matchOwnerSessionId === authority.browserSessionId &&
    authority.mode?.controllers[authority.side] === 'mlx'
  );
}

export function createMlxSessionId(side: PongSide): string {
  return `mlx-${side}`;
}

export function createSyntheticMlxControllerInput(
  result: Extract<PongControllerResult, { readonly ok: true }>
): Extract<PongControllerInputResult, { readonly ok: true }> {
  return {
    ok: true,
    sessionId: createMlxSessionId(result.side),
    side: result.side,
    direction: result.direction,
    amount: result.amount,
  };
}

function resolveControllerSlots(
  sessions: readonly PongPlayerSessionState[]
): readonly PongControllerSlot[] {
  const slots = new Map<PongSide, PongControllerSlot>();
  for (const session of sessions) {
    if (!session.side) {
      continue;
    }
    slots.set(session.side, {
      sessionId: session.sessionId,
      controller: session.controller,
      side: session.side,
      ready: session.ready,
    });
  }

  return PONG_SIDES.flatMap((side) => {
    const slot = slots.get(side);
    return slot ? [slot] : [];
  });
}

export function syncLobbySession(
  lobby: PongLobbyState,
  session: PongPlayerSessionState
): PongLobbyState {
  const sessions = [
    ...lobby.sessions.filter((candidate) => candidate.sessionId !== session.sessionId),
    session,
  ];
  const controllers = resolveControllerSlots(sessions);
  return {
    ...lobby,
    sessions,
    controllers,
  };
}

export function syncLobbySessionsFromStorage(
  lobby: PongLobbyState,
  storedSessions: readonly PongPlayerSessionState[]
): PongLobbyState {
  const sessions = [...storedSessions];
  if (lobby.started && lobby.mode) {
    for (const side of PONG_SIDES) {
      if (lobby.mode.controllers[side] !== 'mlx') {
        continue;
      }
      sessions.push({
        sessionId: createMlxSessionId(side),
        controller: 'mlx',
        side,
        ready: true,
      });
    }
  }

  const controllers = resolveControllerSlots(sessions);
  return {
    ...lobby,
    sessions,
    controllers,
  };
}

export function removeLobbySession(lobby: PongLobbyState, sessionId: string): PongLobbyState {
  const sessions = lobby.sessions.filter((session) => session.sessionId !== sessionId);
  const controllers = resolveControllerSlots(sessions);
  return {
    ...lobby,
    sessions,
    controllers,
  };
}

export function startLobbyMatch(
  lobby: PongLobbyState,
  mode: PongMatchMode
): { readonly lobby: PongLobbyState; readonly result: PongMatchStartResult } {
  const missing = PONG_SIDES.filter((side) => {
    const slot = lobby.controllers.find((controller) => controller.side === side);
    return !slot || slot.controller !== mode.controllers[side];
  });
  if (missing.length > 0) {
    const result: PongMatchStartResult = {
      ok: false,
      reason: 'missing-controller',
      missing,
    };
    return {
      lobby,
      result,
    };
  }

  const notReady = PONG_SIDES.filter((side) => {
    const slot = lobby.controllers.find((controller) => controller.side === side);
    return !slot?.ready;
  });
  if (notReady.length > 0) {
    const result: PongMatchStartResult = {
      ok: false,
      reason: 'controller-not-ready',
      missing: notReady,
    };
    return {
      lobby,
      result,
    };
  }

  const controllers = PONG_SIDES.map((side) =>
    lobby.controllers.find((controller) => controller.side === side)
  ).filter((controller): controller is PongControllerSlot => Boolean(controller));
  const result: PongMatchStartResult = {
    ok: true,
    mode,
    controllers,
  };
  return {
    lobby: {
      ...lobby,
      started: true,
      mode,
      lastStart: result,
    },
    result,
  };
}

export function createInitialPaddle(side: PongSide): PongPaddleState {
  return {
    side,
    y: PONG_FIELD.height / 2 - PONG_FIELD.paddleHeight / 2,
    height: PONG_FIELD.paddleHeight,
  };
}

export function createInitialScore(): PongScoreState {
  return {
    left: 0,
    right: 0,
    sequence: [],
  };
}

export function createInitialBall(seed = DEFAULT_PONG_SEED, direction?: 1 | -1): PongBallState {
  const resolvedDirection = direction ?? (seed % 2 === 0 ? -1 : 1);
  const lane = seed % 8;
  const y = 48 + lane * 30;
  const verticalDirection = seed % 3 === 0 ? -1 : 1;

  return {
    x: PONG_FIELD.width / 2,
    y,
    vx: resolvedDirection * PONG_FIELD.ballSpeedX,
    vy: verticalDirection * (PONG_FIELD.ballSpeedY + (seed % 4)),
    radius: PONG_FIELD.ballRadius,
    rally: 0,
    seed,
  };
}

export function createInitialBallContext(seed = DEFAULT_PONG_SEED): PongBallContext {
  const paddle = createInitialPaddle('left');
  return {
    ball: createInitialBall(seed),
    leftPaddleY: paddle.y,
    rightPaddleY: paddle.y,
    tick: 0,
  };
}

export function movePaddle(
  paddle: PongPaddleState,
  direction: 'up' | 'down',
  amount: number
): PongPaddleState {
  return {
    ...paddle,
    y: clampPaddleY(paddle.y + (direction === 'up' ? -amount : amount)),
  };
}

export function setPaddle(paddle: PongPaddleState, y: number): PongPaddleState {
  return {
    ...paddle,
    y: clampPaddleY(y),
  };
}

export interface AdvanceBallResult {
  readonly context: PongBallContext;
  readonly events: readonly BallEvent[];
}

export function advanceBall(context: PongBallContext): AdvanceBallResult {
  const tick = context.tick + 1;
  const ball = context.ball;
  let nextBall: PongBallState = {
    ...ball,
    x: ball.x + ball.vx,
    y: ball.y + ball.vy,
    rally: ball.rally + 1,
  };

  if (nextBall.y - nextBall.radius <= 0 || nextBall.y + nextBall.radius >= PONG_FIELD.height) {
    nextBall = {
      ...nextBall,
      y: Math.max(nextBall.radius, Math.min(PONG_FIELD.height - nextBall.radius, nextBall.y)),
      vy: -nextBall.vy,
    };
  }

  const leftPaddleRight = PONG_FIELD.paddleMargin + PONG_FIELD.paddleWidth;
  const rightPaddleLeft = PONG_FIELD.width - PONG_FIELD.paddleMargin - PONG_FIELD.paddleWidth;
  const crossedLeftPaddleFace =
    ball.x - ball.radius >= leftPaddleRight && nextBall.x - nextBall.radius <= leftPaddleRight;
  const crossedRightPaddleFace =
    ball.x + ball.radius <= rightPaddleLeft && nextBall.x + nextBall.radius >= rightPaddleLeft;
  const withinLeftPaddle =
    nextBall.y >= context.leftPaddleY &&
    nextBall.y <= context.leftPaddleY + PONG_FIELD.paddleHeight;
  const withinRightPaddle =
    nextBall.y >= context.rightPaddleY &&
    nextBall.y <= context.rightPaddleY + PONG_FIELD.paddleHeight;

  if (nextBall.vx < 0 && crossedLeftPaddleFace && withinLeftPaddle) {
    nextBall = {
      ...nextBall,
      x: leftPaddleRight + nextBall.radius,
      vx: Math.abs(nextBall.vx),
    };
  }

  if (nextBall.vx > 0 && crossedRightPaddleFace && withinRightPaddle) {
    nextBall = {
      ...nextBall,
      x: rightPaddleLeft - nextBall.radius,
      vx: -Math.abs(nextBall.vx),
    };
  }

  const scorer =
    nextBall.x + nextBall.radius < 0
      ? 'right'
      : nextBall.x - nextBall.radius > PONG_FIELD.width
        ? 'left'
        : null;

  if (!scorer) {
    const nextContext = { ...context, ball: nextBall, tick };
    return {
      context: nextContext,
      events: [{ type: 'BALL_MOVED', ball: nextBall }],
    };
  }

  const point: PongScoredSignal = {
    scorer,
    rally: nextBall.rally,
    tick,
  };
  const resetDirection: 1 | -1 = scorer === 'left' ? -1 : 1;
  const resetBall = createInitialBall(context.ball.seed + tick, resetDirection);
  const nextContext = {
    ...context,
    ball: resetBall,
    tick,
  };

  return {
    context: nextContext,
    events: [
      { type: 'SCORED', point, ball: resetBall },
      { type: 'BALL_MOVED', ball: resetBall },
    ],
  };
}
