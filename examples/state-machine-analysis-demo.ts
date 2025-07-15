/**
 * @module examples/state-machine-analysis-demo
 * @description Demonstrates how to use @xstate/graph for state machine analysis
 * @author Agent A - 2025-07-15
 */

import { createMachine } from 'xstate';
import {
  analyzeStateMachine,
  assertNoUnreachableStates,
  generateCoverageReport,
} from '../src/testing/state-machine-analysis.js';

// Example 1: A simple machine with all reachable states
const trafficLightMachine = createMachine({
  id: 'trafficLight',
  initial: 'red',
  states: {
    red: {
      on: { NEXT: 'green' },
    },
    green: {
      on: { NEXT: 'yellow' },
    },
    yellow: {
      on: { NEXT: 'red' },
    },
  },
});

// Example 2: A machine with unreachable states
const problematicMachine = createMachine({
  id: 'problematic',
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
    // This state cannot be reached from 'start'
    orphaned: {
      on: {
        BACK: 'start',
      },
    },
  },
});

// Example 3: A complex nested machine
const nestedMachine = createMachine({
  id: 'nested',
  initial: 'auth',
  states: {
    auth: {
      initial: 'login',
      states: {
        login: {
          on: {
            SUCCESS: 'success',
            ERROR: 'error',
          },
        },
        success: {
          type: 'final',
        },
        error: {
          on: {
            RETRY: 'login',
          },
        },
      },
      onDone: 'dashboard',
    },
    dashboard: {
      initial: 'loading',
      states: {
        loading: {
          on: {
            LOADED: 'ready',
            ERROR: 'error',
          },
        },
        ready: {
          on: {
            LOGOUT: '#nested.auth.login',
          },
        },
        error: {
          on: {
            RETRY: 'loading',
          },
        },
      },
    },
  },
});

// Demo function
function runStateAnalysisDemo(): void {
  console.log('🔍 State Machine Analysis Demo using @xstate/graph');
  console.log('='.repeat(60));

  // Example 1: Analyze a simple machine
  console.log('\n1. Traffic Light Machine (All states reachable)');
  console.log('-'.repeat(50));

  const trafficAnalysis = analyzeStateMachine(trafficLightMachine);
  console.log('Analysis:', trafficAnalysis);

  // This should pass
  try {
    assertNoUnreachableStates(trafficLightMachine, 'TrafficLight');
    console.log('✅ TrafficLight has no unreachable states');
  } catch (error) {
    console.log('❌ TrafficLight has unreachable states:', error.message);
  }

  // Example 2: Analyze a problematic machine
  console.log('\n2. Problematic Machine (Has unreachable states)');
  console.log('-'.repeat(50));

  const problemAnalysis = analyzeStateMachine(problematicMachine);
  console.log('Analysis:', problemAnalysis);

  // This should throw
  try {
    assertNoUnreachableStates(problematicMachine, 'Problematic');
    console.log('✅ Problematic has no unreachable states');
  } catch (error) {
    console.log('❌ Problematic has unreachable states:', error.message);
  }

  // Example 3: Generate coverage reports
  console.log('\n3. Coverage Reports');
  console.log('-'.repeat(50));

  console.log('TrafficLight Coverage:');
  console.log(generateCoverageReport(trafficLightMachine, 'TrafficLight'));

  console.log('Problematic Coverage:');
  console.log(generateCoverageReport(problematicMachine, 'Problematic'));

  // Example 4: Complex nested machine
  console.log('\n4. Nested Machine Analysis');
  console.log('-'.repeat(50));

  const nestedAnalysis = analyzeStateMachine(nestedMachine);
  console.log('Analysis:', nestedAnalysis);

  console.log('Nested Machine Coverage:');
  console.log(generateCoverageReport(nestedMachine, 'Nested'));
}

// Example usage in tests
export function exampleTestUsage(): void {
  console.log('\n📋 Example Test Usage Patterns');
  console.log('='.repeat(60));

  // Pattern 1: Validate machine structure in test setup
  console.log('\n1. Test Setup Validation:');
  console.log('```typescript');
  console.log('describe("MyMachine", () => {');
  console.log('  beforeEach(() => {');
  console.log('    // Ensure no unreachable states');
  console.log('    assertNoUnreachableStates(myMachine, "MyMachine");');
  console.log('  });');
  console.log('  // ... your tests');
  console.log('});');
  console.log('```');

  // Pattern 2: Coverage analysis
  console.log('\n2. Coverage Analysis:');
  console.log('```typescript');
  console.log('it("should have 100% state coverage", () => {');
  console.log('  const analysis = analyzeStateMachine(myMachine);');
  console.log('  expect(analysis.unreachableStates).toHaveLength(0);');
  console.log('});');
  console.log('```');

  // Pattern 3: Debugging with reports
  console.log('\n3. Debugging with Reports:');
  console.log('```typescript');
  console.log('if (process.env.NODE_ENV === "development") {');
  console.log('  console.log(generateCoverageReport(myMachine, "MyMachine"));');
  console.log('}');
  console.log('```');
}

// Run the demo
if (import.meta.url === `file://${process.argv[1]}`) {
  runStateAnalysisDemo();
  exampleTestUsage();
}

export { trafficLightMachine, problematicMachine, nestedMachine };
