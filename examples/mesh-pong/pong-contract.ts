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

export interface PongScoreState {
  readonly left: number;
  readonly right: number;
  readonly sequence: readonly PongScorePoint[];
}

export interface PongBallContext {
  readonly ball: PongBallState;
  readonly leftPaddleY: number;
  readonly rightPaddleY: number;
  readonly score: PongScoreState;
  readonly tick: number;
}

export type BallCommand =
  | { readonly type: 'RESET_BALL'; readonly seed?: number }
  | { readonly type: 'SET_PADDLES'; readonly leftY: number; readonly rightY: number }
  | { readonly type: 'TICK'; readonly count?: number }
  | { readonly type: 'GET_BALL' };

export type BallEvent =
  | { readonly type: 'BALL_MOVED'; readonly ball: PongBallState }
  | { readonly type: 'SCORED'; readonly point: PongScorePoint; readonly ball: PongBallState };

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

export function clampPaddleY(y: number): number {
  return Math.max(0, Math.min(PONG_FIELD.height - PONG_FIELD.paddleHeight, y));
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
    score: createInitialScore(),
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
  const withinLeftPaddle =
    nextBall.y >= context.leftPaddleY &&
    nextBall.y <= context.leftPaddleY + PONG_FIELD.paddleHeight;
  const withinRightPaddle =
    nextBall.y >= context.rightPaddleY &&
    nextBall.y <= context.rightPaddleY + PONG_FIELD.paddleHeight;

  if (nextBall.vx < 0 && nextBall.x - nextBall.radius <= leftPaddleRight && withinLeftPaddle) {
    nextBall = {
      ...nextBall,
      x: leftPaddleRight + nextBall.radius,
      vx: Math.abs(nextBall.vx),
    };
  }

  if (nextBall.vx > 0 && nextBall.x + nextBall.radius >= rightPaddleLeft && withinRightPaddle) {
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

  const point: PongScorePoint = {
    scorer,
    left: context.score.left + (scorer === 'left' ? 1 : 0),
    right: context.score.right + (scorer === 'right' ? 1 : 0),
    rally: nextBall.rally,
    tick,
  };
  const nextScore: PongScoreState = {
    left: point.left,
    right: point.right,
    sequence: [...context.score.sequence, point],
  };
  const resetDirection: 1 | -1 = scorer === 'left' ? -1 : 1;
  const resetBall = createInitialBall(context.ball.seed + tick, resetDirection);
  const nextContext = {
    ...context,
    ball: resetBall,
    score: nextScore,
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
