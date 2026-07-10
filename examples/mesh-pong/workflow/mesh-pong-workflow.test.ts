import { test as igniteTest } from 'ignite-element';
import { describe, expect, it } from 'vitest';
import type { PongMatchRosterHandoff } from '../pong-contract';
import { createInitialPongRoom, type PongRoomState, reducePongRoom } from '../pong-room-contract';
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

  it('preserves the existing pre-authority start gate while the Room actor is introduced', () => {
    const room = { ...prepareReadyRoom(), hostSessionId: null };
    const workflow = reduceMeshPongWorkflow(createInitialMeshPongWorkflow('tab-b'), {
      type: 'ROOM_PROJECTED',
      room,
    });

    expect(projectMeshPongWorkflow(workflow)).toMatchObject({
      screen: 'table',
      isHost: true,
      canStart: true,
    });
  });
});

describe('Mesh Pong Ignite headless workflow', () => {
  it('drives two sessions through readiness, rejection, start, reconnect, and trace', async () => {
    const source = createMeshPongWorkflowSource({ sessionId: 'tab-a', roomId: 'room-1' });
    const runtime = createMeshPongWorkflowRuntime(source);
    const scenario = igniteTest(runtime);

    await scenario.when('createRoom', { code: 'PONG42' });
    scenario.expectView({ screen: 'table', readiness: '0 / 2' });
    await scenario.when('joinRoom', { sessionId: 'tab-b' });
    await scenario.when('claimSeat', { sessionId: 'tab-a', side: 'left' });
    await scenario.when('claimSeat', { sessionId: 'tab-b', side: 'right' });
    await scenario.when('setReady', { sessionId: 'tab-a', ready: true });
    scenario.expectView({ readiness: '1 / 2', canStart: false });
    await scenario.when('beginMatch', { sessionId: 'tab-a' });
    scenario.expectView({ rejection: 'player-not-ready' });
    await scenario.when('setReady', { sessionId: 'tab-b', ready: true });
    scenario.expectView({ readiness: '2 / 2', canStart: true });
    await scenario.when('beginMatch', { sessionId: 'tab-a' });
    scenario.expectView({ screen: 'match' });
    await scenario.when('projectMatch', { phase: 'finished', generation: 1, winner: 'left' });
    scenario.expectView({ screen: 'result', winner: 'left' });

    const story = runtime.record('two session room workflow');
    await story.execute('projectConnection', { state: 'disconnected' });
    await story.execute('projectConnection', { state: 'connected' });
    expect(story.trace().map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(['command', 'state', 'view'])
    );
    expect(runtime.getView()).toMatchObject({ connected: true, roomCode: 'PONG42' });
    story.stop();
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
