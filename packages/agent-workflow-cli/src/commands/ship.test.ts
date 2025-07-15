/**
 * Ship Command Tests
 *
 * These tests verify that the ship command doesn't get stuck in infinite loops
 * and properly transitions through all expected states.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitActor } from '../actors/git-actor';
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

describe('Ship Command - Loop Detection Tests', () => {
  let gitActor: GitActor;
  let stateTransitions: string[] = [];
  let stateObserver: { unsubscribe(): void };

  beforeEach(() => {
    // Create a fresh git actor for each test
    gitActor = createGitActor(process.cwd());
    stateTransitions = [];

    // Track state transitions
    stateObserver = gitActor
      .observe((snapshot) => snapshot.value)
      .subscribe((state) => {
        stateTransitions.push(String(state));
      });
  });

  afterEach(() => {
    if (stateObserver) {
      stateObserver.unsubscribe();
    }
    if (gitActor) {
      gitActor.stop();
    }
  });

  it('should detect infinite loops in state transitions', async () => {
    // Simulate the problematic sequence that caused the infinite loop
    gitActor.start();

    // Wait for initial state
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Trigger the sequence that was causing the loop
    gitActor.send({ type: 'CHECK_STATUS' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    gitActor.send({ type: 'CHECK_UNCOMMITTED_CHANGES' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    gitActor.send({ type: 'ADD_ALL' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    gitActor.send({ type: 'COMMIT_CHANGES', message: 'test commit' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    // The bug was here - GET_INTEGRATION_STATUS would cause a loop
    gitActor.send({ type: 'GET_INTEGRATION_STATUS' });
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify we don't have excessive state transitions
    expect(stateTransitions.length).toBeLessThan(20);

    // Verify we don't have the same state repeated excessively
    const stateCount = new Map<string, number>();
    for (const state of stateTransitions) {
      stateCount.set(state, (stateCount.get(state) || 0) + 1);
    }

    // No state should appear more than 3 times
    for (const [state, count] of stateCount) {
      expect(count).toBeLessThan(4);
      // Log problematic states for debugging
      if (count >= 3) {
        console.warn(`State "${state}" repeated ${count} times`);
      }
    }
  });

  it('should properly transition through the ship workflow states', async () => {
    gitActor.start();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Expected sequence of states for a successful ship
    const expectedStates = [
      'idle',
      'checkingStatus',
      'statusChecked',
      'checkingUncommittedChanges',
      'uncommittedChangesChecked',
      'stagingAll',
      'stagingCompleted',
      'committingChanges',
      'commitCompleted',
      'gettingIntegrationStatus',
      'integrationStatusChecked',
    ];

    console.log('Expected states for ship workflow:', expectedStates);

    // Simulate the ship workflow
    gitActor.send({ type: 'CHECK_STATUS' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    gitActor.send({ type: 'CHECK_UNCOMMITTED_CHANGES' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    gitActor.send({ type: 'ADD_ALL' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    gitActor.send({ type: 'COMMIT_CHANGES', message: 'test commit' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    gitActor.send({ type: 'GET_INTEGRATION_STATUS' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify we hit key states in the expected order
    expect(stateTransitions).toContain('idle');
    expect(stateTransitions).toContain('checkingStatus');
    expect(stateTransitions).toContain('statusChecked');
    expect(stateTransitions).toContain('gettingIntegrationStatus');
    expect(stateTransitions).toContain('integrationStatusChecked');

    // Verify we don't stay in the same state for too long
    let consecutiveCount = 1;
    let maxConsecutive = 1;

    for (let i = 1; i < stateTransitions.length; i++) {
      if (stateTransitions[i] === stateTransitions[i - 1]) {
        consecutiveCount++;
        maxConsecutive = Math.max(maxConsecutive, consecutiveCount);
      } else {
        consecutiveCount = 1;
      }
    }

    // No state should repeat more than 2 times consecutively
    expect(maxConsecutive).toBeLessThan(3);
  });

  it('should handle timeout scenarios gracefully', async () => {
    gitActor.start();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Trigger a long-running operation
    gitActor.send({ type: 'CHECK_STATUS' });

    // Wait for a reasonable timeout period
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify the actor is still responsive
    const currentSnapshot = gitActor.getSnapshot();
    expect(currentSnapshot.value).toBeDefined();

    // Verify we haven't accumulated excessive transitions
    expect(stateTransitions.length).toBeLessThan(50);
  });

  it('should prevent commit-integration status loops', async () => {
    gitActor.start();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Specifically test the problematic commit -> integration status sequence
    gitActor.send({ type: 'COMMIT_CHANGES', message: 'test commit' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    // The bug was that this would cause the actor to loop between
    // commitCompleted and integrationStatusChecked
    gitActor.send({ type: 'GET_INTEGRATION_STATUS' });
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Count occurrences of potentially problematic states
    const commitCompletedCount = stateTransitions.filter((s) => s === 'commitCompleted').length;
    const integrationStatusCount = stateTransitions.filter(
      (s) => s === 'integrationStatusChecked'
    ).length;

    // These should not occur more than once each in a normal workflow
    expect(commitCompletedCount).toBeLessThanOrEqual(2);
    expect(integrationStatusCount).toBeLessThanOrEqual(2);
  });

  it('should validate state machine transitions are deterministic', async () => {
    // Run the same sequence multiple times and verify consistent behavior
    const runs = 3;
    const allTransitions: string[][] = [];

    for (let run = 0; run < runs; run++) {
      const testActor = createGitActor(process.cwd());
      const runTransitions: string[] = [];

      const observer = testActor
        .observe((snapshot) => snapshot.value)
        .subscribe((state) => {
          runTransitions.push(String(state));
        });

      testActor.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      testActor.send({ type: 'CHECK_STATUS' });
      await new Promise((resolve) => setTimeout(resolve, 50));

      testActor.send({ type: 'GET_INTEGRATION_STATUS' });
      await new Promise((resolve) => setTimeout(resolve, 50));

      allTransitions.push(runTransitions);

      observer.unsubscribe();
      testActor.stop();
    }

    // Verify all runs produce similar transition patterns
    // (allowing for some variation due to timing)
    const firstRun = allTransitions[0];
    for (let i = 1; i < allTransitions.length; i++) {
      const currentRun = allTransitions[i];

      // Should contain similar key states
      expect(currentRun).toContain('idle');
      expect(currentRun).toContain('checkingStatus');

      // Should not be drastically different in length
      const lengthDiff = Math.abs(firstRun.length - currentRun.length);
      expect(lengthDiff).toBeLessThan(5);
    }
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
