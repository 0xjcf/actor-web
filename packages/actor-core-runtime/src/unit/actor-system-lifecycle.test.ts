import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ActorSystemConfig, createActorSystem } from '../actor-system-impl.js';

describe('ActorSystem lifecycle', () => {
  let system: ReturnType<typeof createActorSystem>;

  beforeEach(async () => {
    const config: ActorSystemConfig = {
      nodeAddress: 'lifecycle-test-node',
      shutdownTimeout: 5_000,
    };

    system = createActorSystem(config);
    system.enableTestMode();
    await system.start();
  });

  afterEach(async () => {
    if (system.isRunning()) {
      await system.stop();
    }
  });

  it('stops dead-letter cleanup when the system stops', async () => {
    const deadLetterQueue = (
      system as unknown as {
        deadLetterQueue: { stop: () => void };
      }
    ).deadLetterQueue;
    const stopSpy = vi.spyOn(deadLetterQueue, 'stop');

    await system.stop();

    expect(stopSpy).toHaveBeenCalledTimes(1);
  });
});
