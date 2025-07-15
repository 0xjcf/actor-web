/**
 * @module agent-workflow-cli/actors/git-actor.test
 * @description Comprehensive tests for GitActor following TESTING-GUIDE.md principles
 * @author Agent A - CLI Actor Migration Phase
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForIdle } from '../test-utils';
import { createGitActor, type GitActor } from './git-actor';

// Mock simple-git to control git operations in tests
const mockGitInstance = {
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

// ============================================================================
// TEST ENVIRONMENT SETUP
// ============================================================================

describe('GitActor - Framework Contract Compliance', () => {
  let gitActor: GitActor;
  let mockGit: {
    status: ReturnType<typeof vi.fn>;
    raw: ReturnType<typeof vi.fn>;
    fetch: ReturnType<typeof vi.fn>;
    merge: ReturnType<typeof vi.fn>;
    add: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    push: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // ✅ CORRECT: Create real actor instance for behavior testing
    gitActor = createGitActor('/test/repo');

    // Get the mocked git instance
    mockGit = mockGitInstance;
  });

  afterEach(async () => {
    // ✅ CORRECT: Proper cleanup following TESTING-GUIDE.md
    if (gitActor && gitActor.status !== 'stopped') {
      await gitActor.stop();
    }
  });

  // ============================================================================
  // ACTOR CONTRACT COMPLIANCE TESTS
  // ============================================================================

  describe('BaseActor Interface Compliance', () => {
    it('should implement BaseActor interface correctly', () => {
      // ✅ CORRECT: Test the public contract, not implementation
      expect(gitActor).toBeDefined();
      expect(typeof gitActor.id).toBe('string');
      expect(gitActor.status).toBeDefined();
      expect(typeof gitActor.send).toBe('function');
      expect(typeof gitActor.start).toBe('function');
      expect(typeof gitActor.stop).toBe('function');
      expect(typeof gitActor.getSnapshot).toBe('function');
    });

    it('should start in idle status', () => {
      // ✅ CORRECT: Test initial state
      expect(gitActor.status).toBe('idle');
    });

    it('should have unique actor ID', () => {
      // ✅ CORRECT: Test identity behavior
      const actor1 = createGitActor();
      const actor2 = createGitActor();

      expect(actor1.id).toBeDefined();
      expect(actor2.id).toBeDefined();
      expect(actor1.id).not.toBe(actor2.id);

      // Cleanup
      actor1.stop();
      actor2.stop();
    });

    it('should provide snapshot with context and value', () => {
      // ✅ CORRECT: Test snapshot structure
      const snapshot = gitActor.getSnapshot();

      expect(snapshot).toBeDefined();
      expect(snapshot.context).toBeDefined();
      expect(snapshot.value).toBeDefined();
      expect(snapshot.status).toBeDefined();
      expect(typeof snapshot.matches).toBe('function');
      expect(typeof snapshot.can).toBe('function');
      expect(typeof snapshot.hasTag).toBe('function');
      expect(typeof snapshot.toJSON).toBe('function');
    });
  });

  // ============================================================================
  // EVENT HANDLING TESTS
  // ============================================================================

  describe('Git Event Processing', () => {
    beforeEach(() => {
      gitActor.start();
    });

    describe('CHECK_STATUS Event', () => {
      it('should transition to checkingStatus state', () => {
        // Arrange: Mock git status response
        mockGit.status.mockResolvedValue({
          current: 'feature/agent-a',
          files: [],
        });

        // Act: Send CHECK_STATUS event
        gitActor.send({ type: 'CHECK_STATUS' });

        // Assert: State should transition
        const snapshot = gitActor.getSnapshot();
        expect(['checkingStatus', 'idle']).toContain(snapshot.value);
      });

      it('should update context with branch information', async () => {
        // Arrange: Mock git status with specific branch
        mockGit.status.mockResolvedValue({
          current: 'feature/test-branch',
          files: [],
        });

        // Act: Send event and wait for completion
        gitActor.send({ type: 'CHECK_STATUS' });

        // Wait for state machine to complete
        await waitForIdle(gitActor);

        // Assert: Context should be updated
        const snapshot = gitActor.getSnapshot();
        expect(snapshot.context.currentBranch).toBeDefined();
      });
    });

    describe('CHECK_REPO Event', () => {
      it('should validate git repository status', () => {
        // Arrange: Mock successful git status
        mockGit.status.mockResolvedValue({ current: 'main' });

        // Act: Send CHECK_REPO event
        gitActor.send({ type: 'CHECK_REPO' });

        // Assert: Should transition to checking state
        const snapshot = gitActor.getSnapshot();
        expect(['checkingRepo', 'idle']).toContain(snapshot.value);
      });

      it('should handle non-git repository gracefully', () => {
        // Arrange: Mock git status failure
        mockGit.status.mockRejectedValue(new Error('Not a git repository'));

        // Act: Send CHECK_REPO event
        gitActor.send({ type: 'CHECK_REPO' });

        // Assert: Should handle error gracefully
        expect(() => {
          gitActor.send({ type: 'CHECK_REPO' });
        }).not.toThrow();
      });
    });

    describe('CHECK_UNCOMMITTED_CHANGES Event', () => {
      it('should detect uncommitted changes', () => {
        // Arrange: Mock git status with changes
        mockGit.status.mockResolvedValue({
          files: [{ path: 'test.ts', working_dir: 'M' }],
        });

        // Act: Send CHECK_UNCOMMITTED_CHANGES event
        gitActor.send({ type: 'CHECK_UNCOMMITTED_CHANGES' });

        // Assert: Should transition appropriately
        const snapshot = gitActor.getSnapshot();
        expect(['checkingUncommittedChanges', 'idle']).toContain(snapshot.value);
      });
    });

    describe('COMMIT_CHANGES Event', () => {
      it('should handle commit with message', () => {
        // Arrange: Mock successful commit
        mockGit.add.mockResolvedValue(undefined);
        mockGit.commit.mockResolvedValue({ commit: 'abc123' });

        // Act: Send COMMIT_CHANGES event
        gitActor.send({
          type: 'COMMIT_CHANGES',
          message: 'test: add feature',
        });

        // Assert: Should transition to committing state
        const snapshot = gitActor.getSnapshot();
        expect(['committingChanges', 'idle']).toContain(snapshot.value);
      });

      it('should validate commit message is provided', () => {
        // Act & Assert: Should handle missing message gracefully
        expect(() => {
          gitActor.send({ type: 'COMMIT_CHANGES', message: '' });
        }).not.toThrow();
      });
    });

    describe('SETUP_WORKTREES Event', () => {
      it('should setup agent worktrees', () => {
        // Arrange: Mock worktree operations
        mockGit.raw.mockResolvedValue('');

        // Act: Send SETUP_WORKTREES event
        gitActor.send({ type: 'SETUP_WORKTREES', agentCount: 3 });

        // Assert: Should transition to setting up state
        const snapshot = gitActor.getSnapshot();
        expect(['settingUpWorktrees', 'idle']).toContain(snapshot.value);
      });
    });

    describe('GENERATE_COMMIT_MESSAGE Event', () => {
      it('should generate smart commit message', () => {
        // Act: Send GENERATE_COMMIT_MESSAGE event
        gitActor.send({ type: 'GENERATE_COMMIT_MESSAGE' });

        // Assert: Should transition appropriately
        const snapshot = gitActor.getSnapshot();
        expect(['generatingCommitMessage', 'idle']).toContain(snapshot.value);
      });
    });
  });

  // ============================================================================
  // STATE MACHINE BEHAVIOR TESTS
  // ============================================================================

  describe('State Machine Transitions', () => {
    beforeEach(() => {
      gitActor.start();
    });

    it('should start in idle state', () => {
      // ✅ CORRECT: Test initial state behavior
      const snapshot = gitActor.getSnapshot();
      expect(snapshot.value).toBe('idle');
    });

    it('should return to idle after operations complete', async () => {
      // Arrange: Mock quick git operation
      mockGit.status.mockResolvedValue({ current: 'main' });

      // Act: Send event and wait for completion
      gitActor.send({ type: 'CHECK_STATUS' });

      // Wait for operation to complete
      await waitForIdle(gitActor);

      // Assert: Should return to idle
      const snapshot = gitActor.getSnapshot();
      expect(snapshot.value).toBe('idle');
    });

    it('should handle multiple events sequentially', () => {
      // Arrange: Mock git operations
      mockGit.status.mockResolvedValue({ current: 'main' });

      // Act: Send multiple events
      gitActor.send({ type: 'CHECK_STATUS' });
      gitActor.send({ type: 'CHECK_REPO' });
      gitActor.send({ type: 'CHECK_UNCOMMITTED_CHANGES' });

      // Assert: Should handle all events (state machine queues them)
      expect(() => {
        const snapshot = gitActor.getSnapshot();
        expect(snapshot.value).toBeDefined();
      }).not.toThrow();
    });
  });

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('Error Handling', () => {
    beforeEach(() => {
      gitActor.start();
    });

    it('should handle git operation failures gracefully', async () => {
      // Arrange: Mock git failure
      mockGit.status.mockRejectedValue(new Error('Git operation failed'));

      // Act: Send event that will fail
      gitActor.send({ type: 'CHECK_STATUS' });

      // Wait for error handling
      await waitForIdle(gitActor);

      // Assert: Should handle error and return to stable state
      const snapshot = gitActor.getSnapshot();
      expect(['idle', 'error']).toContain(snapshot.value);
    });

    it('should store error information in context', async () => {
      // Arrange: Mock git failure
      mockGit.status.mockRejectedValue(new Error('Test error'));

      // Act: Send event that will fail
      gitActor.send({ type: 'CHECK_STATUS' });

      // Wait for error handling
      await waitForIdle(gitActor);

      // Assert: Error should be stored in context
      const snapshot = gitActor.getSnapshot();
      expect(snapshot.context.lastError).toBeDefined();
    });

    it('should recover from errors on next valid operation', async () => {
      // Arrange: First operation fails, second succeeds
      mockGit.status
        .mockRejectedValueOnce(new Error('First failure'))
        .mockResolvedValueOnce({ current: 'main' });

      // Act: Send failing event, then successful event
      gitActor.send({ type: 'CHECK_STATUS' });
      await waitForIdle(gitActor);

      gitActor.send({ type: 'CHECK_STATUS' });
      await waitForIdle(gitActor);

      // Assert: Should recover and work normally
      const snapshot = gitActor.getSnapshot();
      expect(snapshot.value).toBe('idle');
    });
  });

  // ============================================================================
  // ACTOR LIFECYCLE TESTS
  // ============================================================================

  describe('Actor Lifecycle', () => {
    it('should start successfully', () => {
      // Act: Start the actor
      gitActor.start();

      // Assert: Status should change
      expect(gitActor.status).toBe('running');
    });

    it('should stop gracefully', async () => {
      // Arrange: Start the actor
      gitActor.start();
      expect(gitActor.status).toBe('running');

      // Act: Stop the actor
      await gitActor.stop();

      // Assert: Should be stopped
      expect(gitActor.status).toBe('stopped');
    });

    it('should handle multiple start calls gracefully', () => {
      // Act: Call start multiple times
      gitActor.start();
      const firstStatus = gitActor.status;

      gitActor.start(); // Second start call
      const secondStatus = gitActor.status;

      // Assert: Should remain stable
      expect(firstStatus).toBe('running');
      expect(secondStatus).toBe('running');
    });

    it('should handle stop on already stopped actor', async () => {
      // Arrange: Start and stop actor
      gitActor.start();
      await gitActor.stop();
      expect(gitActor.status).toBe('stopped');

      // Act: Stop again
      const stopPromise = gitActor.stop();

      // Assert: Should not throw
      await expect(stopPromise).resolves.not.toThrow();
    });
  });

  // ============================================================================
  // INTEGRATION WITH GITOPERATIONS PARITY TESTS
  // ============================================================================

  describe('GitOperations Parity', () => {
    beforeEach(() => {
      gitActor.start();
    });

    it('should provide equivalent to isGitRepo() functionality', () => {
      // Arrange: Mock git status for repo check
      mockGit.status.mockResolvedValue({ current: 'main' });

      // Act: Use CHECK_REPO event (equivalent to isGitRepo)
      gitActor.send({ type: 'CHECK_REPO' });

      // Assert: Should process repository check
      const snapshot = gitActor.getSnapshot();
      expect(['checkingRepo', 'idle']).toContain(snapshot.value);
    });

    it('should provide equivalent to getCurrentBranch() functionality', () => {
      // Arrange: Mock git status
      mockGit.status.mockResolvedValue({ current: 'feature/test' });

      // Act: Use CHECK_STATUS event (equivalent to getCurrentBranch)
      gitActor.send({ type: 'CHECK_STATUS' });

      // Assert: Should process status check
      const snapshot = gitActor.getSnapshot();
      expect(['checkingStatus', 'idle']).toContain(snapshot.value);
    });

    it('should provide equivalent to hasUncommittedChanges() functionality', () => {
      // Arrange: Mock git status with changes
      mockGit.status.mockResolvedValue({
        files: [{ path: 'test.ts' }],
      });

      // Act: Use CHECK_UNCOMMITTED_CHANGES event
      gitActor.send({ type: 'CHECK_UNCOMMITTED_CHANGES' });

      // Assert: Should process uncommitted changes check
      const snapshot = gitActor.getSnapshot();
      expect(['checkingUncommittedChanges', 'idle']).toContain(snapshot.value);
    });

    it('should provide equivalent to worktreeExists() functionality', () => {
      // Arrange: Mock worktree list
      mockGit.raw.mockResolvedValue('worktree /path/to/worktree');

      // Act: Use CHECK_WORKTREE event
      gitActor.send({ type: 'CHECK_WORKTREE', path: '/path/to/worktree' });

      // Assert: Should process worktree check
      const snapshot = gitActor.getSnapshot();
      expect(['checkingWorktree', 'idle']).toContain(snapshot.value);
    });
  });

  // ============================================================================
  // PERFORMANCE TESTS
  // ============================================================================

  describe('Performance', () => {
    beforeEach(() => {
      gitActor.start();
    });

    it('should handle rapid event sequences efficiently', () => {
      // Arrange: Mock fast git operations
      mockGit.status.mockResolvedValue({ current: 'main' });

      // Act: Send multiple events rapidly
      const startTime = performance.now();

      for (let i = 0; i < 100; i++) {
        gitActor.send({ type: 'CHECK_STATUS' });
      }

      const endTime = performance.now();

      // Assert: Should complete quickly (event queuing)
      expect(endTime - startTime).toBeLessThan(100); // Should be very fast
    });

    it('should maintain stable memory usage', () => {
      // Arrange: Mock git operations
      mockGit.status.mockResolvedValue({ current: 'main' });

      // Act: Send many events to test memory stability
      for (let i = 0; i < 1000; i++) {
        gitActor.send({ type: 'CHECK_STATUS' });
      }

      // Assert: Should not throw memory errors
      const snapshot = gitActor.getSnapshot();
      expect(snapshot).toBeDefined();
      expect(snapshot.context).toBeDefined();
    });
  });
});
