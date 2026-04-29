/// <reference types="vite/client" />

import { createMessagePortTransport, type MessagePortTransport } from '@actor-core/runtime/browser';
import { logistics } from './logistics-topology';
import {
  isServiceWorkerTransportEnvelope,
  type ServiceWorkerTransportEnvelope,
} from './service-worker-transport-protocol';

export interface BrowserServiceWorkerTransport extends MessagePortTransport {
  ready(): Promise<void>;
  destroy(): void;
}

function runtimeSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    (window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1')
  );
}

async function waitForActiveWorker(
  registration: ServiceWorkerRegistration
): Promise<ServiceWorker> {
  if (registration.active) {
    return registration.active;
  }

  const candidate = registration.installing ?? registration.waiting;
  if (!candidate) {
    throw new Error('Service worker registration has no active worker');
  }

  await new Promise<void>((resolve, reject) => {
    const handleStateChange = (): void => {
      if (candidate.state === 'activated') {
        candidate.removeEventListener('statechange', handleStateChange);
        resolve();
      } else if (candidate.state === 'redundant') {
        candidate.removeEventListener('statechange', handleStateChange);
        reject(new Error('Service worker became redundant before activation'));
      }
    };

    candidate.addEventListener('statechange', handleStateChange);
    handleStateChange();
  });

  if (!registration.active) {
    throw new Error('Service worker did not activate');
  }

  return registration.active;
}

export function serviceWorkerRuntimeAvailable(): boolean {
  return runtimeSupported();
}

class ServiceWorkerPageTransport implements BrowserServiceWorkerTransport {
  private readonly workerUrl: URL;
  private transport: MessagePortTransport | null = null;
  private registration: ServiceWorkerRegistration | null = null;
  private readyPromise: Promise<void> | null = null;
  private destroyed = false;

  constructor(
    private readonly nodeAddress: string,
    private readonly peerAddress: string,
    workerUrl: URL
  ) {
    this.workerUrl = workerUrl;
  }

  async ready(): Promise<void> {
    if (this.readyPromise) {
      return this.readyPromise;
    }

    if (!runtimeSupported()) {
      throw new Error('Service workers are not available in this environment');
    }

    this.readyPromise = this.bindServiceWorker();

    return this.readyPromise;
  }

  async send(destination: string, message: Parameters<MessagePortTransport['send']>[1]) {
    await this.ready();
    await this.requireTransport().send(destination, message);
  }

  subscribe(listener: Parameters<MessagePortTransport['subscribe']>[0]): () => void {
    return this.requireTransport().subscribe(listener);
  }

  async connect(address: string = this.peerAddress): Promise<void> {
    await this.ready();
    await this.requireTransport().connect(address);
  }

  async disconnect(address: string = this.peerAddress): Promise<void> {
    await this.ready();
    await this.requireTransport().disconnect(address);
  }

  getConnectedNodes(): string[] {
    return this.transport?.getConnectedNodes() ?? [];
  }

  isConnected(address: string): boolean {
    return this.transport?.isConnected(address) ?? false;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    if (this.registration?.active) {
      this.registration.active.postMessage({
        __actorWebServiceWorkerTransport: true,
        kind: 'shutdown',
        source: this.nodeAddress,
      } satisfies ServiceWorkerTransportEnvelope);
    }

    this.transport?.destroy();
    this.transport = null;
  }

  private async bindServiceWorker(): Promise<void> {
    this.registration = await navigator.serviceWorker.register(this.workerUrl, {
      type: 'module',
      scope: './',
    });

    const activeWorker = await waitForActiveWorker(this.registration);
    const channel = new MessageChannel();
    this.transport = createMessagePortTransport({
      nodeAddress: this.nodeAddress,
      peerAddress: this.peerAddress,
      port: channel.port1,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        channel.port1.removeEventListener('message', handleBindAck);
        reject(new Error('Timed out waiting for service worker runtime binding'));
      }, 5000);

      const handleBindAck = (event: MessageEvent<unknown>): void => {
        if (!isServiceWorkerTransportEnvelope(event.data) || event.data.kind !== 'bind-ack') {
          return;
        }

        window.clearTimeout(timeout);
        channel.port1.removeEventListener('message', handleBindAck);
        resolve();
      };

      channel.port1.addEventListener('message', handleBindAck);
      activeWorker.postMessage(
        {
          __actorWebServiceWorkerTransport: true,
          kind: 'bind',
          source: this.nodeAddress,
        } satisfies ServiceWorkerTransportEnvelope,
        [channel.port2]
      );
    });
  }

  private requireTransport(): MessagePortTransport {
    if (!this.transport) {
      throw new Error('Service worker runtime transport has not been initialized');
    }

    return this.transport;
  }
}

export function createBrowserServiceWorkerTransport(): BrowserServiceWorkerTransport {
  const workerUrl = new URL(
    import.meta.env.DEV ? './ignite-headless-host.sw.ts' : './ignite-headless-host.sw.js',
    window.location.href
  );

  return new ServiceWorkerPageTransport(
    logistics.nodes.browser.address,
    logistics.nodes.serviceWorker.address,
    workerUrl
  );
}

export function serviceWorkerRemoteNode(): string {
  return logistics.nodes.serviceWorker.address;
}
