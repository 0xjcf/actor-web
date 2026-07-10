import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActorRef } from '../actor-ref.js';
import type { ActorMessage } from '../actor-system.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('reentrant test delivery', () => {
  it('completes when actor A awaits a dependency send to actor B with fallback storage', async () => {
    vi.spyOn(process, 'getBuiltinModule').mockReturnValue(undefined);
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

      const result = await Promise.race([
        sender.send({ type: 'START' }).then(() => 'delivered' as const),
        new Promise<'timed-out'>((resolve) => {
          setTimeout(() => resolve('timed-out'), 100);
        }),
      ]);

      expect(result).toBe('delivered');
      expect(receiverHandled).toBe(true);
      expect(senderCompleted).toBe(true);
    } finally {
      system.disableTestMode();
      await Promise.race([
        system.stop(),
        new Promise<void>((resolve) => {
          setTimeout(resolve, 100);
        }),
      ]);
    }
  });
});
