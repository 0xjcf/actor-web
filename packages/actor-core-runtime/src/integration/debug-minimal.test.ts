import { describe, expect, it } from 'vitest';

console.log('🔴 MODULE LOADING: debug-minimal.test.ts is being loaded');

console.log('🔴 IMPORT TEST 1: About to import logger');

import { enableDevModeForCLI } from '../logger';

console.log('✅ IMPORT TEST 1: Logger imported successfully');

console.log('🔴 IMPORT TEST 2: About to import defineBehavior');

import { defineBehavior } from '../create-actor';

console.log('✅ IMPORT TEST 2: defineBehavior imported successfully');

console.log('🔴 IMPORT TEST 3: About to import createActorSystem - THIS IS THE LIKELY CULPRIT');

import { createActorSystem } from '../actor-system-impl';

console.log('✅ IMPORT TEST 3: createActorSystem imported successfully');

describe('Debug Minimal - Module Loading Test', () => {
  console.log('🔴 DESCRIBE BLOCK: Test suite is being defined');

  it('should test step-by-step function calls to isolate hang', async () => {
    console.log('🔴 FUNCTION TEST: Inside the test function');
    enableDevModeForCLI();

    console.log('🟢 STEP 1: Calling createActorSystem()');
    const system = createActorSystem({
      nodeAddress: 'test-node',
    });
    console.log('✅ STEP 1: createActorSystem() completed');

    console.log('🟢 STEP 2: Calling system.start()');
    await system.start();
    console.log('✅ STEP 2: system.start() completed');

    console.log('🟢 STEP 3: Creating behavior');
    const behavior = defineBehavior({
      onMessage: async ({ message }) => {
        if (message.type === 'PING' && message.correlationId) {
          return {
            type: 'RESPONSE', // ⚠️ TEMPORARY: Back to RESPONSE for simple ask pattern
            correlationId: message.correlationId,
            payload: 'pong',
            timestamp: Date.now(),
            version: '1.0.0',
          };
        }
        return undefined;
      },
    });
    console.log('✅ STEP 3: Behavior created');

    console.log('🟢 STEP 4: Calling system.spawn()');
    const actor = await system.spawn(behavior, { id: 'test-actor' });
    console.log('✅ STEP 4: system.spawn() completed');

    console.log('🟡 STEP 5: CRITICAL - Calling actor.ask() - EXPECTED HANG POINT');
    const response = await actor.ask({
      type: 'PING',
      payload: null,
      timestamp: Date.now(),
      version: '1.0.0',
    });
    console.log('✅ STEP 5: actor.ask() completed! Response:', response);

    console.log('🟢 STEP 6: Calling system.stop()');
    await system.stop();
    console.log('✅ STEP 6: system.stop() completed');

    expect(response).toBe('pong');
    console.log('🔴 FUNCTION TEST COMPLETION: All steps completed successfully');
  });
});
