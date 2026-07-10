import type {
  PongControllerSlot,
  PongControllerType,
  PongMatchRosterHandoff,
  PongSide,
} from './pong-contract';

export type PongRoomPhase = 'empty' | 'open' | 'starting';

export interface PongRoomMember {
  readonly sessionId: string;
  readonly connected: boolean;
  readonly side: PongSide | null;
  readonly controller: PongControllerType;
  readonly ready: boolean;
}

export interface PongRoomRejection {
  readonly reason:
    | 'already-created'
    | 'invalid-command'
    | 'match-started'
    | 'not-created'
    | 'not-host'
    | 'not-member'
    | 'player-not-ready'
    | 'seat-taken'
    | 'stale-revision';
  readonly requestSessionId: string;
  readonly expectedRevision?: number;
  readonly actualRevision?: number;
  readonly side?: PongSide;
}

export interface PongRoomState {
  readonly roomId: string;
  readonly code: string | null;
  readonly revision: number;
  readonly phase: PongRoomPhase;
  readonly hostSessionId: string | null;
  readonly members: readonly PongRoomMember[];
  readonly lastRejection: PongRoomRejection | null;
}

interface PongRoomRevisionedCommand {
  readonly requestSessionId: string;
  readonly expectedRevision: number;
}

export type PongRoomCommand =
  | { readonly type: 'GET_ROOM' }
  | (PongRoomRevisionedCommand & { readonly type: 'CREATE_ROOM'; readonly code: string })
  | (PongRoomRevisionedCommand & { readonly type: 'JOIN_ROOM' })
  | (PongRoomRevisionedCommand & { readonly type: 'LEAVE_ROOM' })
  | (PongRoomRevisionedCommand & {
      readonly type: 'CLAIM_SEAT';
      readonly side: PongSide;
      readonly controller?: PongControllerType;
    })
  | (PongRoomRevisionedCommand & { readonly type: 'RELEASE_SEAT' })
  | (PongRoomRevisionedCommand & {
      readonly type: 'SET_CONTROLLER';
      readonly controller: PongControllerType;
    })
  | (PongRoomRevisionedCommand & { readonly type: 'SET_READY'; readonly ready: boolean })
  | (PongRoomRevisionedCommand & { readonly type: 'BEGIN_MATCH' });

export type PongRoomResult =
  | { readonly ok: true; readonly room: PongRoomState; readonly roster?: PongMatchRosterHandoff }
  | ({ readonly ok: false } & PongRoomRejection);

export type PongRoomEvent =
  | { readonly type: 'ROOM_CHANGED'; readonly room: PongRoomState }
  | { readonly type: 'ROOM_COMMAND_REJECTED'; readonly rejection: PongRoomRejection }
  | { readonly type: 'MATCH_ROSTER_READY'; readonly roster: PongMatchRosterHandoff };

export interface PongRoomTransition {
  readonly state: PongRoomState;
  readonly result: PongRoomResult;
  readonly events: readonly PongRoomEvent[];
}

export function createInitialPongRoom(roomId: string): PongRoomState {
  return {
    roomId,
    code: null,
    revision: 0,
    phase: 'empty',
    hostSessionId: null,
    members: [],
    lastRejection: null,
  };
}

function reject(state: PongRoomState, rejection: PongRoomRejection): PongRoomTransition {
  const rejectedState = { ...state, lastRejection: rejection };
  return {
    state: rejectedState,
    result: { ok: false, ...rejection },
    events: [{ type: 'ROOM_COMMAND_REJECTED', rejection }],
  };
}

function accept(
  state: PongRoomState,
  changes: Omit<Partial<PongRoomState>, 'revision' | 'lastRejection'>,
  roster?: PongMatchRosterHandoff
): PongRoomTransition {
  const nextState: PongRoomState = {
    ...state,
    ...changes,
    revision: state.revision + 1,
    lastRejection: null,
  };
  const events: PongRoomEvent[] = [{ type: 'ROOM_CHANGED', room: nextState }];
  if (roster) {
    events.push({ type: 'MATCH_ROSTER_READY', roster });
  }
  return {
    state: nextState,
    result: { ok: true, room: nextState, ...(roster ? { roster } : {}) },
    events,
  };
}

function memberFor(state: PongRoomState, sessionId: string): PongRoomMember | undefined {
  return state.members.find((member) => member.sessionId === sessionId);
}

function replaceMember(
  state: PongRoomState,
  sessionId: string,
  update: (member: PongRoomMember) => PongRoomMember
): readonly PongRoomMember[] {
  return state.members.map((member) => (member.sessionId === sessionId ? update(member) : member));
}

function validateRevision(
  state: PongRoomState,
  command: PongRoomRevisionedCommand
): PongRoomTransition | null {
  if (command.expectedRevision === state.revision) {
    return null;
  }
  return reject(state, {
    reason: 'stale-revision',
    requestSessionId: command.requestSessionId,
    expectedRevision: command.expectedRevision,
    actualRevision: state.revision,
  });
}

function requireOpenMember(
  state: PongRoomState,
  command: PongRoomRevisionedCommand
): PongRoomTransition | null {
  if (state.phase === 'starting') {
    return reject(state, { reason: 'match-started', requestSessionId: command.requestSessionId });
  }
  if (!memberFor(state, command.requestSessionId)) {
    return reject(state, { reason: 'not-member', requestSessionId: command.requestSessionId });
  }
  return null;
}

function controllerSlots(state: PongRoomState): readonly PongControllerSlot[] {
  return (['left', 'right'] as const).flatMap((side) => {
    const member = state.members.find((candidate) => candidate.side === side);
    return member
      ? [
          {
            sessionId: member.sessionId,
            side,
            controller: member.controller,
            ready: member.ready,
          },
        ]
      : [];
  });
}

export function reducePongRoom(state: PongRoomState, command: PongRoomCommand): PongRoomTransition {
  if (command.type === 'GET_ROOM') {
    return { state, result: { ok: true, room: state }, events: [] };
  }

  const stale = validateRevision(state, command);
  if (stale) {
    return stale;
  }

  if (command.type === 'CREATE_ROOM') {
    if (state.phase !== 'empty') {
      return reject(state, {
        reason: 'already-created',
        requestSessionId: command.requestSessionId,
      });
    }
    const code = command.code.trim().toUpperCase();
    if (!code) {
      return reject(state, {
        reason: 'invalid-command',
        requestSessionId: command.requestSessionId,
      });
    }
    return accept(state, {
      code,
      phase: 'open',
      hostSessionId: command.requestSessionId,
      members: [
        {
          sessionId: command.requestSessionId,
          connected: true,
          side: null,
          controller: 'human',
          ready: false,
        },
      ],
    });
  }

  if (state.phase === 'empty') {
    return reject(state, { reason: 'not-created', requestSessionId: command.requestSessionId });
  }

  if (command.type === 'JOIN_ROOM') {
    if (state.phase === 'starting') {
      return reject(state, { reason: 'match-started', requestSessionId: command.requestSessionId });
    }
    const existing = memberFor(state, command.requestSessionId);
    return accept(state, {
      members: existing
        ? replaceMember(state, command.requestSessionId, (member) => ({
            ...member,
            connected: true,
            ready: false,
          }))
        : [
            ...state.members,
            {
              sessionId: command.requestSessionId,
              connected: true,
              side: null,
              controller: 'human',
              ready: false,
            },
          ],
    });
  }

  const denied = requireOpenMember(state, command);
  if (denied) {
    return denied;
  }

  if (command.type === 'LEAVE_ROOM') {
    return accept(state, {
      members: replaceMember(state, command.requestSessionId, (member) => ({
        ...member,
        connected: false,
        ready: false,
      })),
    });
  }

  if (command.type === 'CLAIM_SEAT') {
    const occupant = state.members.find(
      (member) => member.side === command.side && member.sessionId !== command.requestSessionId
    );
    if (occupant) {
      return reject(state, {
        reason: 'seat-taken',
        requestSessionId: command.requestSessionId,
        side: command.side,
      });
    }
    return accept(state, {
      members: replaceMember(state, command.requestSessionId, (member) => ({
        ...member,
        side: command.side,
        controller: command.controller ?? member.controller,
        ready: false,
      })),
    });
  }

  if (command.type === 'RELEASE_SEAT') {
    return accept(state, {
      members: replaceMember(state, command.requestSessionId, (member) => ({
        ...member,
        side: null,
        ready: false,
      })),
    });
  }

  if (command.type === 'SET_CONTROLLER') {
    return accept(state, {
      members: replaceMember(state, command.requestSessionId, (member) => ({
        ...member,
        controller: command.controller,
        ready: false,
      })),
    });
  }

  if (command.type === 'SET_READY') {
    const member = memberFor(state, command.requestSessionId);
    if (!member?.side && command.ready) {
      return reject(state, {
        reason: 'player-not-ready',
        requestSessionId: command.requestSessionId,
      });
    }
    return accept(state, {
      members: replaceMember(state, command.requestSessionId, (candidate) => ({
        ...candidate,
        ready: candidate.connected && Boolean(candidate.side) && command.ready,
      })),
    });
  }

  if (state.hostSessionId !== command.requestSessionId) {
    return reject(state, { reason: 'not-host', requestSessionId: command.requestSessionId });
  }
  const controllers = controllerSlots(state);
  if (
    controllers.length !== 2 ||
    controllers.some((controller) => !controller.ready) ||
    state.members.some((member) => member.side && !member.connected)
  ) {
    return reject(state, {
      reason: 'player-not-ready',
      requestSessionId: command.requestSessionId,
    });
  }
  const roster: PongMatchRosterHandoff = {
    roomId: state.roomId,
    authoritySessionId: command.requestSessionId,
    roomRevision: state.revision + 1,
    controllers,
  };
  return accept(state, { phase: 'starting' }, roster);
}
