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
  it.each([false, true])(
    'restores the parent context after a dependency ask (test mode: %s)',
    async (testMode) => {
      if (typeof process.getBuiltinModule === 'function') {
        vi.spyOn(process, 'getBuiltinModule').mockReturnValue(undefined);
      }
      vi.resetModules();
      const [{ ActorSystemImpl }, { defineBehavior }, contexts] = await Promise.all([
        import('../actor-system-impl.js'),
        import('../unified-actor-builder.js'),
        import('../actor-context-manager.js'),
      ]);
      expect(contexts.supportsOverlappingTopLevelAsyncRuns()).toBe(false);
      const system = new ActorSystemImpl({ nodeAddress: 'test-node' });
      if (testMode) system.enableTestMode();
      await system.start();
      try {
        const child = await system.spawn(
          defineBehavior<ActorMessage>().onMessage(async () => {
            await Promise.resolve();
            return { reply: { actor: contexts.getCurrentActorId() } };
          }),
          { id: 'child' }
        );
        const parent = await system.spawn(
          defineBehavior<ActorMessage>().onMessage(async ({ dependencies }) => {
            const before = contexts.getCurrentContext();
            await Promise.resolve();
            const reply = await dependencies.ask<{ actor: string }>(
              testMode ? child.address : child,
              { type: 'READ' },
              TEST_OPERATION_DEADLINE_MS
            );
            return {
              reply: {
                child: reply.actor,
                parent: contexts.getCurrentActorId(),
                restored: contexts.getCurrentContext() === before,
              },
            };
          }),
          { id: 'parent' }
        );
        await expect(parent.ask({ type: 'START' })).resolves.toEqual({
          child: child.address,
          parent: parent.address,
          restored: true,
        });
      } finally {
        system.disableTestMode();
        await system.stop();
      }
    }
  );

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
