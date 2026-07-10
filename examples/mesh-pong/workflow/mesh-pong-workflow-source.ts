import type { ActorMessage, ActorRef } from '@actor-web/runtime';
import type { ActorWebSource } from 'ignite-element/actor-web';
import { igniteCore } from 'ignite-element/actor-web';
import type {
  PongControllerType,
  PongMatchCommand,
  PongMatchState,
  PongSide,
} from '../pong-contract';
import type {
  PongRoomCommand,
  PongRoomEvent,
  PongRoomResult,
  PongRoomState,
} from '../pong-room-contract';
import {
  createInitialMeshPongWorkflow,
  type MeshPongConnectionState,
  type MeshPongWorkflowProjection,
  type MeshPongWorkflowState,
  projectMeshPongWorkflow,
  reduceMeshPongWorkflow,
} from './mesh-pong-workflow-core';

type WorkflowCommandInput =
  | { readonly type: 'CREATE_ROOM'; readonly code: string }
  | { readonly type: 'JOIN_ROOM' }
  | {
      readonly type: 'CLAIM_SEAT';
      readonly side: PongSide;
      readonly controller?: PongControllerType;
    }
  | { readonly type: 'RELEASE_SEAT' }
  | { readonly type: 'SET_CONTROLLER'; readonly controller: PongControllerType }
  | { readonly type: 'SET_READY'; readonly ready: boolean }
  | { readonly type: 'BEGIN_MATCH' }
  | { readonly type: 'PROJECT_CONNECTION'; readonly state: MeshPongConnectionState }
  | { readonly type: 'REFRESH' };

export interface MeshPongWorkflowActors {
  /** The Room aggregate is the only owner of memberships, seats, readiness, and start permission. */
  readonly room: ActorRef<PongRoomState, PongRoomCommand>;
  /** MatchCoordinator is the only owner of Match phase. Room only hands it an immutable roster. */
  readonly matchCoordinator: ActorRef<PongMatchState, PongMatchCommand>;
}

export interface MeshPongWorkflowSource
  extends ActorWebSource<MeshPongWorkflowState, WorkflowCommandInput, PongRoomEvent> {
  send(message: WorkflowCommandInput): Promise<PongRoomResult | MeshPongWorkflowState>;
  refresh(): Promise<MeshPongWorkflowState>;
  close(): void;
}

export interface CreateMeshPongWorkflowSourceOptions {
  readonly sessionId: string;
  readonly actors: MeshPongWorkflowActors;
}

export function isPongRoomResult(
  value: PongRoomResult | MeshPongWorkflowState
): value is PongRoomResult {
  return 'ok' in value;
}

function sourceSnapshot(context: MeshPongWorkflowState) {
  const projection = projectMeshPongWorkflow(context);
  return {
    address: 'actor://pong-server/room-workflow',
    context,
    phase: projection.screen,
    status: 'running',
    value: projection.screen,
    matches: (state: string) => projection.screen === state,
    can: () => true,
    hasTag: () => false,
    toJSON: () => ({ context, value: projection.screen }),
  };
}

function projectMatch(match: PongMatchState) {
  return {
    phase: match.phase,
    generation: match.generation,
    winner: null,
  } as const;
}

function roomCommand(
  input: Exclude<WorkflowCommandInput, { readonly type: 'PROJECT_CONNECTION' | 'REFRESH' }>,
  requestSessionId: string,
  expectedRevision: number
): PongRoomCommand {
  switch (input.type) {
    case 'CREATE_ROOM':
      return { type: 'CREATE_ROOM', requestSessionId, expectedRevision, code: input.code };
    case 'JOIN_ROOM':
      return { type: 'JOIN_ROOM', requestSessionId, expectedRevision };
    case 'CLAIM_SEAT':
      return {
        type: 'CLAIM_SEAT',
        requestSessionId,
        expectedRevision,
        side: input.side,
        controller: input.controller,
      };
    case 'RELEASE_SEAT':
      return { type: 'RELEASE_SEAT', requestSessionId, expectedRevision };
    case 'SET_CONTROLLER':
      return {
        type: 'SET_CONTROLLER',
        requestSessionId,
        expectedRevision,
        controller: input.controller,
      };
    case 'SET_READY':
      return { type: 'SET_READY', requestSessionId, expectedRevision, ready: input.ready };
    case 'BEGIN_MATCH':
      return { type: 'BEGIN_MATCH', requestSessionId, expectedRevision };
  }
}

/**
 * Imperative adapter which composes authoritative Actor-Web aggregates. It holds only a derived
 * workflow projection: it never emulates Room state and it never infers Match phase from Room.
 */
export function createMeshPongWorkflowSource(
  options: CreateMeshPongWorkflowSourceOptions
): MeshPongWorkflowSource {
  let context = createInitialMeshPongWorkflow(options.sessionId);
  let closed = false;
  const snapshotListeners = new Set<(snapshot: ReturnType<typeof sourceSnapshot>) => void>();
  const eventListeners = new Set<(event: PongRoomEvent) => void>();
  const stops: (() => void)[] = [];

  const publish = () => {
    const snapshot = sourceSnapshot(context);
    for (const listener of snapshotListeners) listener(snapshot);
  };
  const applyRoom = (room: PongRoomState) => {
    context = reduceMeshPongWorkflow(context, { type: 'ROOM_PROJECTED', room });
  };
  const applyMatch = (match: PongMatchState) => {
    context = reduceMeshPongWorkflow(context, {
      type: 'MATCH_PROJECTED',
      match: projectMatch(match),
    });
  };
  const refresh = async (): Promise<MeshPongWorkflowState> => {
    const [roomResult, match] = await Promise.all([
      options.actors.room.ask<PongRoomResult>({ type: 'GET_ROOM' }),
      options.actors.matchCoordinator.ask<PongMatchState>({ type: 'GET_MATCH' }),
    ]);
    if (roomResult.ok) applyRoom(roomResult.room);
    applyMatch(match);
    publish();
    return context;
  };

  const roomRef = options.actors.room as ActorRef<PongRoomState, PongRoomCommand> & {
    subscribeEvent?: (listener: (event: ActorMessage) => void) => () => void;
  };
  if (roomRef.subscribeSnapshot) {
    stops.push(
      roomRef.subscribeSnapshot((snapshot) => {
        applyRoom(snapshot.context);
        publish();
      })
    );
  }
  if (options.actors.matchCoordinator.subscribeSnapshot) {
    stops.push(
      options.actors.matchCoordinator.subscribeSnapshot((snapshot) => {
        applyMatch(snapshot.context);
        publish();
      })
    );
  }
  if (roomRef.subscribeEvent) {
    stops.push(
      roomRef.subscribeEvent((event) => {
        if (event.type === 'ROOM_CHANGED' || event.type === 'ROOM_COMMAND_REJECTED') {
          eventListeners.forEach((listener) => listener(event as PongRoomEvent));
        }
      })
    );
  }

  return {
    address: 'actor://pong-server/room-workflow',
    snapshot: () => sourceSnapshot(context),
    subscribe(listener) {
      if (closed) return () => {};
      snapshotListeners.add(listener);
      listener(sourceSnapshot(context));
      return () => snapshotListeners.delete(listener);
    },
    subscribeEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    transportStatus: () => ({ state: 'local' as const, updatedAt: 0 }),
    subscribeTransportStatus(listener) {
      listener({ state: 'local' as const, updatedAt: 0 });
      return () => {};
    },
    async send(message) {
      if (message.type === 'PROJECT_CONNECTION') {
        context = reduceMeshPongWorkflow(context, {
          type: 'CONNECTION_PROJECTED',
          state: message.state,
        });
        publish();
        return context;
      }
      if (message.type === 'REFRESH') return refresh();

      const currentRoom = await options.actors.room.ask<PongRoomResult>({ type: 'GET_ROOM' });
      if (!currentRoom.ok) return currentRoom;
      const result = await options.actors.room.ask<PongRoomResult>(
        roomCommand(message, options.sessionId, currentRoom.room.revision) as never
      );
      if (result.ok) applyRoom(result.room);
      context = reduceMeshPongWorkflow(context, {
        type: 'COMMAND_REJECTED',
        rejection: result.ok ? null : result,
      });
      // BEGIN_MATCH only changes Room. MatchCoordinator must publish its own phase transition.
      await refresh();
      return result;
    },
    refresh,
    close() {
      closed = true;
      stops.splice(0).forEach((stop) => stop());
      snapshotListeners.clear();
      eventListeners.clear();
    },
  };
}

export function createMeshPongWorkflowRuntime(source: MeshPongWorkflowSource) {
  return igniteCore({
    source,
    cleanup: false,
    view: ({ context }): MeshPongWorkflowProjection => projectMeshPongWorkflow(context),
    commands: ({ actor, command }) => ({
      createRoom: command((input: { readonly code: string }) =>
        actor.send({ type: 'CREATE_ROOM', ...input })
      ),
      joinRoom: command(() => actor.send({ type: 'JOIN_ROOM' })),
      claimSeat: command(
        (input: { readonly side: PongSide; readonly controller?: PongControllerType }) =>
          actor.send({ type: 'CLAIM_SEAT', ...input })
      ),
      releaseSeat: command(() => actor.send({ type: 'RELEASE_SEAT' })),
      setController: command((input: { readonly controller: PongControllerType }) =>
        actor.send({ type: 'SET_CONTROLLER', ...input })
      ),
      setReady: command((input: { readonly ready: boolean }) =>
        actor.send({ type: 'SET_READY', ...input })
      ),
      beginMatch: command(() => actor.send({ type: 'BEGIN_MATCH' })),
      projectConnection: command((input: { readonly state: MeshPongConnectionState }) =>
        actor.send({ type: 'PROJECT_CONNECTION', ...input })
      ),
      refresh: command(() => actor.send({ type: 'REFRESH' })),
    }),
  });
}
