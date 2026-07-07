import { defineBehavior } from '@actor-web/runtime/browser';
import {
  advanceBall,
  type BallCommand,
  type BallEvent,
  claimPlayerSessionSide,
  createInitialBallContext,
  createInitialLobby,
  createInitialPaddle,
  createInitialPlayerSession,
  createInitialScore,
  createPlayerSessionInput,
  DEFAULT_PONG_SEED,
  movePaddle,
  type PaddleCommand,
  type PaddleEvent,
  type PlayerSessionCommand,
  type PlayerSessionEvent,
  PONG_FIELD,
  type PongBallContext,
  type PongLobbyCommand,
  type PongLobbyEvent,
  type PongLobbyState,
  type PongPaddleState,
  type PongPlayerSessionParams,
  type PongPlayerSessionState,
  type PongScoreState,
  type PongSide,
  removeLobbySession,
  type ScoreCommand,
  type ScoreEvent,
  setPaddle,
  setPlayerSessionReady,
  startLobbyMatch,
  syncLobbySession,
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

    const point = {
      ...message.point,
      left: context.left + (message.point.scorer === 'left' ? 1 : 0),
      right: context.right + (message.point.scorer === 'right' ? 1 : 0),
    };
    const score: PongScoreState = {
      left: point.left,
      right: point.right,
      sequence: [...context.sequence, point],
    };

    return {
      context: score,
      reply: score,
      emit: [{ type: 'SCORE_CHANGED' as const, score, point }],
    };
  })
  .build();

export function createPlayerSessionBehavior(params: PongPlayerSessionParams) {
  return defineBehavior<PlayerSessionCommand, PlayerSessionEvent>()
    .withContext(createInitialPlayerSession(params.sessionId))
    .onMessage(({ message, actor }) => {
      const context = actor.getSnapshot().context as PongPlayerSessionState;

      if (message.type === 'GET_SESSION') {
        return { reply: context };
      }

      if (message.type === 'CLAIM_SIDE') {
        const session = claimPlayerSessionSide(context, message.side, message.controller);
        return {
          context: session,
          reply: session,
          emit: [{ type: 'PLAYER_SESSION_CHANGED' as const, session }],
        };
      }

      if (message.type === 'SET_READY') {
        const session = setPlayerSessionReady(context, message.ready);
        return {
          context: session,
          reply: session,
          emit: [{ type: 'PLAYER_SESSION_CHANGED' as const, session }],
        };
      }

      const input = createPlayerSessionInput(context, message.direction, message.amount);
      return {
        reply: input,
        emit: input.ok ? [{ type: 'PADDLE_INPUT' as const, input }] : [],
      };
    })
    .build();
}

export const lobbyBehavior = defineBehavior<PongLobbyCommand, PongLobbyEvent>()
  .withContext(createInitialLobby())
  .onMessage(({ message, actor }) => {
    const context = actor.getSnapshot().context as PongLobbyState;

    if (message.type === 'GET_LOBBY') {
      return { reply: context };
    }

    if (message.type === 'RESET_LOBBY') {
      const lobby = createInitialLobby();
      return {
        context: lobby,
        emit: [{ type: 'LOBBY_CHANGED' as const, lobby }],
      };
    }

    if (message.type === 'SYNC_SESSION') {
      const lobby = syncLobbySession(context, message.session);
      return {
        context: lobby,
        reply: lobby,
        emit: [{ type: 'LOBBY_CHANGED' as const, lobby }],
      };
    }

    if (message.type === 'REMOVE_SESSION') {
      const lobby = removeLobbySession(context, message.sessionId);
      return {
        context: lobby,
        reply: lobby,
        emit: [{ type: 'LOBBY_CHANGED' as const, lobby }],
      };
    }

    const { lobby, result } = startLobbyMatch(context, message.mode);
    return {
      context: lobby,
      reply: result,
      emit: result.ok
        ? [
            {
              type: 'MATCH_STARTED' as const,
              mode: result.mode,
              controllers: result.controllers,
            },
          ]
        : [{ type: 'MATCH_START_REJECTED' as const, result }],
    };
  })
  .build();
