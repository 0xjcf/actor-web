/**
 * @module agent-workflow-cli/actors/git-actor.test
 * @description Tests for the GitActor BEHAVIOR spawned through the actor system.
 *
 * `createGitActor()` returns a behavior definition built with
 * `defineBehavior().withMachine().onMessage()`, not an actor instance. The real CLI
 * (see core/cli-actor-system.ts) spawns that behavior through an ActorSystem to obtain
 * an `ActorRef`. These tests exercise that same spawn-based contract: the public
 * ActorRef surface, emitted status events, message handling, and lifecycle.
 *
 * Note: a spawned ActorRef surfaces the actor-system snapshot (e.g. value "active"),
 * not the inner XState machine's `value`/`context`. Observable behavior is therefore
 * asserted through emitted events (`subscribeEvent`) and liveness (`isAlive`), not
 * through inner machine state names.
 */

import {
  type ActorMessage,
  type ActorRef,
  type ActorSystem,
  createActorSystem,
} from '@actor-web/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitActor } from './git-actor';

// Mock simple-git so the machine's repo/status probes never touch the real filesystem.
const mockGitInstance = {
  checkIsRepo: vi.fn(),
  status: vi.fn(),
  raw: vi.fn(),
  fetch: vi.fn(),
  merge: vi.fn(),
  add: vi.fn(),
  commit: vi.fn(),
  push: vi.fn(),
};

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => mockGitInstance),
}));

/**
 * Collect emitted events of a given type while exercising the actor.
 */
function collectEvents(actor: ActorRef): {
  events: ActorMessage[];
  stop: () => void;
} {
  const events: ActorMessage[] = [];
  const unsubscribe = actor.subscribeEvent?.((event) => {
    events.push(event);
  });
  return {
    events,
    stop: () => unsubscribe?.(),
  };
}

describe('GitActor behavior', () => {
  let system: ActorSystem;
  let gitActor: ActorRef;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGitInstance.checkIsRepo.mockResolvedValue(true);
    mockGitInstance.status.mockResolvedValue({
      current: 'main',
      isClean: () => true,
      files: [],
    });
    mockGitInstance.raw.mockResolvedValue('');
    mockGitInstance.add.mockResolvedValue(undefined);
    mockGitInstance.commit.mockResolvedValue({ commit: 'abc123' });

    system = createActorSystem({ nodeAddress: 'cli-test-node' });
    await system.start();
    gitActor = await system.spawn(createGitActor('/test/repo'), { id: 'git-actor-test' });
  });

  afterEach(async () => {
    await system.stop();
  });

  // ==========================================================================
  // ACTOR REF CONTRACT
  // ==========================================================================

  describe('ActorRef contract', () => {
    it('exposes the public ActorRef surface', () => {
      expect(gitActor).toBeDefined();
      expect(typeof gitActor.address.id).toBe('string');
      expect(gitActor.address.id).toBe('git-actor-test');
      expect(typeof gitActor.send).toBe('function');
      expect(typeof gitActor.ask).toBe('function');
      expect(typeof gitActor.stop).toBe('function');
      expect(typeof gitActor.getSnapshot).toBe('function');
    });

    it('is running and alive after spawn', async () => {
      const snapshot = gitActor.getSnapshot();
      expect(snapshot).toBeDefined();
      expect(snapshot.value).toBeDefined();
      expect(await gitActor.isAlive()).toBe(true);
    });

    it('assigns a unique address per spawned actor', async () => {
      const other = await system.spawn(createGitActor(), { id: 'git-actor-test-2' });
      expect(gitActor.address.id).not.toBe(other.address.id);
      await other.stop();
    });
  });

  // ==========================================================================
  // EVENT EMISSION
  // ==========================================================================

  describe('Status event emission', () => {
    it('emits GIT_STATUS_RESPONSE for REQUEST_STATUS', async () => {
      const collected = collectEvents(gitActor);

      await gitActor.send({ type: 'REQUEST_STATUS' });
      await system.flush();

      expect(collected.events.some((event) => event.type === 'GIT_STATUS_RESPONSE')).toBe(true);
      collected.stop();
    });

    it('emits GIT_STATUS_RESPONSE for CHECK_STATUS', async () => {
      const collected = collectEvents(gitActor);

      await gitActor.send({ type: 'CHECK_STATUS' });
      await system.flush();

      expect(collected.events.some((event) => event.type === 'GIT_STATUS_RESPONSE')).toBe(true);
      collected.stop();
    });

    it('emits GIT_STATUS_RESPONSE for CHECK_UNCOMMITTED_CHANGES', async () => {
      const collected = collectEvents(gitActor);

      await gitActor.send({ type: 'CHECK_UNCOMMITTED_CHANGES' });
      await system.flush();

      expect(collected.events.some((event) => event.type === 'GIT_STATUS_RESPONSE')).toBe(true);
      collected.stop();
    });
  });

  // ==========================================================================
  // MESSAGE HANDLING
  // ==========================================================================

  describe('Message handling', () => {
    it('processes a repo/status/stage/commit sequence without crashing', async () => {
      await gitActor.send({ type: 'CHECK_REPO' });
      await gitActor.send({ type: 'CHECK_STATUS' });
      await gitActor.send({ type: 'ADD_ALL' });
      await gitActor.send({ type: 'COMMIT_CHANGES', message: 'test: add feature' });
      await system.flush();

      expect(await gitActor.isAlive()).toBe(true);
    });

    it('handles an empty commit message without crashing', async () => {
      await gitActor.send({ type: 'COMMIT_CHANGES', message: '' });
      await system.flush();

      expect(await gitActor.isAlive()).toBe(true);
    });

    it('stays responsive when git operations reject', async () => {
      mockGitInstance.checkIsRepo.mockRejectedValue(new Error('Not a git repository'));
      mockGitInstance.status.mockRejectedValue(new Error('Git operation failed'));

      await gitActor.send({ type: 'CHECK_REPO' });
      await gitActor.send({ type: 'CHECK_STATUS' });
      await system.flush();

      expect(await gitActor.isAlive()).toBe(true);
    });

    it('handles a rapid burst of messages efficiently', async () => {
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        await gitActor.send({ type: 'CHECK_STATUS' });
      }
      await system.flush();
      const elapsed = performance.now() - start;

      expect(await gitActor.isAlive()).toBe(true);
      expect(elapsed).toBeLessThan(5000);
    });
  });

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  describe('Actor lifecycle', () => {
    it('reports alive before stop and not alive after', async () => {
      expect(await gitActor.isAlive()).toBe(true);

      await gitActor.stop();

      expect(await gitActor.isAlive()).toBe(false);
    });

    it('tolerates stop being called more than once', async () => {
      await gitActor.stop();
      await expect(gitActor.stop()).resolves.not.toThrow();
    });
  });
});
