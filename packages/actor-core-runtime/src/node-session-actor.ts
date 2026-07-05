import type {
  CommandRejectedFact,
  NodeSessionActor,
  NodeSessionActorCommand,
  NodeSessionActorProjection,
  SessionActorFailure,
  SessionActorObservedProviderFact,
  SessionActorTurnProjection,
} from './node-session-actor-contract.js';
import { createSessionActorFailure } from './node-session-actor-contract.js';

function createInitialProjection(): NodeSessionActorProjection {
  return {
    session: null,
    provider: null,
    turn: null,
    checkpoint: null,
    lastFact: null,
    failure: null,
  };
}

function hasActiveTurn(snapshot: NodeSessionActorProjection): boolean {
  return snapshot.turn?.status === 'active';
}

function clearFailure<TSnapshot extends NodeSessionActorProjection>(
  snapshot: TSnapshot
): TSnapshot {
  return {
    ...snapshot,
    failure: null,
  };
}

function rejectCommand(
  snapshot: NodeSessionActorProjection,
  command: NodeSessionActorCommand['type'],
  observedAt: string,
  message: string,
  details?: SessionActorFailure['details']
): NodeSessionActorProjection {
  const failure = createSessionActorFailure({
    code: 'invalid_transition',
    message,
    retryable: false,
    ...(details === undefined ? {} : { details }),
  });
  const lastFact: CommandRejectedFact = {
    type: 'COMMAND_REJECTED',
    sessionId: snapshot.session?.id ?? null,
    command,
    observedAt,
    failure,
  };

  return {
    ...snapshot,
    lastFact,
    failure,
  };
}

function requireOpenSession(
  snapshot: NodeSessionActorProjection,
  command: NodeSessionActorCommand['type'],
  observedAt: string
): NodeSessionActorProjection | null {
  if (!snapshot.session) {
    return rejectCommand(snapshot, command, observedAt, 'Session has not been created.');
  }
  if (snapshot.session.status !== 'open') {
    return rejectCommand(snapshot, command, observedAt, 'Session is already closed.');
  }
  return null;
}

function requireAttachedProvider(
  snapshot: NodeSessionActorProjection,
  command: NodeSessionActorCommand['type'],
  observedAt: string
): NodeSessionActorProjection | null {
  if (!snapshot.provider) {
    return rejectCommand(snapshot, command, observedAt, 'Provider must be attached first.');
  }
  return null;
}

function requireActiveTurn(
  snapshot: NodeSessionActorProjection,
  command: NodeSessionActorCommand['type'],
  observedAt: string
): NodeSessionActorProjection | null {
  if (!hasActiveTurn(snapshot) || !snapshot.turn) {
    return rejectCommand(snapshot, command, observedAt, 'No active turn is available.');
  }
  return null;
}

function applyTerminalTurn(
  snapshot: NodeSessionActorProjection,
  turn: SessionActorTurnProjection,
  lastFact: NodeSessionActorProjection['lastFact'],
  failure: SessionActorFailure | null
): NodeSessionActorProjection {
  return {
    ...snapshot,
    turn,
    checkpoint: turn.checkpoint,
    lastFact,
    failure,
  };
}

function observeProviderFact(
  snapshot: NodeSessionActorProjection,
  fact: SessionActorObservedProviderFact
): NodeSessionActorProjection {
  const sessionGuard = requireOpenSession(snapshot, 'OBSERVE_PROVIDER_FACT', getObservedAt(fact));
  if (sessionGuard) {
    return sessionGuard;
  }
  const providerGuard = requireAttachedProvider(
    snapshot,
    'OBSERVE_PROVIDER_FACT',
    getObservedAt(fact)
  );
  if (providerGuard) {
    return providerGuard;
  }
  const activeTurnGuard = requireActiveTurn(snapshot, 'OBSERVE_PROVIDER_FACT', getObservedAt(fact));
  if (activeTurnGuard || !snapshot.turn || !snapshot.session || !snapshot.provider) {
    return activeTurnGuard ?? snapshot;
  }
  if (fact.turnId !== snapshot.turn.id) {
    return rejectCommand(
      snapshot,
      'OBSERVE_PROVIDER_FACT',
      getObservedAt(fact),
      'Observed provider fact does not match the active turn.',
      {
        activeTurnId: snapshot.turn.id,
        observedTurnId: fact.turnId,
      }
    );
  }
  if (fact.sequence <= snapshot.turn.sequence) {
    return rejectCommand(
      snapshot,
      'OBSERVE_PROVIDER_FACT',
      getObservedAt(fact),
      'Observed provider fact sequence must advance the active turn.',
      {
        activeSequence: snapshot.turn.sequence,
        observedSequence: fact.sequence,
      }
    );
  }

  switch (fact.type) {
    case 'PROVIDER_DELTA': {
      const turn: SessionActorTurnProjection = {
        ...snapshot.turn,
        output: `${snapshot.turn.output}${fact.delta}`,
        sequence: fact.sequence,
        checkpoint: fact.checkpoint,
      };

      return {
        ...clearFailure(snapshot),
        turn,
        checkpoint: fact.checkpoint,
        lastFact: {
          type: 'PROVIDER_DELTA',
          sessionId: snapshot.session.id,
          providerId: snapshot.provider.id,
          turnId: fact.turnId,
          sequence: fact.sequence,
          delta: fact.delta,
          checkpoint: fact.checkpoint,
          observedAt: fact.observedAt,
        },
      };
    }
    case 'TURN_COMPLETED': {
      return applyTerminalTurn(
        clearFailure(snapshot),
        {
          ...snapshot.turn,
          status: 'completed',
          output: fact.output,
          sequence: fact.sequence,
          checkpoint: fact.checkpoint,
          completedAt: fact.completedAt,
          cancelledAt: null,
          failedAt: null,
          cancelReason: null,
          failure: null,
        },
        {
          type: 'TURN_COMPLETED',
          sessionId: snapshot.session.id,
          providerId: snapshot.provider.id,
          turnId: fact.turnId,
          sequence: fact.sequence,
          checkpoint: fact.checkpoint,
          completedAt: fact.completedAt,
          output: fact.output,
        },
        null
      );
    }
    case 'TURN_CANCELLED': {
      return applyTerminalTurn(
        clearFailure(snapshot),
        {
          ...snapshot.turn,
          status: 'cancelled',
          sequence: fact.sequence,
          checkpoint: fact.checkpoint,
          completedAt: null,
          cancelledAt: fact.cancelledAt,
          failedAt: null,
          cancelReason: fact.reason ?? null,
          failure: null,
        },
        {
          type: 'TURN_CANCELLED',
          sessionId: snapshot.session.id,
          providerId: snapshot.provider.id,
          turnId: fact.turnId,
          sequence: fact.sequence,
          checkpoint: fact.checkpoint,
          cancelledAt: fact.cancelledAt,
          ...(fact.reason === undefined ? {} : { reason: fact.reason }),
        },
        null
      );
    }
    case 'TURN_FAILED': {
      return applyTerminalTurn(
        snapshot,
        {
          ...snapshot.turn,
          status: 'failed',
          sequence: fact.sequence,
          checkpoint: fact.checkpoint,
          completedAt: null,
          cancelledAt: null,
          failedAt: fact.failedAt,
          cancelReason: null,
          failure: fact.failure,
        },
        {
          type: 'TURN_FAILED',
          sessionId: snapshot.session.id,
          providerId: snapshot.provider.id,
          turnId: fact.turnId,
          sequence: fact.sequence,
          checkpoint: fact.checkpoint,
          failedAt: fact.failedAt,
          failure: fact.failure,
        },
        fact.failure
      );
    }
  }
}

function getObservedAt(fact: SessionActorObservedProviderFact): string {
  switch (fact.type) {
    case 'PROVIDER_DELTA':
      return fact.observedAt;
    case 'TURN_COMPLETED':
      return fact.completedAt;
    case 'TURN_CANCELLED':
      return fact.cancelledAt;
    case 'TURN_FAILED':
      return fact.failedAt;
  }
}

export function createNodeSessionActor(): NodeSessionActor {
  let projection = createInitialProjection();

  return {
    async dispatch(command): Promise<NodeSessionActorProjection> {
      switch (command.type) {
        case 'CREATE_SESSION': {
          if (projection.session) {
            projection = rejectCommand(
              projection,
              command.type,
              command.openedAt,
              'Session has already been created.'
            );
            return projection;
          }

          projection = {
            session: {
              id: command.sessionId,
              status: 'open',
              openedAt: command.openedAt,
              closedAt: null,
            },
            provider: null,
            turn: null,
            checkpoint: null,
            lastFact: {
              type: 'SESSION_CREATED',
              sessionId: command.sessionId,
              openedAt: command.openedAt,
            },
            failure: null,
          };
          return projection;
        }
        case 'ATTACH_PROVIDER': {
          const sessionGuard = requireOpenSession(projection, command.type, command.attachedAt);
          if (sessionGuard) {
            projection = sessionGuard;
            return projection;
          }
          if (hasActiveTurn(projection)) {
            projection = rejectCommand(
              projection,
              command.type,
              command.attachedAt,
              'Cannot replace the provider while a turn is active.'
            );
            return projection;
          }
          if (!projection.session) {
            return projection;
          }

          projection = {
            ...clearFailure(projection),
            provider: {
              id: command.providerId,
              attachedAt: command.attachedAt,
              ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
            },
            lastFact: {
              type: 'PROVIDER_ATTACHED',
              sessionId: projection.session.id,
              providerId: command.providerId,
              attachedAt: command.attachedAt,
              ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
            },
          };
          return projection;
        }
        case 'SUBMIT_TURN': {
          const sessionGuard = requireOpenSession(projection, command.type, command.submittedAt);
          if (sessionGuard) {
            projection = sessionGuard;
            return projection;
          }
          const providerGuard = requireAttachedProvider(
            projection,
            command.type,
            command.submittedAt
          );
          if (providerGuard) {
            projection = providerGuard;
            return projection;
          }
          if (hasActiveTurn(projection)) {
            projection = rejectCommand(
              projection,
              command.type,
              command.submittedAt,
              'Cannot submit a new turn while another turn is active.'
            );
            return projection;
          }
          if (!projection.session || !projection.provider) {
            return projection;
          }

          projection = {
            ...clearFailure(projection),
            turn: {
              id: command.turnId,
              status: 'active',
              submittedAt: command.submittedAt,
              output: '',
              sequence: 0,
              checkpoint: null,
              completedAt: null,
              cancelledAt: null,
              failedAt: null,
              cancelReason: null,
              failure: null,
              input: command.input,
            },
            checkpoint: null,
            lastFact: {
              type: 'TURN_SUBMITTED',
              sessionId: projection.session.id,
              providerId: projection.provider.id,
              turnId: command.turnId,
              submittedAt: command.submittedAt,
              input: command.input,
            },
          };
          return projection;
        }
        case 'CANCEL_TURN': {
          const sessionGuard = requireOpenSession(projection, command.type, command.cancelledAt);
          if (sessionGuard) {
            projection = sessionGuard;
            return projection;
          }
          const providerGuard = requireAttachedProvider(
            projection,
            command.type,
            command.cancelledAt
          );
          if (providerGuard) {
            projection = providerGuard;
            return projection;
          }
          const activeTurnGuard = requireActiveTurn(projection, command.type, command.cancelledAt);
          if (activeTurnGuard || !projection.turn || !projection.session || !projection.provider) {
            projection = activeTurnGuard ?? projection;
            return projection;
          }

          projection = applyTerminalTurn(
            clearFailure(projection),
            {
              ...projection.turn,
              status: 'cancelled',
              completedAt: null,
              cancelledAt: command.cancelledAt,
              failedAt: null,
              cancelReason: command.reason ?? null,
              failure: null,
            },
            {
              type: 'TURN_CANCELLED',
              sessionId: projection.session.id,
              providerId: projection.provider.id,
              turnId: projection.turn.id,
              sequence: projection.turn.sequence,
              checkpoint: projection.turn.checkpoint,
              cancelledAt: command.cancelledAt,
              ...(command.reason === undefined ? {} : { reason: command.reason }),
            },
            null
          );
          return projection;
        }
        case 'CLOSE_SESSION': {
          const sessionGuard = requireOpenSession(projection, command.type, command.closedAt);
          if (sessionGuard) {
            projection = sessionGuard;
            return projection;
          }
          if (hasActiveTurn(projection)) {
            projection = rejectCommand(
              projection,
              command.type,
              command.closedAt,
              'Cannot close the session while a turn is active.'
            );
            return projection;
          }
          if (!projection.session) {
            return projection;
          }

          projection = {
            ...clearFailure(projection),
            session: {
              ...projection.session,
              status: 'closed',
              closedAt: command.closedAt,
            },
            lastFact: {
              type: 'SESSION_CLOSED',
              sessionId: projection.session.id,
              closedAt: command.closedAt,
            },
          };
          return projection;
        }
        case 'OBSERVE_PROVIDER_FACT': {
          projection = observeProviderFact(projection, command.fact);
          return projection;
        }
      }
    },
    getSnapshot(): NodeSessionActorProjection {
      return projection;
    },
  };
}
