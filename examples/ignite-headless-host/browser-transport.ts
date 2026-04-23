/// <reference types="vite/client" />

import type { ActorMessage, MessageTransport } from '@actor-core/runtime/browser';
import { LOCAL_NODE, REMOTE_NODE } from './checkout-contract';
import {
  isServiceWorkerTransportEnvelope,
  type ServiceWorkerTransportEnvelope,
} from './service-worker-transport-protocol';

export interface BrowserServiceWorkerTransport extends MessageTransport {
  ready(): Promise<void>;
  destroy(): Promise<void>;
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
  private readonly listeners = new Set<
    (event: { source: string; message: ActorMessage }) => void
  >();
  private readonly connections = new Set<string>();
  private readonly workerUrl: URL;
  private port: MessagePort | null = null;
  private registration: ServiceWorkerRegistration | null = null;
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: unknown) => void) | null = null;
  private destroyed = false;

  constructor(
    private readonly nodeAddress: string,
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

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    try {
      this.registration = await navigator.serviceWorker.register(this.workerUrl, {
        type: 'module',
        scope: './',
      });
      const activeWorker = await waitForActiveWorker(this.registration);
      const channel = new MessageChannel();
      this.port = channel.port1;
      this.port.onmessage = (event: MessageEvent<unknown>) => {
        this.handleEnvelope(event.data);
      };
      this.port.start();

      activeWorker.postMessage(
        {
          __actorWebServiceWorkerTransport: true,
          kind: 'bind',
          source: this.nodeAddress,
        },
        [channel.port2]
      );
    } catch (error) {
      this.rejectReady?.(error);
      throw error;
    }

    return this.readyPromise;
  }

  async send(destination: string, message: ActorMessage): Promise<void> {
    await this.ready();
    if (!this.connections.has(destination)) {
      throw new Error(`Transport ${this.nodeAddress} is not connected to ${destination}`);
    }

    this.port?.postMessage({
      __actorWebServiceWorkerTransport: true,
      kind: 'frame',
      source: this.nodeAddress,
      destination,
      message,
    } satisfies ServiceWorkerTransportEnvelope);
  }

  subscribe(listener: (event: { source: string; message: ActorMessage }) => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async connect(address: string): Promise<void> {
    await this.ready();

    if (this.connections.has(address)) {
      return;
    }

    this.connections.add(address);
    this.deliver({
      source: address,
      message: {
        type: '__runtime.transport.connected',
        nodeAddress: address,
        _timestamp: Date.now(),
        _version: '1.0.0',
      } as ActorMessage<{ type: '__runtime.transport.connected'; nodeAddress: string }>,
    });

    this.port?.postMessage({
      __actorWebServiceWorkerTransport: true,
      kind: 'connect',
      source: this.nodeAddress,
      destination: address,
    } satisfies ServiceWorkerTransportEnvelope);
  }

  async disconnect(address: string): Promise<void> {
    await this.ready();

    if (!this.connections.has(address)) {
      return;
    }

    this.connections.delete(address);
    this.deliver({
      source: address,
      message: {
        type: '__runtime.transport.disconnected',
        nodeAddress: address,
        _timestamp: Date.now(),
        _version: '1.0.0',
      } as ActorMessage<{ type: '__runtime.transport.disconnected'; nodeAddress: string }>,
    });

    this.port?.postMessage({
      __actorWebServiceWorkerTransport: true,
      kind: 'disconnect',
      source: this.nodeAddress,
      destination: address,
    } satisfies ServiceWorkerTransportEnvelope);
  }

  getConnectedNodes(): string[] {
    return Array.from(this.connections);
  }

  isConnected(address: string): boolean {
    return this.connections.has(address);
  }

  async destroy(): Promise<void> {
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

    this.port?.close();
    this.port = null;
    this.connections.clear();
  }

  private handleEnvelope(data: unknown): void {
    if (!isServiceWorkerTransportEnvelope(data)) {
      return;
    }

    switch (data.kind) {
      case 'bind-ack':
        this.resolveReady?.();
        this.resolveReady = null;
        this.rejectReady = null;
        return;
      case 'connect':
        this.connections.add(data.source);
        this.deliver({
          source: data.source,
          message: {
            type: '__runtime.transport.connected',
            nodeAddress: data.source,
            _timestamp: Date.now(),
            _version: '1.0.0',
          } as ActorMessage<{ type: '__runtime.transport.connected'; nodeAddress: string }>,
        });
        return;
      case 'disconnect':
        this.connections.delete(data.source);
        this.deliver({
          source: data.source,
          message: {
            type: '__runtime.transport.disconnected',
            nodeAddress: data.source,
            _timestamp: Date.now(),
            _version: '1.0.0',
          } as ActorMessage<{ type: '__runtime.transport.disconnected'; nodeAddress: string }>,
        });
        return;
      case 'frame':
        this.deliver({
          source: data.source,
          message: data.message,
        });
        return;
      case 'bind':
      case 'shutdown':
        return;
    }
  }

  private deliver(event: { source: string; message: ActorMessage }): void {
    for (const listener of Array.from(this.listeners)) {
      listener(event);
    }
  }
}

export function createBrowserServiceWorkerTransport(): BrowserServiceWorkerTransport {
  const workerUrl = new URL(
    import.meta.env.DEV ? './ignite-headless-host.sw.ts' : './ignite-headless-host.sw.js',
    window.location.href
  );

  return new ServiceWorkerPageTransport(LOCAL_NODE, workerUrl);
}

export function serviceWorkerRemoteNode(): string {
  return REMOTE_NODE;
}
