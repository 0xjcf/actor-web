import type { ActorMessage, MessageTransport } from './actor-system.js';

const MESSAGE_PORT_TRANSPORT_MARKER = '__actorWebMessagePortTransport';

export interface MessagePortTransportMessageEvent {
  data: unknown;
}

export type MessagePortTransportMessageListener = (event: MessagePortTransportMessageEvent) => void;

export interface MessagePortTransportPort {
  postMessage(message: unknown): void;
  start?(): void;
  close?(): void;
  addEventListener(type: 'message', listener: MessagePortTransportMessageListener): void;
  removeEventListener(type: 'message', listener: MessagePortTransportMessageListener): void;
}

export interface MessagePortTransportOptions {
  nodeAddress: string;
  peerAddress?: string;
  port: MessagePortTransportPort;
}

export interface MessagePortTransport extends MessageTransport {
  connect(address?: string): Promise<void>;
  disconnect(address?: string): Promise<void>;
  destroy(): void;
}

interface MessagePortTransportConnectEnvelope {
  [MESSAGE_PORT_TRANSPORT_MARKER]: true;
  kind: 'connect';
  source: string;
  destination: string;
}

interface MessagePortTransportDisconnectEnvelope {
  [MESSAGE_PORT_TRANSPORT_MARKER]: true;
  kind: 'disconnect';
  source: string;
  destination: string;
}

interface MessagePortTransportFrameEnvelope {
  [MESSAGE_PORT_TRANSPORT_MARKER]: true;
  kind: 'frame';
  source: string;
  destination: string;
  message: ActorMessage;
}

export type MessagePortTransportEnvelope =
  | MessagePortTransportConnectEnvelope
  | MessagePortTransportDisconnectEnvelope
  | MessagePortTransportFrameEnvelope;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isActorMessage(value: unknown): value is ActorMessage {
  return isRecord(value) && typeof value.type === 'string';
}

export function isMessagePortTransportEnvelope(
  value: unknown
): value is MessagePortTransportEnvelope {
  if (
    !isRecord(value) ||
    value[MESSAGE_PORT_TRANSPORT_MARKER] !== true ||
    typeof value.kind !== 'string' ||
    typeof value.source !== 'string' ||
    typeof value.destination !== 'string'
  ) {
    return false;
  }

  if (value.kind === 'connect' || value.kind === 'disconnect') {
    return true;
  }

  return value.kind === 'frame' && isActorMessage(value.message);
}

function runtimeTransportMessage(
  type: '__runtime.transport.connected' | '__runtime.transport.disconnected',
  nodeAddress: string
): ActorMessage<{ type: typeof type; nodeAddress: string }> {
  return {
    type,
    nodeAddress,
    _timestamp: Date.now(),
    _version: '1.0.0',
  };
}

class DefaultMessagePortTransport implements MessagePortTransport {
  private readonly listeners = new Set<
    (event: { source: string; message: ActorMessage }) => void
  >();
  private readonly connections = new Set<string>();
  private readonly handleMessage: MessagePortTransportMessageListener;
  private destroyed = false;

  constructor(private readonly options: MessagePortTransportOptions) {
    this.handleMessage = (event) => {
      this.handleEnvelope(event.data);
    };

    this.options.port.addEventListener('message', this.handleMessage);
    this.options.port.start?.();
  }

  async send(destination: string, message: ActorMessage): Promise<void> {
    this.assertActive();

    if (!this.connections.has(destination)) {
      throw new Error(`Transport ${this.options.nodeAddress} is not connected to ${destination}`);
    }

    this.options.port.postMessage({
      [MESSAGE_PORT_TRANSPORT_MARKER]: true,
      kind: 'frame',
      source: this.options.nodeAddress,
      destination,
      message,
    } satisfies MessagePortTransportEnvelope);
  }

  subscribe(listener: (event: { source: string; message: ActorMessage }) => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async connect(address: string = this.options.peerAddress ?? ''): Promise<void> {
    this.assertActive();

    if (!address) {
      throw new Error(`Transport ${this.options.nodeAddress} cannot connect without an address`);
    }

    if (this.connections.has(address)) {
      return;
    }

    this.connections.add(address);
    this.deliver({
      source: address,
      message: runtimeTransportMessage('__runtime.transport.connected', address),
    });
    this.options.port.postMessage({
      [MESSAGE_PORT_TRANSPORT_MARKER]: true,
      kind: 'connect',
      source: this.options.nodeAddress,
      destination: address,
    } satisfies MessagePortTransportEnvelope);
  }

  async disconnect(address: string = this.options.peerAddress ?? ''): Promise<void> {
    this.assertActive();

    if (!address || !this.connections.has(address)) {
      return;
    }

    this.connections.delete(address);
    this.deliver({
      source: address,
      message: runtimeTransportMessage('__runtime.transport.disconnected', address),
    });
    this.options.port.postMessage({
      [MESSAGE_PORT_TRANSPORT_MARKER]: true,
      kind: 'disconnect',
      source: this.options.nodeAddress,
      destination: address,
    } satisfies MessagePortTransportEnvelope);
  }

  getConnectedNodes(): string[] {
    return Array.from(this.connections);
  }

  isConnected(address: string): boolean {
    return this.connections.has(address);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.connections.clear();
    this.listeners.clear();
    this.options.port.removeEventListener('message', this.handleMessage);
    this.options.port.close?.();
  }

  private handleEnvelope(data: unknown): void {
    if (!isMessagePortTransportEnvelope(data) || data.destination !== this.options.nodeAddress) {
      return;
    }

    switch (data.kind) {
      case 'connect':
        this.connections.add(data.source);
        this.deliver({
          source: data.source,
          message: runtimeTransportMessage('__runtime.transport.connected', data.source),
        });
        return;
      case 'disconnect':
        this.connections.delete(data.source);
        this.deliver({
          source: data.source,
          message: runtimeTransportMessage('__runtime.transport.disconnected', data.source),
        });
        return;
      case 'frame':
        this.deliver({
          source: data.source,
          message: data.message,
        });
        return;
    }
  }

  private deliver(event: { source: string; message: ActorMessage }): void {
    for (const listener of Array.from(this.listeners)) {
      listener(event);
    }
  }

  private assertActive(): void {
    if (this.destroyed) {
      throw new Error(`Transport ${this.options.nodeAddress} has been destroyed`);
    }
  }
}

export function createMessagePortTransport(
  options: MessagePortTransportOptions
): MessagePortTransport {
  return new DefaultMessagePortTransport(options);
}
