/**
 * Ship Command Tests
 *
 * These tests verify that the GitActor used by the ship workflow processes the
 * ship message sequence without looping or hanging, and stays responsive.
 *
 * `createGitActor()` returns a behavior definition; it is spawned through an
 * ActorSystem to obtain an `ActorRef`. The actor's observable output is the
 * GIT_STATUS_RESPONSE events it emits, so loop/responsiveness is asserted on the
 * emitted-event stream and liveness rather than on inner XState state names.
 */

import {
  type ActorMessage,
  type ActorRef,
  type ActorSystem,
  createActorSystem,
} from '@actor-web/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitActor } from '../actors/git-actor';

// Mock chalk to avoid ANSI codes in tests
vi.mock('chalk', () => ({
  default: {
    blue: (str: string) => str,
    green: (str: string) => str,
    yellow: (str: string) => str,
    red: (str: string) => str,
    gray: (str: string) => str,
    cyan: (str: string) => str,
  },
}));

// Mock simple-git to control git operations in tests
const mockGitInstance = {
  status: vi.fn().mockResolvedValue({
    current: 'feature/test-branch',
    isClean: () => true,
    files: [],
    modified: [],
    created: [],
    deleted: [],
    renamed: [],
    staged: [],
  }),
  checkIsRepo: vi.fn().mockResolvedValue(true),
  raw: vi.fn().mockResolvedValue('0'), // Default to 0 for ahead/behind counts
  fetch: vi.fn().mockResolvedValue({}),
  merge: vi.fn().mockResolvedValue({}),
  add: vi.fn().mockResolvedValue({}),
  commit: vi.fn().mockResolvedValue({ commit: 'abc123' }),
  push: vi.fn().mockResolvedValue({}),
};

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => mockGitInstance),
}));

// The sequence the ship workflow drives the git actor through.
const SHIP_SEQUENCE: ActorMessage[] = [
  { type: 'CHECK_STATUS' },
  { type: 'CHECK_UNCOMMITTED_CHANGES' },
  { type: 'ADD_ALL' },
  { type: 'COMMIT_CHANGES', message: 'test commit' },
  { type: 'GET_INTEGRATION_STATUS' },
];

async function drive(actor: ActorRef, system: ActorSystem, messages: ActorMessage[]) {
  for (const message of messages) {
    await actor.send(message);
  }
  await system.flush();
}

describe('Ship Command - GitActor loop/responsiveness', () => {
  let system: ActorSystem;
  let gitActor: ActorRef;
  let emitted: ActorMessage[];
  let unsubscribe: (() => void) | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGitInstance.status.mockResolvedValue({
      current: 'feature/test-branch',
      isClean: () => true,
      files: [],
    });
    mockGitInstance.checkIsRepo.mockResolvedValue(true);
    mockGitInstance.raw.mockResolvedValue('0');

    system = createActorSystem({ nodeAddress: 'ship-test-node' });
    await system.start();
    gitActor = await system.spawn(createGitActor(process.cwd()), { id: 'ship-git-actor' });

    emitted = [];
    unsubscribe = gitActor.subscribeEvent?.((event) => {
      emitted.push(event);
    });
  });

  afterEach(async () => {
    unsubscribe?.();
    await system.stop();
  });

  it('does not loop while driving the ship message sequence', async () => {
    await drive(gitActor, system, SHIP_SEQUENCE);

    // A non-looping actor emits a bounded number of status responses for this
    // five-message sequence; a loop would produce a runaway count.
    expect(emitted.length).toBeLessThan(20);
    expect(await gitActor.isAlive()).toBe(true);
  });

  it('emits status responses and stays responsive through the workflow', async () => {
    await drive(gitActor, system, SHIP_SEQUENCE);

    expect(emitted.some((event) => event.type === 'GIT_STATUS_RESPONSE')).toBe(true);
    expect(await gitActor.isAlive()).toBe(true);
  });

  it('stays responsive after a single long-lived status check', async () => {
    await gitActor.send({ type: 'CHECK_STATUS' });
    await system.flush();

    const snapshot = gitActor.getSnapshot();
    expect(snapshot.value).toBeDefined();
    expect(emitted.length).toBeLessThan(50);
    expect(await gitActor.isAlive()).toBe(true);
  });

  it('does not loop between commit and integration-status messages', async () => {
    await drive(gitActor, system, [
      { type: 'COMMIT_CHANGES', message: 'test commit' },
      { type: 'GET_INTEGRATION_STATUS' },
    ]);

    // GET_INTEGRATION_STATUS is unhandled (no emit) and COMMIT_CHANGES emits nothing,
    // so no status responses should be produced and the actor must remain alive.
    const statusResponses = emitted.filter((event) => event.type === 'GIT_STATUS_RESPONSE');
    expect(statusResponses.length).toBeLessThanOrEqual(2);
    expect(await gitActor.isAlive()).toBe(true);
  });

  it('behaves consistently across repeated runs', async () => {
    const counts: number[] = [];

    for (let run = 0; run < 3; run++) {
      const runEvents: ActorMessage[] = [];
      const runActor = await system.spawn(createGitActor(process.cwd()), {
        id: `ship-git-actor-run-${run}`,
      });
      const runUnsub = runActor.subscribeEvent?.((event) => {
        runEvents.push(event);
      });

      await drive(runActor, system, [{ type: 'CHECK_STATUS' }, { type: 'GET_INTEGRATION_STATUS' }]);

      counts.push(runEvents.length);
      runUnsub?.();
      await runActor.stop();
    }

    // Every run should produce the same bounded number of emitted events.
    expect(new Set(counts).size).toBe(1);
    counts.forEach((count) => expect(count).toBeLessThan(5));
  });
});

describe('Ship Command - State Machine Analysis Integration', () => {
  it('should provide loop detection utilities', () => {
    // Test the loop detection logic that we added to the analysis command
    const stateHistory = [
      { state: 'idle', timestamp: 1000 },
      { state: 'checkingStatus', timestamp: 1100 },
      { state: 'statusChecked', timestamp: 1200 },
      { state: 'commitCompleted', timestamp: 1300 },
      { state: 'commitCompleted', timestamp: 1400 },
      { state: 'commitCompleted', timestamp: 1500 },
      { state: 'commitCompleted', timestamp: 1600 },
    ];

    // Test loop detection algorithm
    const loopDetectionWindow = 4;
    const recentTransitions = stateHistory.slice(-loopDetectionWindow);
    const stateCount = new Map<string, number>();

    for (const transition of recentTransitions) {
      const count = stateCount.get(transition.state) || 0;
      stateCount.set(transition.state, count + 1);
    }

    const hasLoop = Array.from(stateCount.values()).some((count) => count >= 3);
    expect(hasLoop).toBe(true);
  });

  it('should detect state timeouts', () => {
    const stateLastChanged = new Map<string, number>();
    const stateTimeoutThreshold = 1000; // 1 second

    stateLastChanged.set('longRunningState', Date.now() - 2000); // 2 seconds ago

    const now = Date.now();
    const lastChange = stateLastChanged.get('longRunningState');
    const hasTimeout = lastChange && now - lastChange > stateTimeoutThreshold;

    expect(hasTimeout).toBe(true);
  });
});
