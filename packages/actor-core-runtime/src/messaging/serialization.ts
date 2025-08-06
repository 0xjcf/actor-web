/**
 * @module actor-core/runtime/messaging/serialization
 * @description Message serialization for distributed actor communication
 * @author Actor-Web Framework Team
 */

import type { ActorMessage } from '../actor-system.js';

/**
 * Type guard to validate ActorMessage structure according to actor-system.ts requirements
 */
function isValidActorMessage(value: unknown): value is ActorMessage {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const msg = value as Record<string, unknown>;

  return (
    typeof msg.type === 'string' &&
    'payload' in msg && // payload can be null but must be present
    typeof msg.timestamp === 'number' &&
    typeof msg.version === 'string'
  );
}

/**
 * Serialization format types
 */
export type SerializationFormat = 'json' | 'msgpack';

/**
 * Serializer interface for message encoding/decoding
 */
export interface MessageSerializer {
  /**
   * Encode a message for transmission
   */
  encode(message: ActorMessage): Promise<ArrayBuffer>;

  /**
   * Decode a message from transmission format
   */
  decode(data: ArrayBuffer): Promise<ActorMessage>;

  /**
   * Get the format identifier
   */
  readonly format: SerializationFormat;
}

/**
 * JSON serializer (default)
 */
export class JsonSerializer implements MessageSerializer {
  readonly format: SerializationFormat = 'json';

  async encode(message: ActorMessage): Promise<ArrayBuffer> {
    const json = JSON.stringify(message);
    const encoder = new TextEncoder();
    return encoder.encode(json).buffer;
  }

  async decode(data: ArrayBuffer): Promise<ActorMessage> {
    const decoder = new TextDecoder();
    const json = decoder.decode(data);
    const parsed: unknown = JSON.parse(json);

    if (!isValidActorMessage(parsed)) {
      throw new Error('Invalid ActorMessage format');
    }

    return parsed;
  }
}

/**
 * MessagePack serializer (for performance)
 * Note: Requires msgpack library to be installed
 */
export class MessagePackSerializer implements MessageSerializer {
  readonly format: SerializationFormat = 'msgpack';
  private msgpack: {
    encode: (value: unknown) => Uint8Array;
    decode: (data: Uint8Array) => unknown;
  } | null;

  constructor() {
    // Lazy load msgpack if available
    try {
      this.msgpack = require('@msgpack/msgpack');
    } catch {
      this.msgpack = null;
    }
  }

  async encode(message: ActorMessage): Promise<ArrayBuffer> {
    if (!this.msgpack) {
      throw new Error('MessagePack not available - install @msgpack/msgpack');
    }
    const encoded = this.msgpack.encode(message);
    return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
  }

  async decode(data: ArrayBuffer): Promise<ActorMessage> {
    if (!this.msgpack) {
      throw new Error('MessagePack not available - install @msgpack/msgpack');
    }
    const uint8Array = new Uint8Array(data);
    const parsed: unknown = this.msgpack.decode(uint8Array);

    if (!isValidActorMessage(parsed)) {
      throw new Error('Invalid ActorMessage format');
    }

    return parsed;
  }
}

/**
 * Serialization registry
 */
const serializers = new Map<SerializationFormat, MessageSerializer>();

// Register default serializers
registerSerializer(new JsonSerializer());

/**
 * Register a serializer
 */
export function registerSerializer(serializer: MessageSerializer): void {
  serializers.set(serializer.format, serializer);
}

/**
 * Get a serializer by format
 */
export function getSerializer(format: SerializationFormat): MessageSerializer {
  const serializer = serializers.get(format);
  if (!serializer) {
    throw new Error(`Unknown serialization format: ${format}`);
  }
  return serializer;
}

/**
 * Create MessagePack serializer if available
 */
export function createMessagePackSerializer(): MessageSerializer | null {
  try {
    const serializer = new MessagePackSerializer();
    registerSerializer(serializer);
    return serializer;
  } catch {
    return null;
  }
}

/**
 * Message envelope for transport with metadata
 */
export interface MessageEnvelope {
  /**
   * Serialization format used
   */
  format: SerializationFormat;

  /**
   * Encoded message data
   */
  data: ArrayBuffer;

  /**
   * Source node/actor
   */
  source: string;

  /**
   * Target node/actor
   */
  target: string;

  /**
   * Timestamp when serialized
   */
  timestamp: number;

  /**
   * Optional compression flag
   */
  compressed?: boolean;
}

/**
 * Transport serializer for network communication
 */
export class TransportSerializer {
  constructor(private serializer: MessageSerializer = new JsonSerializer()) {}

  /**
   * Prepare message for transport
   */
  async pack(message: ActorMessage, source: string, target: string): Promise<MessageEnvelope> {
    const data = await this.serializer.encode(message);

    return {
      format: this.serializer.format,
      data,
      source,
      target,
      timestamp: Date.now(),
    };
  }

  /**
   * Unpack message from transport
   */
  async unpack(envelope: MessageEnvelope): Promise<ActorMessage> {
    // Get appropriate serializer
    const serializer = getSerializer(envelope.format);

    // Decode the message
    return serializer.decode(envelope.data);
  }

  /**
   * Serialize envelope for network transmission
   */
  async serializeEnvelope(envelope: MessageEnvelope): Promise<ArrayBuffer> {
    // Convert ArrayBuffer to base64 for JSON serialization
    const dataBase64 = btoa(String.fromCharCode(...new Uint8Array(envelope.data)));

    const envelopeData = {
      ...envelope,
      data: dataBase64,
    };

    const json = JSON.stringify(envelopeData);
    const encoder = new TextEncoder();
    return encoder.encode(json).buffer;
  }

  /**
   * Deserialize envelope from network transmission
   */
  async deserializeEnvelope(data: ArrayBuffer): Promise<MessageEnvelope> {
    const decoder = new TextDecoder();
    const json = decoder.decode(data);
    const envelopeData = JSON.parse(json);

    // Convert base64 back to ArrayBuffer
    const binaryString = atob(envelopeData.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return {
      ...envelopeData,
      data: bytes.buffer,
    };
  }
}
