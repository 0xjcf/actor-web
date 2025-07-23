import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActorSystem } from '../actor-system';
import { createActorSystem } from '../actor-system-impl';
import { defineBehavior } from '../create-actor';
import { enableDevModeForCLI } from '../logger';

describe('Debug Hanging - Step by Step Isolation', () => {
  let system: ActorSystem;

  const config = {
    nodeId: 'test-node',
    nodeAddress: 'test-node',
  };

  beforeEach(async () => {
    // ✅ ENABLE DEBUG LOGS: Override test setup resetDevMode()
    enableDevModeForCLI();

    console.log('🔍 Starting system creation...');
    system = createActorSystem(config);
    console.log('✅ System created, starting...');
    await system.start();
    console.log('✅ System started successfully');
  });

  afterEach(async () => {
    if (system?.isRunning()) {
      console.log('🔍 Stopping system...');
      await system.stop();
      console.log('✅ System stopped');
    }
  });

  it('should create and start actor system without hanging', async () => {
    console.log('🔍 Testing basic system functionality...');
    expect(system.isRunning()).toBe(true);
    console.log('✅ Basic test passed');
  });

  it('should create behavior definition without hanging', async () => {
    console.log('🔍 Testing defineBehavior...');

    const simpleBehavior = defineBehavior({
      onMessage: async ({ message }) => {
        console.log('📨 Behavior would handle:', message.type);
        return undefined;
      },
    });

    console.log('✅ defineBehavior completed successfully');
    expect(simpleBehavior).toBeDefined();
    expect(typeof simpleBehavior.onMessage).toBe('function');
  });

  it('should spawn actor without hanging', async () => {
    console.log('🔍 Creating behavior for spawning test...');

    const spawnBehavior = defineBehavior({
      onMessage: async ({ message }) => {
        console.log('📨 Spawned actor received:', message.type);
        return undefined;
      },
    });

    console.log('🔍 Calling system.spawn...');
    const actor = await system.spawn(spawnBehavior, { id: 'spawn-test-actor' });
    console.log('✅ Actor spawned successfully');

    expect(actor).toBeDefined();
    expect(typeof actor.send).toBe('function');
  });

  it('should send message to actor without hanging', async () => {
    console.log('🔍 Creating behavior for message sending test...');

    const messageBehavior = defineBehavior({
      onMessage: async ({ message }) => {
        console.log('📨 Actor received message:', message.type);
        return undefined;
      },
    });

    console.log('🔍 Spawning actor for message test...');
    const actor = await system.spawn(messageBehavior, { id: 'message-test-actor' });
    console.log('✅ Actor spawned for message test');

    console.log('🔍 Calling actor.send...');
    await actor.send({
      type: 'TEST_MESSAGE',
      payload: { test: true },
      timestamp: Date.now(),
      version: '1.0.0',
    });
    console.log('✅ Message sent successfully');

    expect(actor).toBeDefined();
  });

  it('should handle ask pattern - THIS IS WHERE HANG OCCURS', async () => {
    console.log('🟢 TEST START: Ask pattern test beginning');
    console.log('🔍 Creating behavior for ask pattern test...');

    const askBehavior = defineBehavior({
      onMessage: async ({ message }) => {
        console.log('📨 Ask actor received message:', message.type);

        if (message.type === 'PING' && message.correlationId) {
          console.log('🔄 Ask actor responding to PING with business message...');
          return {
            type: 'PONG', // ✅ Business message type (not RESPONSE)
            correlationId: message.correlationId,
            payload: 'pong',
            timestamp: Date.now(),
            version: '1.0.0',
          };
        }

        return undefined;
      },
    });

    console.log('🔍 Spawning actor for ask test...');
    const actor = await system.spawn(askBehavior, { id: 'ask-test-actor' });
    console.log('✅ Actor spawned for ask test');

    console.log('🟡 CRITICAL POINT: About to call actor.ask - THIS WILL LIKELY HANG...');
    console.log('🟡 Actor reference:', typeof actor, 'ask method:', typeof actor.ask);
    const response = await actor.ask({
      type: 'PING',
      payload: null,
      timestamp: Date.now(),
      version: '1.0.0',
    });
    console.log('✅ Ask pattern completed, response:', response);

    expect(response).toBe('pong');
  });
});
