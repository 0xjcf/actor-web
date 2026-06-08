/// <reference types="vite/client" />

import { createActorWebClient } from '@actor-web/runtime/browser';
import {
  createBrowserServiceWorkerTransport,
  serviceWorkerRemoteNode,
  serviceWorkerRuntimeAvailable,
} from './browser-transport';
import { logistics } from './logistics-topology';

function requiredGatewayUrl(): string {
  const configuredUrl = import.meta.env.VITE_ACTOR_WEB_GATEWAY_URL;
  const gatewayUrl =
    typeof configuredUrl === 'string' && configuredUrl.trim().length > 0
      ? configuredUrl
      : undefined;
  if (!gatewayUrl) {
    throw new Error('VITE_ACTOR_WEB_GATEWAY_URL is required for the logistics browser client.');
  }

  return gatewayUrl;
}

const gateway = { url: requiredGatewayUrl() };

export const logisticsClient = createActorWebClient(logistics, {
  gateway,
  clientVersion: 'ignite-headless-host',
});

function startConfiguredLogisticsWorkerRuntime(): { destroy(): Promise<void> } {
  const configuredUrl = import.meta.env.VITE_ACTOR_WEB_TRANSPORT_URL;
  const transportUrl =
    typeof configuredUrl === 'string' && configuredUrl.trim().length > 0
      ? configuredUrl
      : undefined;
  if (!transportUrl || typeof Worker === 'undefined') {
    return {
      async destroy(): Promise<void> {},
    };
  }

  const worker = new Worker(new URL('./worker-websocket-runtime.ts', import.meta.url), {
    type: 'module',
  });
  worker.postMessage({ type: 'start', transportUrl });

  return {
    async destroy(): Promise<void> {
      worker.postMessage({ type: 'stop' });
      worker.terminate();
    },
  };
}

export const logisticsWorkerRuntime = startConfiguredLogisticsWorkerRuntime();

function startServiceWorkerRuntimeProof(): { destroy(): Promise<void> } {
  if (!serviceWorkerRuntimeAvailable()) {
    return {
      async destroy(): Promise<void> {},
    };
  }

  const transport = createBrowserServiceWorkerTransport();
  const ready = transport
    .ready()
    .then(() => transport.connect(serviceWorkerRemoteNode()))
    .catch((error: unknown) => {
      console.warn('Actor-Web service worker topology proof unavailable.', error);
    });

  return {
    async destroy(): Promise<void> {
      await ready.catch(() => undefined);
      await transport.destroy();
    },
  };
}

export const logisticsServiceWorkerRuntime = startServiceWorkerRuntimeProof();
