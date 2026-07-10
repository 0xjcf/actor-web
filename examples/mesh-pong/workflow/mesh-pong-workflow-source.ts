import type { ActorWebSource } from 'ignite-element/actor-web';
import { igniteCore } from 'ignite-element/actor-web';
import type { PongControllerType, PongSide } from '../pong-contract';
import {
  createInitialPongRoom,
  type PongRoomCommand,
  type PongRoomEvent,
  type PongRoomResult,
  reducePongRoom,
} from '../pong-room-contract';
import {
  createInitialMeshPongWorkflow,
  type MeshPongConnectionState,
  type MeshPongMatchProjection,
  type MeshPongWorkflowProjection,
  type MeshPongWorkflowState,
  projectMeshPongWorkflow,
  reduceMeshPongWorkflow,
} from './mesh-pong-workflow-core';

type WorkflowCommandInput =
  | { readonly type: 'CREATE_ROOM'; readonly code: string }
  | { readonly type: 'JOIN_ROOM'; readonly sessionId: string }
  | {
      readonly type: 'CLAIM_SEAT';
      readonly sessionId: string;
      readonly side: PongSide;
      readonly controller?: PongControllerType;
    }
  | { readonly type: 'RELEASE_SEAT'; readonly sessionId: string }
  | {
      readonly type: 'SET_CONTROLLER';
      readonly sessionId: string;
      readonly controller: PongControllerType;
    }
  | { readonly type: 'SET_READY'; readonly sessionId: string; readonly ready: boolean }
  | { readonly type: 'BEGIN_MATCH'; readonly sessionId: string }
  | { readonly type: 'PROJECT_CONNECTION'; readonly state: MeshPongConnectionState }
  | ({ readonly type: 'PROJECT_MATCH' } & MeshPongMatchProjection);

export interface MeshPongWorkflowSource
  extends ActorWebSource<MeshPongWorkflowState, WorkflowCommandInput, PongRoomEvent> {
  send(message: WorkflowCommandInput): Promise<PongRoomResult | MeshPongWorkflowState>;
  close(): void;
}

export interface CreateMeshPongWorkflowSourceOptions {
  readonly sessionId: string;
  readonly roomId: string;
}

function sourceSnapshot(context: MeshPongWorkflowState) {
  return {
    address: 'actor://pong-server/room-workflow',
    context,
    phase: projectMeshPongWorkflow(context).screen,
    status: 'running',
    value: projectMeshPongWorkflow(context).screen,
    matches: (state: string) => projectMeshPongWorkflow(context).screen === state,
    can: () => true,
    hasTag: () => false,
    toJSON: () => ({ context, value: projectMeshPongWorkflow(context).screen }),
  };
}

export function createMeshPongWorkflowSource(
  options: CreateMeshPongWorkflowSourceOptions
): MeshPongWorkflowSource {
  let context = createInitialMeshPongWorkflow(options.sessionId);
  let room = createInitialPongRoom(options.roomId);
  let closed = false;
  const snapshotListeners = new Set<(snapshot: ReturnType<typeof sourceSnapshot>) => void>();
  const eventListeners = new Set<(event: PongRoomEvent) => void>();

  const transportState = () =>
    context.connection === 'connecting' ? ('replaying' as const) : context.connection;

  const publish = (events: readonly PongRoomEvent[] = []) => {
    const snapshot = sourceSnapshot(context);
    for (const listener of snapshotListeners) {
      listener(snapshot);
    }
    for (const event of events) {
      for (const listener of eventListeners) {
        listener(event);
      }
    }
  };

  const applyRoom = (command: PongRoomCommand): PongRoomResult => {
    const transition = reducePongRoom(room, command);
    room = transition.state;
    context = reduceMeshPongWorkflow(context, { type: 'ROOM_PROJECTED', room });
    context = reduceMeshPongWorkflow(context, {
      type: 'COMMAND_REJECTED',
      rejection: transition.result.ok ? null : transition.result,
    });
    if (transition.result.ok && transition.result.roster) {
      context = reduceMeshPongWorkflow(context, {
        type: 'MATCH_PROJECTED',
        match: { phase: 'running', generation: 1, winner: null },
      });
    }
    publish(transition.events);
    return transition.result;
  };

  return {
    address: 'actor://pong-server/room-workflow',
    snapshot: () => sourceSnapshot(context),
    subscribe(listener) {
      if (closed) {
        return () => {};
      }
      snapshotListeners.add(listener);
      listener(sourceSnapshot(context));
      return () => snapshotListeners.delete(listener);
    },
    subscribeEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    transportStatus: () => ({
      state: transportState(),
      updatedAt: 0,
    }),
    subscribeTransportStatus(listener) {
      listener({
        state: transportState(),
        updatedAt: 0,
      });
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
      if (message.type === 'PROJECT_MATCH') {
        context = reduceMeshPongWorkflow(context, {
          type: 'MATCH_PROJECTED',
          match: {
            phase: message.phase,
            generation: message.generation,
            winner: message.winner,
          },
        });
        publish();
        return context;
      }

      const requestSessionId =
        message.type === 'CREATE_ROOM' ? options.sessionId : message.sessionId;
      const expectedRevision = room.revision;
      switch (message.type) {
        case 'CREATE_ROOM':
          return applyRoom({
            type: 'CREATE_ROOM',
            requestSessionId,
            expectedRevision,
            code: message.code,
          });
        case 'JOIN_ROOM':
          return applyRoom({ type: 'JOIN_ROOM', requestSessionId, expectedRevision });
        case 'CLAIM_SEAT':
          return applyRoom({
            type: 'CLAIM_SEAT',
            requestSessionId,
            expectedRevision,
            side: message.side,
            controller: message.controller,
          });
        case 'RELEASE_SEAT':
          return applyRoom({ type: 'RELEASE_SEAT', requestSessionId, expectedRevision });
        case 'SET_CONTROLLER':
          return applyRoom({
            type: 'SET_CONTROLLER',
            requestSessionId,
            expectedRevision,
            controller: message.controller,
          });
        case 'SET_READY':
          return applyRoom({
            type: 'SET_READY',
            requestSessionId,
            expectedRevision,
            ready: message.ready,
          });
        case 'BEGIN_MATCH':
          return applyRoom({ type: 'BEGIN_MATCH', requestSessionId, expectedRevision });
      }
    },
    close() {
      closed = true;
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
        actor.send({ type: 'CREATE_ROOM', code: input.code })
      ),
      joinRoom: command((input: { readonly sessionId: string }) =>
        actor.send({ type: 'JOIN_ROOM', sessionId: input.sessionId })
      ),
      claimSeat: command(
        (input: {
          readonly sessionId: string;
          readonly side: PongSide;
          readonly controller?: PongControllerType;
        }) => actor.send({ type: 'CLAIM_SEAT', ...input })
      ),
      releaseSeat: command((input: { readonly sessionId: string }) =>
        actor.send({ type: 'RELEASE_SEAT', sessionId: input.sessionId })
      ),
      setController: command(
        (input: { readonly sessionId: string; readonly controller: PongControllerType }) =>
          actor.send({ type: 'SET_CONTROLLER', ...input })
      ),
      setReady: command((input: { readonly sessionId: string; readonly ready: boolean }) =>
        actor.send({ type: 'SET_READY', ...input })
      ),
      beginMatch: command((input: { readonly sessionId: string }) =>
        actor.send({ type: 'BEGIN_MATCH', sessionId: input.sessionId })
      ),
      projectConnection: command((input: { readonly state: MeshPongConnectionState }) =>
        actor.send({ type: 'PROJECT_CONNECTION', state: input.state })
      ),
      projectMatch: command((input: MeshPongMatchProjection) =>
        actor.send({ type: 'PROJECT_MATCH', ...input })
      ),
    }),
  });
}
