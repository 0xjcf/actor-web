import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActorRef } from '../actor-ref.js';
import type { ActorMessage } from '../actor-system.js';

const TEST_OPERATION_DEADLINE_MS = 1_000;

/**
 * Keep the deadlock guard well above normal local/CI scheduling jitter and
 * release its timer as soon as the operation settles.
 */
async function settleBeforeDeadline(operation: Promise<void>): Promise<'completed' | 'timed-out'> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timed-out'>((resolve) => {
    timeoutHandle = setTimeout(() => resolve('timed-out'), TEST_OPERATION_DEADLINE_MS);
  });

  try {
    return await Promise.race([operation.then(() => 'completed' as const), deadline]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('reentrant test delivery', () => {
  it('completes when actor A awaits a dependency send to actor B with fallback storage', async () => {
    if (typeof process.getBuiltinModule === 'function') {
      vi.spyOn(process, 'getBuiltinModule').mockReturnValue(undefined);
    }
    vi.resetModules();

    const [{ ActorSystemImpl }, { defineBehavior }] = await Promise.all([
      import('../actor-system-impl.js'),
      import('../unified-actor-builder.js'),
    ]);
    const system = new ActorSystemImpl({ nodeAddress: 'test-node' });
    system.enableTestMode();
    await system.start();

    try {
      let receiverHandled = false;
      let senderCompleted = false;
      const receiver = await system.spawn(
        defineBehavior<ActorMessage>()
          .onMessage(({ message }) => {
            if (message.type === 'PING') {
              receiverHandled = true;
            }
          })
          .build(),
        { id: 'receiver' }
      );
      const receiverSlot: { ref: ActorRef | null } = { ref: receiver };
      const sender = await system.spawn(
        defineBehavior<ActorMessage>()
          .onMessage(async ({ message, dependencies }) => {
            if (message.type !== 'START') {
              return;
            }

            if (!receiverSlot.ref) {
              throw new Error('Receiver ref was not initialized.');
            }

            await dependencies.send(receiverSlot.ref, { type: 'PING' });
            senderCompleted = true;
          })
          .build(),
        { id: 'sender' }
      );

      const result = await settleBeforeDeadline(sender.send({ type: 'START' }));

      expect(result).toBe('completed');
      expect(receiverHandled).toBe(true);
      expect(senderCompleted).toBe(true);
    } finally {
      system.disableTestMode();
      const stopResult = await settleBeforeDeadline(system.stop());
      expect(stopResult).toBe('completed');
    }
  });
});
