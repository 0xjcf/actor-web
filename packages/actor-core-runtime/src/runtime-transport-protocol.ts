/**
 * @module actor-core/runtime/runtime-transport-protocol
 * @description Internal transport protocol for cross-node Actor-Web runtime coordination.
 */

import type { ActorAddress, ActorMessage, ActorStats } from './actor-system.js';
import type {
  ActorEventEnvelope,
  ActorRuntimeSnapshot,
  ActorTransitionRecord,
} from './runtime-projection.js';

export interface RuntimeDirectoryEntry {
  address: ActorAddress;
  location: string;
  timestamp: number;
  ttl: number;
}

export interface RuntimeSnapshotProjection<TContext = unknown> {
  address: ActorAddress;
  snapshot: ActorRuntimeSnapshot;
  value: unknown;
  context: TContext;
  sequence: number;
  transition?: ActorTransitionRecord;
}

export interface RuntimeEventProjection<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  address: ActorAddress;
  envelope: ActorEventEnvelope<TPayload>;
  sequence: number;
}

interface RuntimeProtocolMessageBase extends ActorMessage {
  type: `__runtime.${string}`;
}

export interface RuntimeTransportConnectedMessage extends RuntimeProtocolMessageBase {
  type: '__runtime.transport.connected';
  nodeAddress: string;
}

export interface RuntimeTransportDisconnectedMessage extends RuntimeProtocolMessageBase {
  type: '__runtime.transport.disconnected';
  nodeAddress: string;
}

export interface RuntimeDirectoryRegisterMessage extends RuntimeProtocolMessageBase {
  type: '__runtime.directory.register';
  entry: RuntimeDirectoryEntry;
}

export interface RuntimeDirectoryUnregisterMessage extends RuntimeProtocolMessageBase {
  type: '__runtime.directory.unregister';
  address: ActorAddress;
}

export interface RuntimeDirectorySyncRequestMessage extends RuntimeProtocolMessageBase {
  type: '__runtime.directory.sync.request';
  requestId: string;
}

export interface RuntimeDirectorySyncResponseMessage extends RuntimeProtocolMessageBase {
  type: '__runtime.directory.sync.response';
  requestId: string;
  entries: RuntimeDirectoryEntry[];
}

export interface RuntimeRemoteSendMessage extends RuntimeProtocolMessageBase {
  type: '__runtime.remote.send';
  address: ActorAddress;
  message: ActorMessage;
}

export interface RuntimeRemoteAskRequestMessage extends RuntimeProtocolMessageBase {
  type: '__runtime.remote.ask.request';
  requestId: string;
  address: ActorAddress;
  message: ActorMessage;
  timeout: number;
}

export interface RuntimeRemoteAskResponseMessage extends RuntimeProtocolMessageBase {
  type: '__runtime.remote.ask.response';
  requestId: string;
  payload: unknown;
}

export interface RuntimeRemoteRequestErrorMessage extends RuntimeProtocolMessageBase {
  type:
    | '__runtime.remote.ask.error'
    | '__runtime.remote.snapshot.fetch.error'
    | '__runtime.remote.stop.error'
    | '__runtime.remote.stats.error';
  requestId: string;
  errorMessage: string;
}

export interface RuntimeRemoteSnapshotFetchRequestMessage extends RuntimeProtocolMessageBase {
  type: '__runtime.remote.snapshot.fetch.request';
  requestId: string;
  address: ActorAddress;
}

export interface RuntimeRemoteSnapshotFetchResponseMessage extends RuntimeProtocolMessageBase {
  type: '__runtime.remote.snapshot.fetch.response';
  requestId: string;
  payload: RuntimeSnapshotProjection;
}

export interface RuntimeRemoteSnapshotSubscribeMessage extends RuntimeProtocolMessageBase {
  type: '__runtime.remote.snapshot.subscribe';
  address: ActorAddress;
}

export interface RuntimeRemoteSnapshotUnsubscribeMessage extends RuntimeProtocolMessageBase {
  type: '__runtime.remote.snapshot.unsubscribe';
  address: ActorAddress;
}

export interface RuntimeRemoteSnapshotUpdateMessage extends RuntimeProtocolMessageBase {
  type: '__runtime.remote.snapshot.update';
  payload: RuntimeSnapshotProjection;
}

export interface RuntimeRemoteEventSubscribeMessage extends RuntimeProtocolMessageBase {
  type: '__runtime.remote.event.subscribe';
  address: ActorAddress;
}

export interface RuntimeRemoteEventUnsubscribeMessage extends RuntimeProtocolMessageBase {
  type: '__runtime.remote.event.unsubscribe';
  address: ActorAddress;
}

export interface RuntimeRemoteEventUpdateMessage extends RuntimeProtocolMessageBase {
  type: '__runtime.remote.event.update';
  payload: RuntimeEventProjection;
}

export interface RuntimeRemoteStopRequestMessage extends RuntimeProtocolMessageBase {
  type: '__runtime.remote.stop.request';
  requestId: string;
  address: ActorAddress;
}

export interface RuntimeRemoteStopResponseMessage extends RuntimeProtocolMessageBase {
  type: '__runtime.remote.stop.response';
  requestId: string;
  payload: { stopped: boolean };
}

export interface RuntimeRemoteStatsRequestMessage extends RuntimeProtocolMessageBase {
  type: '__runtime.remote.stats.request';
  requestId: string;
  address: ActorAddress;
}

export interface RuntimeRemoteStatsResponseMessage extends RuntimeProtocolMessageBase {
  type: '__runtime.remote.stats.response';
  requestId: string;
  payload: ActorStats;
}

export type RuntimeProtocolMessage =
  | RuntimeTransportConnectedMessage
  | RuntimeTransportDisconnectedMessage
  | RuntimeDirectoryRegisterMessage
  | RuntimeDirectoryUnregisterMessage
  | RuntimeDirectorySyncRequestMessage
  | RuntimeDirectorySyncResponseMessage
  | RuntimeRemoteSendMessage
  | RuntimeRemoteAskRequestMessage
  | RuntimeRemoteAskResponseMessage
  | RuntimeRemoteRequestErrorMessage
  | RuntimeRemoteSnapshotFetchRequestMessage
  | RuntimeRemoteSnapshotFetchResponseMessage
  | RuntimeRemoteSnapshotSubscribeMessage
  | RuntimeRemoteSnapshotUnsubscribeMessage
  | RuntimeRemoteSnapshotUpdateMessage
  | RuntimeRemoteEventSubscribeMessage
  | RuntimeRemoteEventUnsubscribeMessage
  | RuntimeRemoteEventUpdateMessage
  | RuntimeRemoteStopRequestMessage
  | RuntimeRemoteStopResponseMessage
  | RuntimeRemoteStatsRequestMessage
  | RuntimeRemoteStatsResponseMessage;

export function isRuntimeProtocolMessage(message: ActorMessage): message is RuntimeProtocolMessage {
  return message.type.startsWith('__runtime.');
}
