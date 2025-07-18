/**
 * Example demonstrating the improved ActorBehavior typing flexibility
 * Shows both single emit and array emit functionality
 */

import { createActorSystem } from '../actor-system-impl.js';
import type { ActorBehavior, ActorMessage } from '../actor-system.js';

interface CounterContext {
  count: number;
}

interface CounterMessage {
  type: 'INCREMENT' | 'DECREMENT' | 'RESET' | 'GET_COUNT' | 'DOUBLE_INCREMENT';
  payload?: { amount?: number };
  correlationId?: string;
}

// Union type for different event types with their specific payloads
type CounterEmit =
  | { type: 'COUNTER_INCREMENTED'; payload: { value: number; previousValue: number } }
  | { type: 'COUNTER_DECREMENTED'; payload: { value: number; previousValue: number } }
  | { type: 'COUNTER_RESET'; payload: { previousValue: number } }
  | { type: 'COUNTER_ERROR'; payload: { error: string; operation: string } }
  | { type: 'RESPONSE'; payload: number; correlationId: string };
// Simple behavior demonstrating single emit with union event types
const singleEmitBehavior: ActorBehavior<CounterMessage, CounterContext, CounterEmit> = {
  context: { count: 0 },

  onMessage: async ({ message, context }) => {
    if (message.type === 'INCREMENT') {
      const newCount = context.count + 1;
      return {
        context: { count: newCount },
        emit: {
          type: 'COUNTER_INCREMENTED',
          payload: { value: newCount, previousValue: context.count },
          timestamp: Date.now(),
          version: '1.0.0',
        },
      };
    }

    if (message.type === 'GET_COUNT') {
      return {
        context,
        emit: {
          type: 'RESPONSE',
          correlationId: message.correlationId || '',
          payload: context.count,
          timestamp: Date.now(),
          version: '1.0.0',
        },
      };
    }

    return context;
  },
};

// Behavior demonstrating array emit with multiple event types
const arrayEmitBehavior: ActorBehavior<CounterMessage, CounterContext, CounterEmit> = {
  context: { count: 0 },

  onMessage: async ({ message, context }) => {
    if (message.type === 'DOUBLE_INCREMENT') {
      const newCount = context.count + 2;
      return {
        context: { count: newCount },
        emit: [
          {
            type: 'COUNTER_INCREMENTED',
            payload: { value: context.count + 1, previousValue: context.count },
            timestamp: Date.now(),
            version: '1.0.0',
          },
          {
            type: 'COUNTER_INCREMENTED',
            payload: { value: newCount, previousValue: context.count + 1 },
            timestamp: Date.now(),
            version: '1.0.0',
          },
        ],
      };
    }

    if (message.type === 'RESET') {
      return {
        context: { count: 0 },
        emit: {
          type: 'COUNTER_RESET',
          payload: { previousValue: context.count },
          timestamp: Date.now(),
          version: '1.0.0',
        },
      };
    }

    if (message.type === 'GET_COUNT') {
      return {
        context,
        emit: {
          type: 'RESPONSE',
          correlationId: message.correlationId || '',
          payload: context.count,
          timestamp: Date.now(),
          version: '1.0.0',
        },
      };
    }

    return context;
  },
};

async function demonstrateTypedActorExample() {
  console.log('=== Single and Array Emit Example ===\n');

  const system = createActorSystem({
    nodeAddress: 'example-node',
  });

  await system.start();

  try {
    // Test single emit
    console.log('Testing single emit...');
    const singleActor = await system.spawn(singleEmitBehavior, { id: 'single-counter' });

    const singleEvents: ActorMessage[] = [];
    const singleSub = singleActor.subscribe('EMIT:*').subscribe((event) => {
      if (event.type !== 'RESPONSE') {
        singleEvents.push(event);
        console.log(`Single emit: ${event.type}`, event.payload);
      }
    });

    await singleActor.send({
      type: 'INCREMENT',
    });

    const singleResult = await singleActor.ask({
      type: 'GET_COUNT',
    });

    console.log(`Single emit result: ${singleResult} (${singleEvents.length} events)\n`);

    // Test array emit
    console.log('Testing array emit...');
    const arrayActor = await system.spawn(arrayEmitBehavior, { id: 'array-counter' });

    const arrayEvents: ActorMessage[] = [];
    const arraySub = arrayActor.subscribe('EMIT:*').subscribe((event) => {
      if (event.type !== 'RESPONSE') {
        arrayEvents.push(event);
        console.log(`Array emit: ${event.type}`, event.payload);
      }
    });

    await arrayActor.send({
      type: 'DOUBLE_INCREMENT',
    });

    const arrayResult = await arrayActor.ask({
      type: 'GET_COUNT',
    });

    console.log(`Array emit result: ${arrayResult} (${arrayEvents.length} events)\n`);

    console.log('✅ Both single and array emit work without type casting!');

    singleSub.unsubscribe();
    arraySub.unsubscribe();
  } finally {
    await system.stop();
  }
}

// Run the example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateTypedActorExample().catch(console.error);
}
