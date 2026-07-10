import type { ActorRef } from '@actor-web/runtime';
import { test as igniteTest } from 'ignite-element';
import { describe, expect, it } from 'vitest';
import { startMeshPongLocal } from '../modes/local';
import type { PongMatchCommand, PongMatchRosterHandoff, PongMatchState } from '../pong-contract';
import {
  createInitialPongRoom,
  type PongRoomCommand,
  type PongRoomState,
  reducePongRoom,
} from '../pong-room-contract';
import { pong } from '../pong-topology';
import { renderLobbyScreen } from '../ui/screens/lobby-screen';
import { renderTableScreen } from '../ui/screens/table-screen';
import {
  createInitialMeshPongWorkflow,
  projectMeshPongWorkflow,
  reduceMeshPongWorkflow,
} from './mesh-pong-workflow-core';
import {
  createMeshPongWorkflowRuntime,
  createMeshPongWorkflowSource,
} from './mesh-pong-workflow-source';

function createRoom(): PongRoomState {
  const initial = createInitialPongRoom('room-1');
  return reducePongRoom(initial, {
    type: 'CREATE_ROOM',
    requestSessionId: 'tab-a',
    expectedRevision: 0,
    code: 'PONG42',
  }).state;
}

function prepareReadyRoom(): PongRoomState {
  let room = createRoom();
  for (const command of [
    {
      type: 'JOIN_ROOM' as const,
      requestSessionId: 'tab-b',
      expectedRevision: room.revision,
    },
    {
      type: 'CLAIM_SEAT' as const,
      requestSessionId: 'tab-a',
      expectedRevision: room.revision + 1,
      side: 'left' as const,
    },
    {
      type: 'CLAIM_SEAT' as const,
      requestSessionId: 'tab-b',
      expectedRevision: room.revision + 2,
      side: 'right' as const,
    },
    {
      type: 'SET_READY' as const,
      requestSessionId: 'tab-a',
      expectedRevision: room.revision + 3,
      ready: true,
    },
    {
      type: 'SET_READY' as const,
      requestSessionId: 'tab-b',
      expectedRevision: room.revision + 4,
      ready: true,
    },
  ]) {
    room = reducePongRoom(room, command).state;
  }
  return room;
}

describe('Mesh Pong room aggregate', () => {
  it('enforces revision, seat, readiness, and authority invariants as data', () => {
    const room = createRoom();

    expect(
      reducePongRoom(room, {
        type: 'CLAIM_SEAT',
        requestSessionId: 'tab-b',
        expectedRevision: room.revision,
        side: 'left',
      }).result
    ).toMatchObject({ ok: false, reason: 'not-member' });

    expect(
      reducePongRoom(room, {
        type: 'JOIN_ROOM',
        requestSessionId: 'tab-b',
        expectedRevision: 0,
      }).result
    ).toMatchObject({
      ok: false,
      reason: 'stale-revision',
      expectedRevision: 0,
      actualRevision: 1,
    });

    const readyRoom = prepareReadyRoom();
    expect(
      reducePongRoom(readyRoom, {
        type: 'BEGIN_MATCH',
        requestSessionId: 'tab-b',
        expectedRevision: readyRoom.revision,
      }).result
    ).toMatchObject({ ok: false, reason: 'not-host' });

    const started = reducePongRoom(readyRoom, {
      type: 'BEGIN_MATCH',
      requestSessionId: 'tab-a',
      expectedRevision: readyRoom.revision,
    });
    expect(started.result).toMatchObject({ ok: true });
    expect((started.result as { readonly roster: PongMatchRosterHandoff }).roster).toEqual({
      roomId: 'room-1',
      authoritySessionId: 'tab-a',
      roomRevision: readyRoom.revision + 1,
      controllers: [
        { sessionId: 'tab-a', side: 'left', controller: 'human', ready: true },
        { sessionId: 'tab-b', side: 'right', controller: 'human', ready: true },
      ],
    });
  });

  it('hydrates a reconnecting member without changing its seat', () => {
    const readyRoom = prepareReadyRoom();
    const left = reducePongRoom(readyRoom, {
      type: 'LEAVE_ROOM',
      requestSessionId: 'tab-a',
      expectedRevision: readyRoom.revision,
    }).state;
    const rejoined = reducePongRoom(left, {
      type: 'JOIN_ROOM',
      requestSessionId: 'tab-a',
      expectedRevision: left.revision,
    });

    expect(rejoined.result).toMatchObject({ ok: true });
    expect(rejoined.state.members.find((member) => member.sessionId === 'tab-a')).toMatchObject({
      connected: true,
      side: 'left',
      ready: false,
    });
  });
});

describe('Mesh Pong workflow projection', () => {
  it('derives Lobby, Table, Match, and Result only from facts', () => {
    let workflow = createInitialMeshPongWorkflow('tab-a');
    expect(projectMeshPongWorkflow(workflow).screen).toBe('lobby');

    workflow = reduceMeshPongWorkflow(workflow, { type: 'ROOM_PROJECTED', room: createRoom() });
    expect(projectMeshPongWorkflow(workflow).screen).toBe('table');

    workflow = reduceMeshPongWorkflow(workflow, {
      type: 'MATCH_PROJECTED',
      match: { phase: 'running', generation: 1, winner: null },
    });
    expect(projectMeshPongWorkflow(workflow).screen).toBe('match');

    workflow = reduceMeshPongWorkflow(workflow, {
      type: 'MATCH_PROJECTED',
      match: { phase: 'finished', generation: 1, winner: 'left' },
    });
    expect(projectMeshPongWorkflow(workflow)).toMatchObject({
      screen: 'result',
      winner: 'left',
    });
  });

  it('withholds start authority until the Room actor projects a canonical host', () => {
    const room = { ...prepareReadyRoom(), hostSessionId: null };
    const workflow = reduceMeshPongWorkflow(createInitialMeshPongWorkflow('tab-b'), {
      type: 'ROOM_PROJECTED',
      room,
    });

    expect(projectMeshPongWorkflow(workflow)).toMatchObject({
      screen: 'table',
      isHost: false,
      canStart: false,
    });
  });
});

describe('Mesh Pong Ignite headless workflow', () => {
  it('composes two independent sessions over the same Room and MatchCoordinator actors', async () => {
    const started = await startMeshPongLocal();
    try {
      const server = started.nodes.server;
      if (!server) {
        throw new Error('Expected Mesh Pong local server node.');
      }
      const room = (await server.system.lookup(pong.actors.room.address)) as ActorRef<
        PongRoomState,
        PongRoomCommand
      > | null;
      const matchCoordinator = (await server.system.lookup(
        pong.actors.matchCoordinator.address
      )) as ActorRef<PongMatchState, PongMatchCommand> | null;
      if (!room || !matchCoordinator) {
        throw new Error('Expected canonical Mesh Pong Room and MatchCoordinator actors.');
      }
      const actors = { room, matchCoordinator };
      const sourceA = createMeshPongWorkflowSource({ sessionId: 'tab-a', actors });
      const sourceB = createMeshPongWorkflowSource({ sessionId: 'tab-b', actors });
      const runtimeA = createMeshPongWorkflowRuntime(sourceA);
      const runtimeB = createMeshPongWorkflowRuntime(sourceB);
      const tabA = igniteTest(runtimeA);
      const tabB = igniteTest(runtimeB);

      await tabA.when('createRoom', { code: 'PONG42' });
      await tabB.when('joinRoom');
      await tabA.when('claimSeat', { side: 'left' });
      await tabB.when('claimSeat', { side: 'right' });
      await tabA.when('setReady', { ready: true });
      tabA.expectView({ readiness: '1 / 2', canStart: false, isHost: true });
      tabB.expectView({ readiness: '1 / 2', canStart: false, isHost: false });

      await tabB.when('setReady', { ready: true });
      await sourceA.refresh();
      await sourceB.refresh();
      tabA.expectView({ readiness: '2 / 2', canStart: true, isHost: true });
      tabB.expectView({ readiness: '2 / 2', canStart: false, isHost: false });

      await tabB.when('beginMatch');
      tabB.expectView({ rejection: 'not-host', screen: 'table' });
      await tabA.when('beginMatch');
      // Room produces only a roster handoff. Match stays in its own actor-owned lobby phase.
      tabA.expectView({ screen: 'table' });
      expect(runtimeA.getView()).toMatchObject({ roomCode: 'PONG42', isHost: true });
      expect(runtimeB.getView()).toMatchObject({ roomCode: 'PONG42', isHost: false });

      const story = runtimeB.record('independent tab reconnect');
      await story.execute('projectConnection', { state: 'disconnected' });
      await story.execute('projectConnection', { state: 'connected' });
      expect(story.trace().map((entry) => entry.kind)).toEqual(
        expect.arrayContaining(['command', 'state', 'view'])
      );
      story.stop();
      sourceA.close();
      sourceB.close();
    } finally {
      await started.stop();
    }
  });
});

describe('Mesh Pong workflow screen adapters', () => {
  it('renders accessible Lobby and Table facts without owning lifecycle state', () => {
    const root = document.createElement('div');
    const lobby = projectMeshPongWorkflow(createInitialMeshPongWorkflow('tab-a'));
    renderLobbyScreen(root, lobby);
    expect(root.querySelector('h2')?.textContent).toBe('Lobby');
    expect(root.querySelector('[role="status"]')?.textContent).toContain('connected');

    const workflow = reduceMeshPongWorkflow(createInitialMeshPongWorkflow('tab-a'), {
      type: 'ROOM_PROJECTED',
      room: prepareReadyRoom(),
    });
    renderTableScreen(root, projectMeshPongWorkflow(workflow));
    expect(root.querySelector('h2')?.textContent).toBe('Table PONG42');
    expect(root.querySelectorAll('[data-seat]')).toHaveLength(2);
    expect(root.textContent).toContain('2 / 2 ready');
  });
});

describe('Mesh Pong topology ownership', () => {
  it('keeps room and match lifecycle in separate server actors', () => {
    expect(pong.actors.room.address).toBe('actor://pong-server/room-lobby');
    expect(pong.actors.matchCoordinator.address).toBe('actor://pong-server/match-coordinator');
  });
});
