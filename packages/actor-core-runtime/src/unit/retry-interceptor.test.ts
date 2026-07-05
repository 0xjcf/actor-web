import { describe, expect, it, vi } from 'vitest';
import type { ActorRef } from '../actor-ref.js';
import type { ActorMessage, ActorSystem } from '../actor-system.js';
import { RetryInterceptor } from '../interceptors/retry-interceptor.js';
import { createMessageContext } from '../messaging/interceptors.js';
import { Address } from '../utils/factories.js';

describe('RetryInterceptor', () => {
  async function expectRetryDeliveryFailureToOpenCircuit(
    lookup: ActorSystem['lookup']
  ): Promise<void> {
    const onCircuitOpen = vi.fn();
    const retry = new RetryInterceptor({
      circuitThreshold: 1,
      initialDelay: 0,
      maxRetries: 3,
      onCircuitOpen,
    });
    const message: ActorMessage = { type: 'RETRY_ME' };
    const actor = Address.from({ id: 'retry-target' });

    retry.setActorSystem({ lookup } as unknown as ActorSystem);

    try {
      await retry.onError({
        error: new Error('network timeout'),
        message,
        actor,
        context: createMessageContext(),
      });

      await vi.waitFor(() => expect(onCircuitOpen).toHaveBeenCalledTimes(1), {
        timeout: 250,
      });
      expect(retry.getCircuitState()).toMatchObject({
        failures: 1,
        state: 'OPEN',
      });
    } finally {
      retry.destroy();
    }
  }

  it('records failure when retry lookup rejects asynchronously', async () => {
    await expectRetryDeliveryFailureToOpenCircuit(
      vi.fn(async () => {
        throw new Error('lookup failed');
      }) as ActorSystem['lookup']
    );
  });

  it('records failure when retry send rejects asynchronously', async () => {
    const target = {
      send: vi.fn(async () => {
        throw new Error('send failed');
      }),
    } as unknown as ActorRef;

    await expectRetryDeliveryFailureToOpenCircuit(
      vi.fn(async () => target) as ActorSystem['lookup']
    );
  });

  it('records failure when retry lookup returns no actor', async () => {
    await expectRetryDeliveryFailureToOpenCircuit(
      vi.fn(async () => undefined) as ActorSystem['lookup']
    );
  });
});
