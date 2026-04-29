import type { ActorMessage } from './actor-system.js';
import type { RuntimeTransportAuthPayload } from './runtime-auth.js';

export const RUNTIME_TRANSPORT_PROTOCOL_VERSION = 'actor-web-runtime/1' as const;

export type RuntimeTransportProtocolVersion = typeof RUNTIME_TRANSPORT_PROTOCOL_VERSION;

export type RuntimeTransportHandshakeRejectCode =
  | 'missing_identity'
  | 'self_connection'
  | 'incompatible_protocol'
  | 'malformed_frame'
  | 'unauthorized';

export interface RuntimeNodeIdentity {
  nodeAddress: string;
  nodeId: string;
  incarnation: string;
  protocolVersion: RuntimeTransportProtocolVersion;
  capabilities?: readonly string[];
}

export interface RuntimeTransportFrame<TMessage extends ActorMessage = ActorMessage> {
  protocolVersion: RuntimeTransportProtocolVersion;
  source: RuntimeNodeIdentity;
  destination: RuntimeNodeIdentity;
  messageId: string;
  sequence: number;
  sentAt: string;
  message: TMessage;
}

export type RuntimeTransportHeartbeatFrame =
  | {
      type: 'runtime.transport.ping';
      protocolVersion: RuntimeTransportProtocolVersion;
      source: RuntimeNodeIdentity;
      destination: RuntimeNodeIdentity;
      sentAt: string;
    }
  | {
      type: 'runtime.transport.pong';
      protocolVersion: RuntimeTransportProtocolVersion;
      source: RuntimeNodeIdentity;
      destination: RuntimeNodeIdentity;
      sentAt: string;
    };

export interface RuntimeTransportAckFrame {
  type: 'runtime.transport.ack';
  protocolVersion: RuntimeTransportProtocolVersion;
  source: RuntimeNodeIdentity;
  destination: RuntimeNodeIdentity;
  messageId: string;
  sequence: number;
  sentAt: string;
}

export type RuntimeTransportHandshake =
  | {
      type: 'runtime.handshake.hello';
      protocolVersion: RuntimeTransportProtocolVersion;
      source: RuntimeNodeIdentity;
      sentAt: string;
      auth?: RuntimeTransportAuthPayload;
    }
  | {
      type: 'runtime.handshake.accept';
      protocolVersion: RuntimeTransportProtocolVersion;
      source: RuntimeNodeIdentity;
      destination: RuntimeNodeIdentity;
      sentAt: string;
      auth?: RuntimeTransportAuthPayload;
    }
  | {
      type: 'runtime.handshake.reject';
      protocolVersion: RuntimeTransportProtocolVersion;
      source?: RuntimeNodeIdentity;
      destination?: RuntimeNodeIdentity;
      code: RuntimeTransportHandshakeRejectCode;
      message: string;
      sentAt: string;
    };

export type RuntimeTransportValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: RuntimeTransportHandshakeRejectCode;
      message: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasProtocolVersion(value: unknown): value is RuntimeTransportProtocolVersion {
  return value === RUNTIME_TRANSPORT_PROTOCOL_VERSION;
}

function hasStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => isNonEmptyString(entry));
}

function hasStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function validateRuntimeAuthPayload(value: unknown): RuntimeTransportValidationResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      code: 'malformed_frame',
      message: 'Runtime auth payload must be an object.',
    };
  }

  if ('scheme' in value && value.scheme !== undefined && !isNonEmptyString(value.scheme)) {
    return {
      ok: false,
      code: 'malformed_frame',
      message: 'Runtime auth payload scheme must be a non-empty string.',
    };
  }

  if ('token' in value && value.token !== undefined && typeof value.token !== 'string') {
    return {
      ok: false,
      code: 'malformed_frame',
      message: 'Runtime auth payload token must be a string.',
    };
  }

  if ('metadata' in value && value.metadata !== undefined && !hasStringRecord(value.metadata)) {
    return {
      ok: false,
      code: 'malformed_frame',
      message: 'Runtime auth payload metadata must be a string record.',
    };
  }

  return { ok: true };
}

export function validateRuntimeNodeIdentity(value: unknown): RuntimeTransportValidationResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      code: 'missing_identity',
      message: 'Runtime node identity must be an object.',
    };
  }

  if (
    !isNonEmptyString(value.nodeAddress) ||
    !isNonEmptyString(value.nodeId) ||
    !isNonEmptyString(value.incarnation)
  ) {
    return {
      ok: false,
      code: 'missing_identity',
      message: 'Runtime node identity requires nodeAddress, nodeId, and incarnation.',
    };
  }

  if (!hasProtocolVersion(value.protocolVersion)) {
    return {
      ok: false,
      code: 'incompatible_protocol',
      message: `Unsupported runtime protocol version: ${String(value.protocolVersion)}.`,
    };
  }

  if (
    'capabilities' in value &&
    value.capabilities !== undefined &&
    !hasStringArray(value.capabilities)
  ) {
    return {
      ok: false,
      code: 'malformed_frame',
      message: 'Runtime node identity capabilities must be strings.',
    };
  }

  return { ok: true };
}

export function isRuntimeNodeIdentity(value: unknown): value is RuntimeNodeIdentity {
  return validateRuntimeNodeIdentity(value).ok;
}

export function isSameRuntimeNodeIdentity(
  left: RuntimeNodeIdentity,
  right: RuntimeNodeIdentity
): boolean {
  return left.nodeId === right.nodeId && left.incarnation === right.incarnation;
}

export function createRuntimeNodeIdentity(
  input: Omit<RuntimeNodeIdentity, 'protocolVersion'> & {
    protocolVersion?: RuntimeTransportProtocolVersion;
  }
): RuntimeNodeIdentity {
  return {
    nodeAddress: input.nodeAddress,
    nodeId: input.nodeId,
    incarnation: input.incarnation,
    protocolVersion: input.protocolVersion ?? RUNTIME_TRANSPORT_PROTOCOL_VERSION,
    ...(input.capabilities ? { capabilities: [...input.capabilities] } : {}),
  };
}

export function createRuntimeTransportHandshakeHello(
  source: RuntimeNodeIdentity,
  nowOrOptions:
    | (() => Date)
    | {
        auth?: RuntimeTransportAuthPayload;
        now?: () => Date;
      } = () => new Date()
): RuntimeTransportHandshake {
  const options = typeof nowOrOptions === 'function' ? { now: nowOrOptions } : nowOrOptions;
  return {
    type: 'runtime.handshake.hello',
    protocolVersion: RUNTIME_TRANSPORT_PROTOCOL_VERSION,
    source,
    sentAt: (options.now ?? (() => new Date()))().toISOString(),
    ...(options.auth ? { auth: options.auth } : {}),
  };
}

export function createRuntimeTransportHandshakeAccept(
  source: RuntimeNodeIdentity,
  destination: RuntimeNodeIdentity,
  nowOrOptions:
    | (() => Date)
    | {
        auth?: RuntimeTransportAuthPayload;
        now?: () => Date;
      } = () => new Date()
): RuntimeTransportHandshake {
  const options = typeof nowOrOptions === 'function' ? { now: nowOrOptions } : nowOrOptions;
  return {
    type: 'runtime.handshake.accept',
    protocolVersion: RUNTIME_TRANSPORT_PROTOCOL_VERSION,
    source,
    destination,
    sentAt: (options.now ?? (() => new Date()))().toISOString(),
    ...(options.auth ? { auth: options.auth } : {}),
  };
}

export function createRuntimeTransportHandshakeReject(
  code: RuntimeTransportHandshakeRejectCode,
  message: string,
  options: {
    source?: RuntimeNodeIdentity;
    destination?: RuntimeNodeIdentity;
    now?: () => Date;
  } = {}
): RuntimeTransportHandshake {
  return {
    type: 'runtime.handshake.reject',
    protocolVersion: RUNTIME_TRANSPORT_PROTOCOL_VERSION,
    ...(options.source ? { source: options.source } : {}),
    ...(options.destination ? { destination: options.destination } : {}),
    code,
    message,
    sentAt: (options.now ?? (() => new Date()))().toISOString(),
  };
}

export function validateRuntimeTransportHandshake(
  frame: unknown,
  localIdentity?: RuntimeNodeIdentity
): RuntimeTransportValidationResult {
  if (!isRecord(frame) || !isNonEmptyString(frame.type)) {
    return {
      ok: false,
      code: 'malformed_frame',
      message: 'Runtime handshake frame must be an object with a type field.',
    };
  }

  if (!hasProtocolVersion(frame.protocolVersion)) {
    return {
      ok: false,
      code: 'incompatible_protocol',
      message: `Unsupported runtime protocol version: ${String(frame.protocolVersion)}.`,
    };
  }

  if (
    frame.type !== 'runtime.handshake.hello' &&
    frame.type !== 'runtime.handshake.accept' &&
    frame.type !== 'runtime.handshake.reject'
  ) {
    return {
      ok: false,
      code: 'malformed_frame',
      message: `Unsupported runtime handshake type: ${String(frame.type)}.`,
    };
  }

  if (!isNonEmptyString(frame.sentAt)) {
    return {
      ok: false,
      code: 'malformed_frame',
      message: 'Runtime handshake frame requires sentAt.',
    };
  }

  if (frame.type === 'runtime.handshake.reject') {
    if (!isNonEmptyString(frame.code) || !isNonEmptyString(frame.message)) {
      return {
        ok: false,
        code: 'malformed_frame',
        message: 'Runtime handshake reject requires code and message.',
      };
    }

    return { ok: true };
  }

  const sourceValidation = validateRuntimeNodeIdentity(frame.source);
  if (!sourceValidation.ok) {
    return sourceValidation;
  }

  if (
    localIdentity &&
    isSameRuntimeNodeIdentity(frame.source as RuntimeNodeIdentity, localIdentity)
  ) {
    return {
      ok: false,
      code: 'self_connection',
      message: 'Runtime handshake cannot connect a node to itself.',
    };
  }

  if (frame.type === 'runtime.handshake.accept') {
    const destinationValidation = validateRuntimeNodeIdentity(frame.destination);
    if (!destinationValidation.ok) {
      return destinationValidation;
    }

    if (
      localIdentity &&
      !isSameRuntimeNodeIdentity(frame.destination as RuntimeNodeIdentity, localIdentity)
    ) {
      return {
        ok: false,
        code: 'malformed_frame',
        message: 'Runtime handshake accept destination does not match the local node.',
      };
    }
  }

  if ('auth' in frame && frame.auth !== undefined) {
    const authValidation = validateRuntimeAuthPayload(frame.auth);
    if (!authValidation.ok) {
      return authValidation;
    }
  }

  return { ok: true };
}

export function validateRuntimeTransportFrame(
  frame: unknown,
  localIdentity?: RuntimeNodeIdentity
): RuntimeTransportValidationResult {
  if (!isRecord(frame)) {
    return {
      ok: false,
      code: 'malformed_frame',
      message: 'Runtime transport frame must be an object.',
    };
  }

  if (!hasProtocolVersion(frame.protocolVersion)) {
    return {
      ok: false,
      code: 'incompatible_protocol',
      message: `Unsupported runtime protocol version: ${String(frame.protocolVersion)}.`,
    };
  }

  const sourceValidation = validateRuntimeNodeIdentity(frame.source);
  if (!sourceValidation.ok) {
    return sourceValidation;
  }

  const destinationValidation = validateRuntimeNodeIdentity(frame.destination);
  if (!destinationValidation.ok) {
    return destinationValidation;
  }

  if (
    localIdentity &&
    !isSameRuntimeNodeIdentity(frame.destination as RuntimeNodeIdentity, localIdentity)
  ) {
    return {
      ok: false,
      code: 'malformed_frame',
      message: 'Runtime transport frame destination does not match the local node.',
    };
  }

  if (!Number.isInteger(frame.sequence) || (frame.sequence as number) < 0) {
    return {
      ok: false,
      code: 'malformed_frame',
      message: 'Runtime transport frame sequence must be a non-negative integer.',
    };
  }

  if (!isNonEmptyString(frame.messageId)) {
    return {
      ok: false,
      code: 'malformed_frame',
      message: 'Runtime transport frame requires a messageId.',
    };
  }

  if (!isNonEmptyString(frame.sentAt)) {
    return {
      ok: false,
      code: 'malformed_frame',
      message: 'Runtime transport frame requires sentAt.',
    };
  }

  if (!isRecord(frame.message) || !isNonEmptyString(frame.message.type)) {
    return {
      ok: false,
      code: 'malformed_frame',
      message: 'Runtime transport frame requires an actor message with a type.',
    };
  }

  return { ok: true };
}

export function validateRuntimeTransportHeartbeatFrame(
  frame: unknown,
  localIdentity?: RuntimeNodeIdentity
): RuntimeTransportValidationResult {
  if (!isRecord(frame)) {
    return {
      ok: false,
      code: 'malformed_frame',
      message: 'Runtime transport heartbeat frame must be an object.',
    };
  }

  if (frame.type !== 'runtime.transport.ping' && frame.type !== 'runtime.transport.pong') {
    return {
      ok: false,
      code: 'malformed_frame',
      message: `Unsupported runtime transport heartbeat type: ${String(frame.type)}.`,
    };
  }

  if (!hasProtocolVersion(frame.protocolVersion)) {
    return {
      ok: false,
      code: 'incompatible_protocol',
      message: `Unsupported runtime protocol version: ${String(frame.protocolVersion)}.`,
    };
  }

  const sourceValidation = validateRuntimeNodeIdentity(frame.source);
  if (!sourceValidation.ok) {
    return sourceValidation;
  }

  const destinationValidation = validateRuntimeNodeIdentity(frame.destination);
  if (!destinationValidation.ok) {
    return destinationValidation;
  }

  if (
    localIdentity &&
    !isSameRuntimeNodeIdentity(frame.destination as RuntimeNodeIdentity, localIdentity)
  ) {
    return {
      ok: false,
      code: 'malformed_frame',
      message: 'Runtime transport heartbeat destination does not match the local node.',
    };
  }

  if (!isNonEmptyString(frame.sentAt)) {
    return {
      ok: false,
      code: 'malformed_frame',
      message: 'Runtime transport heartbeat frame requires sentAt.',
    };
  }

  return { ok: true };
}

export function validateRuntimeTransportAckFrame(
  frame: unknown,
  localIdentity?: RuntimeNodeIdentity
): RuntimeTransportValidationResult {
  if (!isRecord(frame)) {
    return {
      ok: false,
      code: 'malformed_frame',
      message: 'Runtime transport ack frame must be an object.',
    };
  }

  if (frame.type !== 'runtime.transport.ack') {
    return {
      ok: false,
      code: 'malformed_frame',
      message: 'Runtime transport ack frame requires type runtime.transport.ack.',
    };
  }

  if (!hasProtocolVersion(frame.protocolVersion)) {
    return {
      ok: false,
      code: 'incompatible_protocol',
      message: `Unsupported runtime protocol version: ${String(frame.protocolVersion)}.`,
    };
  }

  const sourceValidation = validateRuntimeNodeIdentity(frame.source);
  if (!sourceValidation.ok) {
    return sourceValidation;
  }

  const destinationValidation = validateRuntimeNodeIdentity(frame.destination);
  if (!destinationValidation.ok) {
    return destinationValidation;
  }

  if (
    localIdentity &&
    !isSameRuntimeNodeIdentity(frame.destination as RuntimeNodeIdentity, localIdentity)
  ) {
    return {
      ok: false,
      code: 'malformed_frame',
      message: 'Runtime transport ack destination does not match the local node.',
    };
  }

  if (!isNonEmptyString(frame.messageId)) {
    return {
      ok: false,
      code: 'malformed_frame',
      message: 'Runtime transport ack requires a messageId.',
    };
  }

  if (!Number.isInteger(frame.sequence) || (frame.sequence as number) < 0) {
    return {
      ok: false,
      code: 'malformed_frame',
      message: 'Runtime transport ack sequence must be a non-negative integer.',
    };
  }

  if (!isNonEmptyString(frame.sentAt)) {
    return {
      ok: false,
      code: 'malformed_frame',
      message: 'Runtime transport ack requires sentAt.',
    };
  }

  return { ok: true };
}

export function createRuntimeTransportMessageId(input: {
  source: RuntimeNodeIdentity;
  destination: RuntimeNodeIdentity;
  sequence: number;
}): string {
  return [
    input.source.nodeAddress,
    input.source.incarnation,
    input.destination.nodeAddress,
    String(input.sequence),
  ].join(':');
}

export function createRuntimeTransportFrame<TMessage extends ActorMessage>(input: {
  source: RuntimeNodeIdentity;
  destination: RuntimeNodeIdentity;
  messageId?: string;
  sequence: number;
  message: TMessage;
  now?: () => Date;
}): RuntimeTransportFrame<TMessage> {
  return {
    protocolVersion: RUNTIME_TRANSPORT_PROTOCOL_VERSION,
    source: input.source,
    destination: input.destination,
    messageId: input.messageId ?? createRuntimeTransportMessageId(input),
    sequence: input.sequence,
    sentAt: (input.now ?? (() => new Date()))().toISOString(),
    message: input.message,
  };
}

export function createRuntimeTransportAckFrame(
  source: RuntimeNodeIdentity,
  destination: RuntimeNodeIdentity,
  messageId: string,
  sequence: number,
  now: () => Date = () => new Date()
): RuntimeTransportAckFrame {
  return {
    type: 'runtime.transport.ack',
    protocolVersion: RUNTIME_TRANSPORT_PROTOCOL_VERSION,
    source,
    destination,
    messageId,
    sequence,
    sentAt: now().toISOString(),
  };
}

export function createRuntimeTransportHeartbeatPing(
  source: RuntimeNodeIdentity,
  destination: RuntimeNodeIdentity,
  now: () => Date = () => new Date()
): RuntimeTransportHeartbeatFrame {
  return {
    type: 'runtime.transport.ping',
    protocolVersion: RUNTIME_TRANSPORT_PROTOCOL_VERSION,
    source,
    destination,
    sentAt: now().toISOString(),
  };
}

export function createRuntimeTransportHeartbeatPong(
  source: RuntimeNodeIdentity,
  destination: RuntimeNodeIdentity,
  now: () => Date = () => new Date()
): RuntimeTransportHeartbeatFrame {
  return {
    type: 'runtime.transport.pong',
    protocolVersion: RUNTIME_TRANSPORT_PROTOCOL_VERSION,
    source,
    destination,
    sentAt: now().toISOString(),
  };
}
