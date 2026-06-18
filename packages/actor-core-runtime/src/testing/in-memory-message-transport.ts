/**
 * @module actor-core/runtime/testing/in-memory-message-transport
 * @description In-memory transport network for multi-node runtime prove-out and tests.
 */

import type { ActorMessage, MessageTransport } from '../actor-system.js';
import {
  createRuntimeNodeIdentity,
  createRuntimeTransportFrame,
  createRuntimeTransportHandshakeAccept,
  createRuntimeTransportHandshakeHello,
  type RuntimeNodeIdentity,
  validateRuntimeTransportFrame,
  validateRuntimeTransportHandshake,
} from '../runtime-transport-contract.js';
import { safeDispatchListener } from '../transport/transport-channel.js';

export interface InMemoryTransportFrame {
  source: string;
  destination: string;
  message: ActorMessage;
}

export interface InMemoryMessageTransportNetwork {
  createTransport(nodeAddress: string, options?: InMemoryMessageTransportOptions): MessageTransport;
  dropNextMessage(predicate: (frame: InMemoryTransportFrame) => boolean): void;
}

export interface InMemoryMessageTransportOptions {
  handshake?: boolean;
  identity?: RuntimeNodeIdentity;
}

class InMemoryMessageTransport implements MessageTransport {
  private readonly listeners = new Set<
    (event: { source: string; message: ActorMessage }) => void
  >();
  private readonly connections = new Set<string>();
  private sequence = 0;

  constructor(
    readonly nodeAddress: string,
    readonly options: InMemoryMessageTransportOptions,
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
      // Route through the shared isolation helper so a throwing or
      // async-rejecting subscriber can neither escape nor starve siblings
      // (the PR#27-class fix). This transport has no telemetry sink, so
      // onError is a deliberate no-op: silent isolation is the intended
      // behavior here, and onError must never re-throw (errors-as-values).
      safeDispatchListener(listener, event, () => {});
    }
  }

  nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  usesHandshake(): boolean {
    return this.options.handshake === true;
  }

  identity(): RuntimeNodeIdentity {
    return (
      this.options.identity ??
      createRuntimeNodeIdentity({
        nodeAddress: this.nodeAddress,
        nodeId: this.nodeAddress,
        incarnation: 'in-memory',
      })
    );
  }
}

class InMemoryMessageTransportNetworkImpl implements InMemoryMessageTransportNetwork {
  private readonly transports = new Map<string, InMemoryMessageTransport>();
  private readonly dropPredicates: Array<(frame: InMemoryTransportFrame) => boolean> = [];

  createTransport(
    nodeAddress: string,
    options: InMemoryMessageTransportOptions = {}
  ): MessageTransport {
    if (this.transports.has(nodeAddress)) {
      throw new Error(`Transport already exists for node ${nodeAddress}`);
    }

    const transport = new InMemoryMessageTransport(nodeAddress, options, this);
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

    if (sourceTransport.usesHandshake() || destinationTransport.usesHandshake()) {
      this.handshake(sourceTransport, destinationTransport);
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

    const sourceTransport = this.getTransport(frame.source);
    const destinationTransport = this.getTransport(frame.destination);
    if (sourceTransport.usesHandshake() || destinationTransport.usesHandshake()) {
      const runtimeFrame = createRuntimeTransportFrame({
        source: sourceTransport.identity(),
        destination: destinationTransport.identity(),
        sequence: sourceTransport.nextSequence(),
        message: frame.message,
      });
      const validation = validateRuntimeTransportFrame(
        runtimeFrame,
        destinationTransport.identity()
      );
      if (!validation.ok) {
        throw new Error(`Runtime transport frame rejected: ${validation.message}`);
      }
    }

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

  private handshake(
    sourceTransport: InMemoryMessageTransport,
    destinationTransport: InMemoryMessageTransport
  ): void {
    const sourceIdentity = sourceTransport.identity();
    const destinationIdentity = destinationTransport.identity();
    const hello = createRuntimeTransportHandshakeHello(sourceIdentity);
    const helloValidation = validateRuntimeTransportHandshake(hello, destinationIdentity);
    if (!helloValidation.ok) {
      throw new Error(`Runtime handshake rejected: ${helloValidation.message}`);
    }

    const accept = createRuntimeTransportHandshakeAccept(destinationIdentity, sourceIdentity);
    const acceptValidation = validateRuntimeTransportHandshake(accept, sourceIdentity);
    if (!acceptValidation.ok) {
      throw new Error(`Runtime handshake rejected: ${acceptValidation.message}`);
    }
  }
}

export function createInMemoryMessageTransportNetwork(): InMemoryMessageTransportNetwork {
  return new InMemoryMessageTransportNetworkImpl();
}
