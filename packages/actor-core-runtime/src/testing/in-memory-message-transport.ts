/**
 * @module actor-core/runtime/testing/in-memory-message-transport
 * @description In-memory transport network for multi-node runtime prove-out and tests.
 */

import type { ActorMessage, MessageTransport } from '../actor-system.js';

export interface InMemoryTransportFrame {
  source: string;
  destination: string;
  message: ActorMessage;
}

export interface InMemoryMessageTransportNetwork {
  createTransport(nodeAddress: string): MessageTransport;
  dropNextMessage(predicate: (frame: InMemoryTransportFrame) => boolean): void;
}

class InMemoryMessageTransport implements MessageTransport {
  private readonly listeners = new Set<
    (event: { source: string; message: ActorMessage }) => void
  >();
  private readonly connections = new Set<string>();

  constructor(
    readonly nodeAddress: string,
    private readonly network: InMemoryMessageTransportNetworkImpl
  ) {}

  async send(destination: string, message: ActorMessage): Promise<void> {
    if (!this.connections.has(destination)) {
      throw new Error(`Transport ${this.nodeAddress} is not connected to ${destination}`);
    }

    await this.network.dispatch({
      source: this.nodeAddress,
      destination,
      message,
    });
  }

  subscribe(listener: (event: { source: string; message: ActorMessage }) => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async connect(address: string): Promise<void> {
    await this.network.connect(this.nodeAddress, address);
  }

  async disconnect(address: string): Promise<void> {
    await this.network.disconnect(this.nodeAddress, address);
  }

  getConnectedNodes(): string[] {
    return Array.from(this.connections);
  }

  isConnected(address: string): boolean {
    return this.connections.has(address);
  }

  setConnected(address: string, connected: boolean): void {
    if (connected) {
      this.connections.add(address);
      return;
    }

    this.connections.delete(address);
  }

  deliver(event: { source: string; message: ActorMessage }): void {
    for (const listener of Array.from(this.listeners)) {
      listener(event);
    }
  }
}

class InMemoryMessageTransportNetworkImpl implements InMemoryMessageTransportNetwork {
  private readonly transports = new Map<string, InMemoryMessageTransport>();
  private readonly dropPredicates: Array<(frame: InMemoryTransportFrame) => boolean> = [];

  createTransport(nodeAddress: string): MessageTransport {
    if (this.transports.has(nodeAddress)) {
      throw new Error(`Transport already exists for node ${nodeAddress}`);
    }

    const transport = new InMemoryMessageTransport(nodeAddress, this);
    this.transports.set(nodeAddress, transport);
    return transport;
  }

  dropNextMessage(predicate: (frame: InMemoryTransportFrame) => boolean): void {
    this.dropPredicates.push(predicate);
  }

  async connect(source: string, destination: string): Promise<void> {
    const sourceTransport = this.getTransport(source);
    const destinationTransport = this.getTransport(destination);

    if (sourceTransport.isConnected(destination) && destinationTransport.isConnected(source)) {
      return;
    }

    sourceTransport.setConnected(destination, true);
    destinationTransport.setConnected(source, true);

    sourceTransport.deliver({
      source: destination,
      message: {
        type: '__runtime.transport.connected',
        nodeAddress: destination,
        _timestamp: Date.now(),
        _version: '1.0.0',
      } as ActorMessage<{ type: '__runtime.transport.connected'; nodeAddress: string }>,
    });
    destinationTransport.deliver({
      source,
      message: {
        type: '__runtime.transport.connected',
        nodeAddress: source,
        _timestamp: Date.now(),
        _version: '1.0.0',
      } as ActorMessage<{ type: '__runtime.transport.connected'; nodeAddress: string }>,
    });
  }

  async disconnect(source: string, destination: string): Promise<void> {
    const sourceTransport = this.getTransport(source);
    const destinationTransport = this.getTransport(destination);

    if (!sourceTransport.isConnected(destination) && !destinationTransport.isConnected(source)) {
      return;
    }

    sourceTransport.setConnected(destination, false);
    destinationTransport.setConnected(source, false);

    sourceTransport.deliver({
      source: destination,
      message: {
        type: '__runtime.transport.disconnected',
        nodeAddress: destination,
        _timestamp: Date.now(),
        _version: '1.0.0',
      } as ActorMessage<{ type: '__runtime.transport.disconnected'; nodeAddress: string }>,
    });
    destinationTransport.deliver({
      source,
      message: {
        type: '__runtime.transport.disconnected',
        nodeAddress: source,
        _timestamp: Date.now(),
        _version: '1.0.0',
      } as ActorMessage<{ type: '__runtime.transport.disconnected'; nodeAddress: string }>,
    });
  }

  async dispatch(frame: InMemoryTransportFrame): Promise<void> {
    const dropIndex = this.dropPredicates.findIndex((predicate) => predicate(frame));
    if (dropIndex >= 0) {
      this.dropPredicates.splice(dropIndex, 1);
      return;
    }

    const destinationTransport = this.getTransport(frame.destination);
    destinationTransport.deliver({
      source: frame.source,
      message: frame.message,
    });
  }

  private getTransport(nodeAddress: string): InMemoryMessageTransport {
    const transport = this.transports.get(nodeAddress);
    if (!transport) {
      throw new Error(`Unknown transport node: ${nodeAddress}`);
    }

    return transport;
  }
}

export function createInMemoryMessageTransportNetwork(): InMemoryMessageTransportNetwork {
  return new InMemoryMessageTransportNetworkImpl();
}
