/**
 * Timer Actor Validation Test
 * Verifies the timer actor implementation works correctly
 */

import { describe, expect, it } from 'vitest';
import { ActorSystemImpl } from '../actor-system-impl.js';
import type { CancelScheduledMessage, ScheduleMessage } from '../actors/timer-actor.js';
import { defineActor } from '../unified-actor-builder.js';
import { withTimerTesting } from './timer-test-utils.js';

describe.skip('Timer Actor Implementation', () => {
  it('should schedule and deliver messages after time advancement', async () => {
    const system = new ActorSystemImpl({
      nodeAddress: 'test-node',
    });
    await system.start();
    const testSystem = await withTimerTesting(system);

    const messages: string[] = [];

    const testActor = defineActor()
      .withContext({ messages })
      .onMessage(({ message }) => {
        messages.push(message.type);
        return { context: { messages } };
      })
      .build();

    const actor = await system.spawn(testActor, { id: 'test-actor' });

    // Schedule messages at different times
    const timer = testSystem.getTimerActor();
    await timer.schedule(actor, { type: 'MSG_100' }, 100);
    await timer.schedule(actor, { type: 'MSG_50' }, 50);
    await timer.schedule(actor, { type: 'MSG_200' }, 200);

    // Flush to ensure timer actor processes the schedule messages
    await system.flush();

    // Messages should not be delivered yet
    expect(messages).toEqual([]);

    // Advance time by 50ms - should deliver MSG_50
    await testSystem.advanceTime(50);
    // Messages after 50ms advance
    expect(messages).toEqual(['MSG_50']);

    // Advance time by another 50ms - should deliver MSG_100
    await testSystem.advanceTime(50);
    expect(messages).toEqual(['MSG_50', 'MSG_100']);

    // Advance time by 100ms - should deliver MSG_200
    await testSystem.advanceTime(100);
    expect(messages).toEqual(['MSG_50', 'MSG_100', 'MSG_200']);

    await system.stop();
  });

  it('should handle flushWithTime to process all scheduled messages', async () => {
    const system = new ActorSystemImpl({
      nodeAddress: 'test-node',
    });
    await system.start();
    const testSystem = await withTimerTesting(system);

    const messages: string[] = [];

    const testActor = defineActor()
      .withContext({ messages: [] as string[] })
      .onMessage(({ message }) => {
        messages.push(message.type);
        return { context: { messages: [...messages] } };
      })
      .build();

    const actor = await system.spawn(testActor, { id: 'test-actor' });
    const timer = testSystem.getTimerActor();

    // Schedule messages at various times
    await timer.schedule(actor, { type: 'MSG_10' }, 10);
    await timer.schedule(actor, { type: 'MSG_25' }, 25);
    await timer.schedule(actor, { type: 'MSG_15' }, 15);
    await timer.schedule(actor, { type: 'MSG_30' }, 30);

    // Flush all scheduled messages
    await testSystem.flushWithTime();

    // All messages should be delivered in time order
    expect(messages).toEqual(['MSG_10', 'MSG_15', 'MSG_25', 'MSG_30']);

    await system.stop();
  });

  it('should support message cancellation', async () => {
    const system = new ActorSystemImpl({
      nodeAddress: 'test-node',
    });
    await system.start();
    const testSystem = await withTimerTesting(system);

    const messages: string[] = [];

    const testActor = defineActor()
      .onMessage(({ message }) => {
        messages.push(message.type);
        return {};
      })
      .build();

    const actor = await system.spawn(testActor, { id: 'test-actor' });

    // Schedule messages with IDs
    const timerActor = testSystem.getTimerActor();

    // Use the send method directly - TimerActorRef now properly extends ActorPID
    const scheduleMsg1: ScheduleMessage = {
      type: 'SCHEDULE',
      targetActor: actor,
      message: { type: 'MSG_1' },
      delay: 100,
      id: 'msg-1',
    };
    await timerActor.send(scheduleMsg1);

    const scheduleMsg2: ScheduleMessage = {
      type: 'SCHEDULE',
      targetActor: actor,
      message: { type: 'MSG_2' },
      delay: 100,
      id: 'msg-2',
    };
    await timerActor.send(scheduleMsg2);

    // Cancel one message
    const cancelMsg: CancelScheduledMessage = {
      type: 'CANCEL_SCHEDULED',
      id: 'msg-1',
    };
    await timerActor.send(cancelMsg);

    // Advance time
    await testSystem.advanceTime(150);

    // Only MSG_2 should be delivered
    expect(messages).toEqual(['MSG_2']);

    await system.stop();
  });

  it('should properly iterate through scheduled messages Map', async () => {
    const system = new ActorSystemImpl({
      nodeAddress: 'test-node',
    });
    await system.start();
    const testSystem = await withTimerTesting(system);

    const testActor = defineActor()
      .onMessage(() => {
        return {};
      })
      .build();

    const actor = await system.spawn(testActor, { id: 'test-actor' });
    const timer = testSystem.getTimerActor();

    // Schedule multiple messages
    await timer.schedule(actor, { type: 'MSG_1' }, 50);
    await timer.schedule(actor, { type: 'MSG_2' }, 100);
    await timer.schedule(actor, { type: 'MSG_3' }, 150);

    // Get scheduled messages info
    const scheduled = await timer.getScheduled();
    expect(scheduled.count).toBe(3);
    expect(scheduled.scheduled).toHaveLength(3);

    // Advance time to deliver some messages
    await testSystem.advanceTime(100);

    // Check remaining scheduled messages
    const remaining = await timer.getScheduled();
    expect(remaining.count).toBe(1);
    expect(remaining.scheduled[0].timeUntilDelivery).toBe(50);

    await system.stop();
  });
});
