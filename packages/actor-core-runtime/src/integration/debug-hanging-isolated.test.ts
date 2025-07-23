import { describe, expect, it } from 'vitest';
import type { ActorSystem } from '../actor-system';
import { createActorSystem } from '../actor-system-impl';
import { defineBehavior } from '../create-actor';
import { enableDevModeForCLI } from '../logger';

describe('Debug Hanging - Completely Isolated Test', () => {
  it('should isolate exact hanging point step by step', async () => {
    console.log('🟢 STEP 1: Test started - enabling dev mode');
    enableDevModeForCLI();

    console.log('🟢 STEP 2: Creating system config');
    const config = {
      nodeId: 'isolated-test-node',
      nodeAddress: 'isolated-test-node',
    };

    console.log('🟢 STEP 3: Calling createActorSystem');
    const system: ActorSystem = createActorSystem(config);
    console.log('✅ STEP 3: System created successfully');

    console.log('🟢 STEP 4: Calling system.start()');
    await system.start();
    console.log('✅ STEP 4: System started successfully');

    console.log('🟢 STEP 5: Creating behavior');
    const askBehavior = defineBehavior({
      onMessage: async ({ message }) => {
        console.log('📨 ISOLATED: Actor received message:', message.type);

        if (message.type === 'PING' && message.correlationId) {
          console.log('🔄 ISOLATED: Responding to PING with PONG...');
          return {
            type: 'PONG',
            correlationId: message.correlationId,
            payload: 'pong',
            timestamp: Date.now(),
            version: '1.0.0',
          };
        }

        return undefined;
      },
    });
    console.log('✅ STEP 5: Behavior created successfully');

    console.log('🟢 STEP 6: Spawning actor');
    const actor = await system.spawn(askBehavior, { id: 'isolated-test-actor' });
    console.log('✅ STEP 6: Actor spawned successfully');

    console.log('🟡 STEP 7: CRITICAL - About to call actor.ask()');
    console.log('🟡 Actor type:', typeof actor);
    console.log('🟡 Ask method type:', typeof actor.ask);

    // This is where we expect the hang to occur
    const response = await actor.ask({
      type: 'PING',
      payload: null,
      timestamp: Date.now(),
      version: '1.0.0',
    });
    console.log('✅ STEP 7: Ask completed! Response:', response);

    console.log('🟢 STEP 8: Stopping system');
    await system.stop();
    console.log('✅ STEP 8: System stopped successfully');

    expect(response).toBe('pong');
  });
});
