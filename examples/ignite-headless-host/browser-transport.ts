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

function createTransportDestroyedError(): Error {
  return new Error('Service worker runtime transport has been destroyed');
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

  return candidate;
}

export function serviceWorkerRuntimeAvailable(): boolean {
  return runtimeSupported();
}

class ServiceWorkerPageTransport implements BrowserServiceWorkerTransport {
  private readonly workerUrl: URL;
  private transport: MessagePortTransport | null = null;
  private registration: ServiceWorkerRegistration | null = null;
  private readyPromise: Promise<void> | null = null;
  private boundWorker: ServiceWorker | null = null;
  private destroyed = false;
  private pendingBindAbortController: AbortController | null = null;
  private readonly pendingSubscribers = new Map<
    Parameters<MessagePortTransport['subscribe']>[0],
    () => void
  >();

  constructor(
    private readonly nodeAddress: string,
    private readonly peerAddress: string,
    workerUrl: URL
  ) {
    this.workerUrl = workerUrl;
  }

  async ready(): Promise<void> {
    if (this.destroyed) {
      throw createTransportDestroyedError();
    }

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
    const currentTransport = this.transport;
    if (currentTransport) {
      return currentTransport.subscribe(listener);
    }

    this.pendingSubscribers.set(listener, () => {});

    return () => {
      const unsubscribe = this.pendingSubscribers.get(listener);
      this.pendingSubscribers.delete(listener);
      unsubscribe?.();
    };
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
    this.pendingBindAbortController?.abort();
    this.pendingBindAbortController = null;
    if (this.boundWorker) {
      this.boundWorker.postMessage({
        __actorWebServiceWorkerTransport: true,
        kind: 'shutdown',
        source: this.nodeAddress,
      } satisfies ServiceWorkerTransportEnvelope);
    }

    this.transport?.destroy();
    this.transport = null;
    this.boundWorker = null;
    this.pendingSubscribers.clear();
  }

  private async bindServiceWorker(): Promise<void> {
    const bindAbortController = new AbortController();
    this.pendingBindAbortController = bindAbortController;
    let pendingTransport: MessagePortTransport | null = null;
    let pendingPortToClose: MessagePort | null = null;

    try {
      this.throwIfDestroyed(bindAbortController.signal);
      this.registration = await navigator.serviceWorker.register(this.workerUrl, {
        type: 'module',
        scope: './',
      });
      this.throwIfDestroyed(bindAbortController.signal);

      const activeWorker = await waitForActiveWorker(this.registration);
      this.throwIfDestroyed(bindAbortController.signal);
      const channel = new MessageChannel();
      pendingPortToClose = channel.port2;
      const transport = createMessagePortTransport({
        nodeAddress: this.nodeAddress,
        peerAddress: this.peerAddress,
        port: channel.port1,
      });
      pendingTransport = transport;
      let bindMessagePosted = false;

      await new Promise<void>((resolve, reject) => {
        const rejectDestroyed = () => {
          cleanup();
          if (bindMessagePosted) {
            activeWorker.postMessage({
              __actorWebServiceWorkerTransport: true,
              kind: 'shutdown',
              source: this.nodeAddress,
            } satisfies ServiceWorkerTransportEnvelope);
          }
          transport.destroy();
          channel.port2.close?.();
          reject(createTransportDestroyedError());
        };

        const cleanup = () => {
          if (timeout !== null) {
            window.clearTimeout(timeout);
            timeout = null;
          }
          channel.port1.removeEventListener('message', handleBindAck);
          bindAbortController.signal.removeEventListener('abort', rejectDestroyed);
        };

        let timeout: number | null = window.setTimeout(() => {
          cleanup();
          transport.destroy();
          channel.port2.close?.();
          reject(new Error('Timed out waiting for service worker runtime binding'));
        }, 5000);

        function handleBindAck(event: MessageEvent<unknown>): void {
          if (!isServiceWorkerTransportEnvelope(event.data) || event.data.kind !== 'bind-ack') {
            return;
          }

          cleanup();
          resolve();
        }

        channel.port1.addEventListener('message', handleBindAck);
        bindAbortController.signal.addEventListener('abort', rejectDestroyed, { once: true });

        if (bindAbortController.signal.aborted) {
          rejectDestroyed();
          return;
        }

        activeWorker.postMessage(
          {
            __actorWebServiceWorkerTransport: true,
            kind: 'bind',
            source: this.nodeAddress,
          } satisfies ServiceWorkerTransportEnvelope,
          [channel.port2]
        );
        bindMessagePosted = true;
      });

      this.throwIfDestroyed(bindAbortController.signal);
      this.boundWorker = activeWorker;
      this.transport = transport;
      pendingTransport = null;
      pendingPortToClose = null;
      this.flushPendingSubscribers();
    } catch (error) {
      pendingTransport?.destroy();
      pendingPortToClose?.close?.();
      this.transport?.destroy();
      this.transport = null;
      this.boundWorker = null;
      this.pendingSubscribers.clear();
      throw error;
    } finally {
      if (this.pendingBindAbortController === bindAbortController) {
        this.pendingBindAbortController = null;
      }
    }
  }

  private flushPendingSubscribers(): void {
    const currentTransport = this.transport;
    if (!currentTransport || this.pendingSubscribers.size === 0) {
      return;
    }

    for (const [listener] of Array.from(this.pendingSubscribers.entries())) {
      const unsubscribe = currentTransport.subscribe(listener);
      this.pendingSubscribers.set(listener, unsubscribe);
    }
  }

  private requireTransport(): MessagePortTransport {
    if (!this.transport) {
      throw new Error('Service worker runtime transport has not been initialized');
    }

    return this.transport;
  }

  private throwIfDestroyed(signal?: AbortSignal): void {
    if (this.destroyed || signal?.aborted) {
      throw createTransportDestroyedError();
    }
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
