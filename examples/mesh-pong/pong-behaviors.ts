import { defineBehavior } from '@actor-web/runtime/browser';
import {
  advanceBall,
  applyMatchControllerInput,
  type BallCommand,
  type BallEvent,
  claimPlayerSessionSide,
  createInitialBallContext,
  createInitialLobby,
  createInitialMatchState,
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
  type PongMatchCommand,
  type PongMatchEvent,
  type PongMatchMode,
  type PongMatchState,
  type PongPaddleState,
  type PongPlayerSessionParams,
  type PongPlayerSessionState,
  type PongScoreState,
  type PongSide,
  removeLobbySession,
  removeMatchSession,
  restartMatchLifecycle,
  returnMatchToRoom,
  type ScoreCommand,
  type ScoreEvent,
  setPaddle,
  setPlayerSessionReady,
  startLobbyMatch,
  startMatchLifecycle,
  syncLobbySession,
  syncMatchSession,
  tickMatch,
} from './pong-contract';

function isPongControllerType(value: unknown): value is 'human' | 'mlx' {
  return value === 'human' || value === 'mlx';
}

function isPongSide(value: unknown): value is PongSide {
  return value === 'left' || value === 'right';
}

function isPongMatchMode(value: unknown): value is PongMatchMode {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const mode = value as {
    readonly playerCount?: unknown;
    readonly controllers?: { readonly left?: unknown; readonly right?: unknown };
  };
  return (
    (mode.playerCount === 1 || mode.playerCount === 2) &&
    Boolean(mode.controllers) &&
    isPongControllerType(mode.controllers?.left) &&
    isPongControllerType(mode.controllers?.right)
  );
}

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
        if (
          !isPongSide(message.side) ||
          (message.controller !== undefined && !isPongControllerType(message.controller))
        ) {
          return {
            reply: {
              ok: false,
              sessionId: context.sessionId,
              reason: 'invalid-command' as const,
            },
          };
        }

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

      if (
        message.type !== 'MOVE_CONTROLLER' ||
        (message.direction !== 'up' && message.direction !== 'down')
      ) {
        return {
          reply: {
            ok: false,
            sessionId: context.sessionId,
            reason: 'invalid-command' as const,
          },
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

    if (message.type !== 'START_MATCH') {
      return {
        reply: {
          ok: false as const,
          reason: 'invalid-command' as const,
          missing: [] as readonly PongSide[],
        },
      };
    }

    if (!isPongMatchMode(message.mode)) {
      const result = {
        ok: false as const,
        reason: 'invalid-command' as const,
        missing: [] as readonly PongSide[],
      };
      return {
        reply: result,
        emit: [{ type: 'MATCH_START_REJECTED' as const, result }],
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

export const matchCoordinatorBehavior = defineBehavior<PongMatchCommand, PongMatchEvent>()
  .withContext(createInitialMatchState())
  .onMessage(({ message, actor }) => {
    const context = actor.getSnapshot().context as PongMatchState;

    if (message.type === 'GET_MATCH') {
      return { reply: context };
    }

    if (message.type === 'SYNC_SESSION') {
      const match = syncMatchSession(context, message.session);
      return {
        context: match,
        reply: match,
        emit: [{ type: 'MATCH_CHANGED' as const, match }],
      };
    }

    if (message.type === 'REMOVE_SESSION') {
      const match = removeMatchSession(context, message.sessionId);
      return {
        context: match,
        reply: match,
        emit: [{ type: 'MATCH_CHANGED' as const, match }],
      };
    }

    const result =
      message.type === 'START_MATCH'
        ? startMatchLifecycle(
            context,
            message.requestSessionId,
            message.expectedGeneration,
            message.mode
          )
        : message.type === 'RESTART_MATCH'
          ? restartMatchLifecycle(context, message.requestSessionId, message.expectedGeneration)
          : message.type === 'REMATCH'
            ? restartMatchLifecycle(
                context,
                message.requestSessionId,
                message.expectedGeneration,
                message.mode
              )
            : message.type === 'RETURN_TO_ROOM'
              ? returnMatchToRoom(context, message.requestSessionId, message.expectedGeneration)
              : message.type === 'APPLY_CONTROLLER_INPUT'
                ? applyMatchControllerInput(
                    context,
                    message.requestSessionId,
                    message.expectedGeneration,
                    message.input
                  )
                : tickMatch(
                    context,
                    message.requestSessionId,
                    message.expectedGeneration,
                    message.count
                  );

    return result.ok
      ? {
          context: result.match,
          reply: result,
          emit: [{ type: 'MATCH_CHANGED' as const, match: result.match }],
        }
      : { reply: result };
  })
  .build();
