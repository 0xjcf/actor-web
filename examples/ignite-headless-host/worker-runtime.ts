/// <reference lib="webworker" />

import {
  createMessagePortTransport,
  type MessagePortTransport,
  type StartedActorWebNode,
  startActorWebNode,
} from '@actor-core/runtime/browser';
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

  async bind(source: string, port: MessagePort): Promise<void> {
    this.transport?.destroy();
    this.transport = createMessagePortTransport({
      nodeAddress: serviceWorkerNode,
      peerAddress: source,
      port,
    });

    if (!this.runtimeNode) {
      this.runtimeNode = await startActorWebNode(logistics, {
        node: 'serviceWorker',
        transport: this.transport,
      });
    }

    port.postMessage({
      __actorWebServiceWorkerTransport: true,
      kind: 'bind-ack',
      source: serviceWorkerNode,
    } satisfies ServiceWorkerTransportEnvelope);
  }

  async shutdown(): Promise<void> {
    await this.runtimeNode?.stop();
    this.runtimeNode = null;

    this.transport?.destroy();
    this.transport = null;
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
