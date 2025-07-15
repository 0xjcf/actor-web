/**
 * @module framework/testing/state-machine-analysis.test
 * @description Tests for state machine analysis utilities
 * @author Agent A - 2025-01-10
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createActor, createMachine } from 'xstate';
import { enableDevMode } from '../core/dev-mode.js';
import { createTestEnvironment, type TestEnvironment } from './actor-test-utils.js';
import {
  counterMachine,
  delayedMachine,
  errorProneMachine,
  trafficLightMachine,
} from './fixtures/test-machines.js';
import {
  analyzeStateMachine,
  assertNoUnreachableStates,
  generateCoverageReport,
} from './state-machine-analysis.js';

// Enable dev mode for testing
enableDevMode();

describe('State Machine Analysis', () => {
  let testEnv: TestEnvironment;

  beforeEach(() => {
    testEnv = createTestEnvironment();
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  describe('analyzeStateMachine', () => {
    it('should analyze a simple machine with all reachable states', () => {
      const result = analyzeStateMachine(trafficLightMachine);

      expect(result.totalStates).toBe(3);
      expect(result.reachableStates).toBe(3);
      expect(result.unreachableStates).toHaveLength(0);
      expect(Object.keys(result.reachablePaths)).toHaveLength(3);
    });

    it('should analyze counter machine', () => {
      const result = analyzeStateMachine(counterMachine);

      expect(result.totalStates).toBe(1);
      expect(result.reachableStates).toBe(1);
      expect(result.unreachableStates).toHaveLength(0);
    });

    it('should analyze error-prone machine', () => {
      const result = analyzeStateMachine(errorProneMachine);

      expect(result.totalStates).toBeGreaterThan(0);
      expect(result.reachableStates).toBeGreaterThan(0);
      expect(result.unreachableStates).toEqual([]);
    });

    it('should detect unreachable states in a machine with orphaned states', () => {
      const machineWithUnreachableState = createMachine({
        id: 'unreachable-test',
        initial: 'start',
        states: {
          start: {
            on: {
              NEXT: 'middle',
            },
          },
          middle: {
            on: {
              FINISH: 'end',
            },
          },
          end: {
            type: 'final',
          },
          // This state is unreachable
          orphaned: {
            on: {
              BACK: 'start',
            },
          },
        },
      });

      const result = analyzeStateMachine(machineWithUnreachableState);

      expect(result.totalStates).toBe(4);
      expect(result.reachableStates).toBe(3);
      expect(result.unreachableStates).toContain('orphaned');
      expect(result.unreachableStates).toHaveLength(1);
    });

    it('should handle nested states correctly', () => {
      const nestedMachine = createMachine({
        id: 'nested-test',
        initial: 'parent',
        states: {
          parent: {
            initial: 'child1',
            states: {
              child1: {
                on: {
                  NEXT: 'child2',
                },
              },
              child2: {
                on: {
                  BACK: 'child1',
                },
              },
            },
          },
          other: {
            on: {
              BACK: 'parent',
            },
          },
        },
      });

      const result = analyzeStateMachine(nestedMachine);

      expect(result.totalStates).toBe(3); // parent, parent.child1, parent.child2
      expect(result.reachableStates).toBe(2); // parent.child1, parent.child2 (other is unreachable)
      expect(result.unreachableStates).toContain('other');
    });

    it('should handle delayed transitions', () => {
      const result = analyzeStateMachine(delayedMachine);

      expect(result.totalStates).toBe(2);
      expect(result.reachableStates).toBe(2);
      expect(result.unreachableStates).toHaveLength(0);
    });
  });

  describe('assertNoUnreachableStates', () => {
    it('should pass for machines with all reachable states', () => {
      expect(() => assertNoUnreachableStates(trafficLightMachine)).not.toThrow();
    });

    it('should throw for machines with unreachable states', () => {
      const machineWithUnreachableState = createMachine({
        id: 'unreachable-test',
        initial: 'start',
        states: {
          start: {
            on: {
              NEXT: 'end',
            },
          },
          end: {
            type: 'final',
          },
          orphaned: {
            on: {
              BACK: 'start',
            },
          },
        },
      });

      expect(() => assertNoUnreachableStates(machineWithUnreachableState)).toThrow(
        'unreachable-test has 1 unreachable states: orphaned'
      );
    });

    it('should accept custom machine name in error message', () => {
      const machineWithUnreachableState = createMachine({
        id: 'test',
        initial: 'start',
        states: {
          start: {},
          orphaned: {},
        },
      });

      expect(() =>
        assertNoUnreachableStates(machineWithUnreachableState, 'MyCustomMachine')
      ).toThrow('MyCustomMachine has 1 unreachable states: orphaned');
    });
  });

  describe('generateCoverageReport', () => {
    it('should generate a detailed coverage report', () => {
      const report = generateCoverageReport(trafficLightMachine, 'TrafficLight');

      expect(report).toContain('=== State Machine Coverage Report: TrafficLight ===');
      expect(report).toContain('Total States: 3');
      expect(report).toContain('Reachable States: 3');
      expect(report).toContain('Coverage: 100%');
      expect(report).toContain('✅ All states are reachable!');
    });

    it('should show unreachable states in report', () => {
      const machineWithUnreachableState = createMachine({
        id: 'unreachable-test',
        initial: 'start',
        states: {
          start: {
            on: {
              NEXT: 'end',
            },
          },
          end: {
            type: 'final',
          },
          orphaned: {
            on: {
              BACK: 'start',
            },
          },
        },
      });

      const report = generateCoverageReport(machineWithUnreachableState, 'TestMachine');

      expect(report).toContain('Total States: 3');
      expect(report).toContain('Reachable States: 2');
      expect(report).toContain('Coverage: 67%');
      expect(report).toContain('❌ Unreachable States (1):');
      expect(report).toContain('- orphaned');
    });

    it('should include state paths information', () => {
      const report = generateCoverageReport(trafficLightMachine);

      expect(report).toContain('📊 State Paths');
      expect(report).toContain('steps');
    });
  });

  describe('Integration with existing testing patterns', () => {
    it('should work with the actor test framework', () => {
      // Create an actor from the machine
      const actor = createActor(trafficLightMachine);
      actor.start();

      // Analyze the machine
      const result = analyzeStateMachine(trafficLightMachine);

      // All states should be reachable
      expect(result.unreachableStates).toHaveLength(0);

      // Test that we can actually reach the states
      expect(actor.getSnapshot().value).toBe('red');

      actor.send({ type: 'NEXT' });
      expect(actor.getSnapshot().value).toBe('green');

      actor.send({ type: 'NEXT' });
      expect(actor.getSnapshot().value).toBe('yellow');

      actor.send({ type: 'NEXT' });
      expect(actor.getSnapshot().value).toBe('red');

      actor.stop();
    });

    it('should be useful in test setup to validate machine structure', () => {
      // This could be used as a beforeEach check for critical machines
      const machines = [trafficLightMachine, counterMachine, errorProneMachine, delayedMachine];

      machines.forEach((machine) => {
        // Each machine should have no unreachable states
        expect(() => assertNoUnreachableStates(machine)).not.toThrow();
      });
    });
  });
});
