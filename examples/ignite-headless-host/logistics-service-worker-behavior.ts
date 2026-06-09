import { defineBehavior } from '@actor-web/runtime/browser';
import {
  createInitialServiceWorkerProofContext,
  type ServiceWorkerProofCommand,
  type ServiceWorkerProofEvent,
} from './logistics-contract';

export function createServiceWorkerProofBehavior() {
  return defineBehavior<ServiceWorkerProofCommand, ServiceWorkerProofEvent>()
    .withContext(createInitialServiceWorkerProofContext())
    .onMessage(({ context, message }) => {
      if (message.type !== 'PING_SERVICE_WORKER') {
        return;
      }

      const pingCount = context.pingCount + 1;
      return {
        context: {
          status: 'connected' as const,
          pingCount,
          lastPingAt: message.sentAt ?? Date.now(),
        },
        reply: { ok: true, pingCount },
        emit: [{ type: 'SERVICE_WORKER_PONG', pingCount }],
      };
    })
    .build();
}
