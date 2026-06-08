/// <reference lib="webworker" />

import {
  createMessagePortTransport,
  type MessagePortTransport,
  type StartedActorWebNode,
  startActorWebNode,
} from '@actor-web/runtime/browser';
import { logistics } from './logistics-topology';
import {
  isServiceWorkerTransportEnvelope,
  type ServiceWorkerTransportEnvelope,
} from './service-worker-transport-protocol';

declare const self: ServiceWorkerGlobalScope;

const serviceWorkerNode = logistics.nodes.serviceWorker.address;

class LogisticsServiceWorkerRuntime {
  private transport: MessagePortTransport | null = null;
  private runtimeNode: StartedActorWebNode<typeof logistics, MessagePortTransport> | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private lifecycleGeneration = 0;

  async bind(source: string, port: MessagePort): Promise<void> {
    await this.shutdown();

    const bindGeneration = ++this.lifecycleGeneration;
    const transport = createMessagePortTransport({
      nodeAddress: serviceWorkerNode,
      peerAddress: source,
      port,
    });
    this.transport = transport;

    let startedNode: StartedActorWebNode<typeof logistics, MessagePortTransport>;
    try {
      startedNode = await startActorWebNode(logistics, {
        node: 'serviceWorker',
        transport,
      });
    } catch (error) {
      transport.destroy();
      if (this.transport === transport) {
        this.transport = null;
      }
      throw error;
    }

    if (bindGeneration !== this.lifecycleGeneration || this.transport !== transport) {
      if (this.transport === transport) {
        this.transport = null;
        transport.destroy();
      }
      await startedNode.stop();
      return;
    }

    this.runtimeNode = startedNode;
    port.postMessage({
      __actorWebServiceWorkerTransport: true,
      kind: 'bind-ack',
      source: serviceWorkerNode,
    } satisfies ServiceWorkerTransportEnvelope);
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = (async () => {
      this.lifecycleGeneration += 1;
      const currentRuntimeNode = this.runtimeNode;
      this.runtimeNode = null;
      await currentRuntimeNode?.stop();

      const currentTransport = this.transport;
      this.transport = null;
      currentTransport?.destroy();
    })();

    try {
      await this.shutdownPromise;
    } finally {
      this.shutdownPromise = null;
    }
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

      event.waitUntil(runtime.bind(event.data.source, port));
      return;
    }

    if (event.data.kind === 'shutdown') {
      event.waitUntil(runtime.shutdown());
    }
  });
}
