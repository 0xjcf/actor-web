import { defineBehavior } from '@actor-web/runtime/browser';
import {
  advanceBall,
  type BallCommand,
  type BallEvent,
  createInitialBallContext,
  createInitialPaddle,
  createInitialScore,
  DEFAULT_PONG_SEED,
  movePaddle,
  type PaddleCommand,
  type PaddleEvent,
  PONG_FIELD,
  type PongBallContext,
  type PongPaddleState,
  type PongScoreState,
  type PongSide,
  type ScoreCommand,
  type ScoreEvent,
  setPaddle,
} from './pong-contract';

export const ballBehavior = defineBehavior<BallCommand, BallEvent>()
  .withContext(createInitialBallContext(DEFAULT_PONG_SEED))
  .onMessage(({ message, actor }) => {
    const context = actor.getSnapshot().context as PongBallContext;

    if (message.type === 'GET_BALL') {
      return { reply: context };
    }

    if (message.type === 'RESET_BALL') {
      const nextContext = createInitialBallContext(message.seed ?? DEFAULT_PONG_SEED);
      return {
        context: nextContext,
        emit: [{ type: 'BALL_MOVED' as const, ball: nextContext.ball }],
      };
    }

    if (message.type === 'SET_PADDLES') {
      return {
        context: {
          ...context,
          leftPaddleY: message.leftY,
          rightPaddleY: message.rightY,
        },
      };
    }

    const iterations = Math.max(1, Math.min(10, Math.trunc(message.count ?? 1)));
    let nextContext = context;
    const events: BallEvent[] = [];
    for (let index = 0; index < iterations; index += 1) {
      const result = advanceBall(nextContext);
      nextContext = result.context;
      events.push(...result.events);
    }

    return {
      context: nextContext,
      emit: events,
    };
  })
  .build();

export function createPaddleBehavior(side: PongSide) {
  return defineBehavior<PaddleCommand, PaddleEvent>()
    .withContext(createInitialPaddle(side))
    .onMessage(({ message, actor }) => {
      const context = actor.getSnapshot().context as PongPaddleState;

      if (message.type === 'GET_PADDLE') {
        return { reply: context };
      }

      const paddle =
        message.type === 'SET_PADDLE'
          ? setPaddle(context, message.y)
          : movePaddle(context, message.direction, message.amount ?? PONG_FIELD.paddleStep);

      return {
        context: paddle,
        emit: [{ type: 'PADDLE_MOVED' as const, paddle }],
      };
    })
    .build();
}

export const scoreBehavior = defineBehavior<ScoreCommand, ScoreEvent>()
  .withContext(createInitialScore())
  .onMessage(({ message, actor }) => {
    const context = actor.getSnapshot().context as PongScoreState;

    if (message.type === 'GET_SCORE') {
      return { reply: context };
    }

    if (message.type === 'RESET_SCORE') {
      const score = createInitialScore();
      return {
        context: score,
        emit: [{ type: 'SCORE_RESET' as const, score }],
      };
    }

    const score: PongScoreState = {
      left: message.point.left,
      right: message.point.right,
      sequence: [...context.sequence, message.point],
    };

    return {
      context: score,
      reply: score,
      emit: [{ type: 'SCORE_CHANGED' as const, score, point: message.point }],
    };
  })
  .build();
