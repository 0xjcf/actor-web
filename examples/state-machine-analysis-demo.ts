/**
 * State Machine Analysis Demo
 *
 * Demonstrates how to use the state machine analysis utilities
 * to analyze XState machines for unreachable states and coverage.
 */

import {
  analyzeStateMachine,
  assertNoUnreachableStates,
  generateCoverageReport,
} from '@actor-core/testing';
import { createMachine } from 'xstate';

// Sample state machine for demonstration
const trafficLightMachine = createMachine({
  id: 'trafficLight',
  initial: 'red',
  states: {
    red: {
      on: { NEXT: 'green' },
    },
    yellow: {
      on: { NEXT: 'red' },
    },
    green: {
      on: { NEXT: 'yellow' },
    },
    // Unreachable state for demonstration
    broken: {
      on: { REPAIR: 'red' },
    },
  },
});

// Analyze the machine
console.log('🔍 Analyzing traffic light machine...');
const analysis = analyzeStateMachine(trafficLightMachine);

console.log('📊 Analysis Results:');
console.log(`Total states: ${analysis.totalStates}`);
console.log(`Reachable states: ${analysis.reachableStates}`);
console.log(`Unreachable states: ${analysis.unreachableStates.length}`);

if (analysis.unreachableStates.length > 0) {
  console.log('❌ Unreachable states found:');
  analysis.unreachableStates.forEach((state) => {
    console.log(`  - ${state}`);
  });
}

// Generate coverage report
console.log('\n📋 Coverage Report:');
console.log(generateCoverageReport(trafficLightMachine, 'Traffic Light'));

// Assertion test (this will fail due to unreachable state)
try {
  assertNoUnreachableStates(trafficLightMachine, 'Traffic Light');
  console.log('✅ All states are reachable!');
} catch (error) {
  console.log('❌ Assertion failed:', error.message);
}
