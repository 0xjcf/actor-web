/**
 * Simple event emission test to verify notification service
 */

import { createActorSystem } from '../actor-system-impl.js';
import type { ActorMessage } from '../actor-system.js';
import { createActor } from '../create-actor.js';
import { enableDevModeForCLI } from '../logger.js';

// Enable logging
enableDevModeForCLI();

async function testEventEmission() {
  console.log('=== Simple Event Emission Test ===\n');

  const system = createActorSystem({
    nodeAddress: 'test-node',
  });

  await system.start();

  try {
    // Create a simple actor that emits events using createActor
    const emitterActor = createActor<ActorMessage, {}, { type: string; data: string }>({
      context: {},
      onMessage: ({ message, context }) => {
        console.log(`📨 Emitter received: ${message.type}`);

        if (message.type === 'EMIT_TEST') {
          return {
            context,
            emit: [
              { type: 'TEST_EVENT_1', data: 'Hello' }, // Fixed the typo - proper type checking!
              { type: 'TEST_EVENT_2', data: 'World' },
            ],
          };
        }

        return { context };
      },
    });

    // Create a subscriber actor using createActor
    const subscriberActor = createActor({
      context: {},
      onStart: ({ context }) => {
        console.log('🔔🔔🔔 Subscriber onStart called! This should appear!');
        return { context };
      },
      onMessage: ({ message, context }) => {
        console.log(`🔔 Subscriber received: ${message.type}`);
        return { context };
      },
    });

    // Spawn actors
    const emitter = await system.spawn(emitterActor, { id: 'emitter' });
    const subscriber = await system.spawn(subscriberActor, { id: 'subscriber' });

    // Subscribe to events BEFORE triggering onStart
    console.log('\n📡 Setting up event subscription...');
    const subscription = emitter.subscribe('EMIT:*').subscribe((event) => {
      console.log(`✅ Event received: ${event.type} ->`, event.payload);
    });

    // Trigger subscriber's onStart
    console.log('\n🚀 Initializing subscriber...');
    await subscriber.send({
      type: 'INIT',
      payload: null,
    });

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Send message to emitter
    console.log('\n📤 Sending EMIT_TEST message...');
    await emitter.send({
      type: 'EMIT_TEST',
      payload: null,
    });

    // Wait for events
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Cleanup
    subscription.unsubscribe();

    console.log('\n✨ Test completed!');
  } finally {
    await system.stop();
  }
}

// Run the test
testEventEmission().catch(console.error);
