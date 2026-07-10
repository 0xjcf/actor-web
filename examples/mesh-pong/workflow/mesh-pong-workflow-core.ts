import type { PongMatchState, PongSide } from '../pong-contract';
import type { PongRoomRejection, PongRoomState } from '../pong-room-contract';

export type MeshPongConnectionState = 'connected' | 'connecting' | 'disconnected';
export type MeshPongWorkflowScreen = 'lobby' | 'table' | 'match' | 'result';

export interface MeshPongMatchProjection {
  readonly phase: 'lobby' | 'running' | 'paused' | 'finished';
  readonly generation: number;
  readonly winner: PongSide | null;
}

export interface MeshPongWorkflowState {
  readonly sessionId: string;
  readonly connection: MeshPongConnectionState;
  readonly room: PongRoomState | null;
  readonly match: MeshPongMatchProjection;
  readonly rejection: PongRoomRejection | null;
}

export type MeshPongWorkflowFact =
  | { readonly type: 'CONNECTION_PROJECTED'; readonly state: MeshPongConnectionState }
  | { readonly type: 'ROOM_PROJECTED'; readonly room: PongRoomState | null }
  | { readonly type: 'MATCH_PROJECTED'; readonly match: MeshPongMatchProjection }
  | { readonly type: 'COMMAND_REJECTED'; readonly rejection: PongRoomRejection | null };

export interface MeshPongWorkflowProjection {
  readonly [key: string]: unknown;
  readonly screen: MeshPongWorkflowScreen;
  readonly connected: boolean;
  readonly connection: MeshPongConnectionState;
  readonly sessionId: string;
  readonly roomId: string | null;
  readonly roomCode: string | null;
  readonly roomRevision: number | null;
  readonly hostSessionId: string | null;
  readonly isHost: boolean;
  readonly members: PongRoomState['members'];
  readonly readiness: string;
  readonly readyCount: number;
  readonly requiredReadyCount: number;
  readonly canStart: boolean;
  readonly rejection: PongRoomRejection['reason'] | null;
  readonly winner: PongSide | null;
}

export function createInitialMeshPongWorkflow(sessionId: string): MeshPongWorkflowState {
  return {
    sessionId,
    connection: 'connected',
    room: null,
    match: { phase: 'lobby', generation: 0, winner: null },
    rejection: null,
  };
}

export function reduceMeshPongWorkflow(
  state: MeshPongWorkflowState,
  fact: MeshPongWorkflowFact
): MeshPongWorkflowState {
  switch (fact.type) {
    case 'CONNECTION_PROJECTED':
      return { ...state, connection: fact.state };
    case 'ROOM_PROJECTED':
      return {
        ...state,
        room: fact.room,
        rejection: fact.room?.lastRejection ?? state.rejection,
      };
    case 'MATCH_PROJECTED':
      return { ...state, match: fact.match };
    case 'COMMAND_REJECTED':
      return { ...state, rejection: fact.rejection };
  }
}

export function projectMeshPongWorkflow(state: MeshPongWorkflowState): MeshPongWorkflowProjection {
  const readyCount =
    state.room?.members.filter((member) => member.connected && member.side && member.ready)
      .length ?? 0;
  const requiredReadyCount = 2;
  const screen: MeshPongWorkflowScreen =
    state.match.phase === 'finished'
      ? 'result'
      : state.match.phase === 'running' || state.match.phase === 'paused'
        ? 'match'
        : state.room
          ? 'table'
          : 'lobby';
  const localMember = state.room?.members.find((member) => member.sessionId === state.sessionId);
  const isHost =
    state.room?.hostSessionId === state.sessionId ||
    (state.room?.hostSessionId === null && Boolean(localMember?.side));
  const hasBothSeats =
    Boolean(state.room?.members.some((member) => member.side === 'left')) &&
    Boolean(state.room?.members.some((member) => member.side === 'right'));

  return {
    screen,
    connected: state.connection === 'connected',
    connection: state.connection,
    sessionId: state.sessionId,
    roomId: state.room?.roomId ?? null,
    roomCode: state.room?.code ?? null,
    roomRevision: state.room?.revision ?? null,
    hostSessionId: state.room?.hostSessionId ?? null,
    isHost,
    members: state.room?.members ?? [],
    readiness: `${readyCount} / ${requiredReadyCount}`,
    readyCount,
    requiredReadyCount,
    canStart:
      state.connection === 'connected' &&
      state.room?.phase === 'open' &&
      isHost &&
      hasBothSeats &&
      readyCount === requiredReadyCount,
    rejection: state.rejection?.reason ?? null,
    winner: state.match.winner,
  };
}

/** Compatibility projection while the next slice replaces the single demo room with RoomRegistry. */
export function projectRoomFromAuthoritativeMatch(match: PongMatchState): PongRoomState {
  const members = match.sessions.map((session) => ({
    sessionId: session.sessionId,
    connected: true,
    side: session.side,
    controller: session.controller,
    ready: session.ready,
  }));
  return {
    roomId: match.matchId,
    code: 'MESH',
    revision: match.generation,
    phase: match.phase === 'lobby' ? 'open' : 'starting',
    hostSessionId: match.authoritySessionId,
    members,
    lastRejection: null,
  };
}
