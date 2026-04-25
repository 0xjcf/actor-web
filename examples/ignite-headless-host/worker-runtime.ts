/// <reference lib="webworker" />

import type { ActorMessage, MessageTransport } from '@actor-core/runtime/browser';
import { createActorSystem } from '@actor-core/runtime/browser';
import { REMOTE_ACTOR_ID, REMOTE_NODE } from './logistics-contract';
import { createShipmentBehavior } from './logistics-shipment-behavior';
import {
  isServiceWorkerTransportEnvelope,
  type ServiceWorkerTransportEnvelope,
} from './service-worker-transport-protocol';

declare const self: ServiceWorkerGlobalScope;

class ServiceWorkerPortTransport implements MessageTransport {
  private readonly listeners = new Set<
    (event: { source: string; message: ActorMessage }) => void
  >();
  private readonly connections = new Set<string>();
  private port: MessagePort | null = null;

  constructor(private readonly nodeAddress: string) {}

  bind(port: MessagePort): void {
    this.port?.close();
    this.connections.clear();
    this.port = port;
    this.port.onmessage = (event: MessageEvent<unknown>) => {
      this.handleEnvelope(event.data);
    };
    this.port.start();
  }

  async send(destination: string, message: ActorMessage): Promise<void> {
    if (!this.port || !this.connections.has(destination)) {
      throw new Error(
        `Service worker transport ${this.nodeAddress} is not connected to ${destination}`
      );
    }

    this.port.postMessage({
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
    if (!this.port || this.connections.has(address)) {
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
    this.port.postMessage({
      __actorWebServiceWorkerTransport: true,
      kind: 'connect',
      source: this.nodeAddress,
      destination: address,
    } satisfies ServiceWorkerTransportEnvelope);
  }

  async disconnect(address: string): Promise<void> {
    if (!this.port || !this.connections.has(address)) {
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
    this.port.postMessage({
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

  destroy(): void {
    this.connections.clear();
    this.port?.close();
    this.port = null;
  }

  private handleEnvelope(data: unknown): void {
    if (!isServiceWorkerTransportEnvelope(data)) {
      return;
    }

    switch (data.kind) {
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
      case 'bind-ack':
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

class LogisticsServiceWorkerRuntime {
  private readonly transport = new ServiceWorkerPortTransport(REMOTE_NODE);
  private readonly system = createActorSystem({
    nodeAddress: REMOTE_NODE,
    transport: this.transport,
  });
  private started = false;

  async bind(port: MessagePort): Promise<void> {
    this.transport.bind(port);

    if (!this.started) {
      this.started = true;
      await this.system.start();
      await this.system.spawn(createShipmentBehavior(), {
        id: REMOTE_ACTOR_ID,
      });
    }

    port.postMessage({
      __actorWebServiceWorkerTransport: true,
      kind: 'bind-ack',
      source: REMOTE_NODE,
    } satisfies ServiceWorkerTransportEnvelope);
  }

  async shutdown(): Promise<void> {
    if (this.started) {
      await this.system.stop();
      this.started = false;
    }

    this.transport.destroy();
  }
}

export function startLogisticsServiceWorkerRuntime(): void {
  const runtime = new LogisticsServiceWorkerRuntime();

  self.addEventListener('message', (event: ExtendableMessageEvent) => {
    if (!isServiceWorkerTransportEnvelope(event.data)) {
      return;
    }

    if (event.data.kind === 'bind') {
      const port = event.ports[0];
      if (!port) {
        return;
      }

      event.waitUntil(runtime.bind(port));
      return;
    }

    if (event.data.kind === 'shutdown') {
      event.waitUntil(runtime.shutdown());
    }
  });
}

export const startCheckoutServiceWorkerRuntime = startLogisticsServiceWorkerRuntime;
