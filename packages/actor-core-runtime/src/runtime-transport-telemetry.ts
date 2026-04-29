import type { RuntimeNodeIdentity } from './runtime-transport-contract.js';

export type RuntimeTransportTelemetryEventType =
  | 'transport.started'
  | 'transport.stopped'
  | 'peer.connecting'
  | 'peer.connected'
  | 'peer.disconnected'
  | 'peer.rejected'
  | 'handshake.accepted'
  | 'handshake.rejected'
  | 'auth.accepted'
  | 'auth.rejected'
  | 'frame.sent'
  | 'frame.received'
  | 'frame.dropped'
  | 'frame.duplicate'
  | 'frame.ack.sent'
  | 'frame.ack.received'
  | 'frame.retry.scheduled'
  | 'frame.retry.exhausted'
  | 'outbound.queue.enqueued'
  | 'outbound.queue.drained'
  | 'outbound.queue.dropped'
  | 'backpressure.applied'
  | 'idempotency.cache.evicted'
  | 'sequence.gap'
  | 'heartbeat.timeout';

export interface RuntimeTransportTelemetryEvent {
  type: RuntimeTransportTelemetryEventType;
  nodeAddress: string;
  peerNodeAddress?: string;
  timestamp: string;
  messageType?: string;
  messageId?: string;
  sequence?: number;
  expectedSequence?: number;
  queueDepth?: number;
  queueLimit?: number;
  reason?: string;
  authSubject?: string;
}

export type RuntimeTransportTelemetryObserver = (event: RuntimeTransportTelemetryEvent) => void;

export interface RuntimeTransportPeerStats {
  nodeAddress: string;
  state: 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'rejected';
  identity?: RuntimeNodeIdentity;
  connectedAt?: string;
  disconnectedAt?: string;
  lastSeenAt?: string;
  lastSentAt?: string;
  lastReceivedAt?: string;
  lastSentSequence: number;
  lastReceivedSequence: number;
  framesSent: number;
  framesReceived: number;
  framesAcked: number;
  framesRetried: number;
  retryExhaustedCount: number;
  outboundQueueDepth: number;
  outboundQueueLimit: number;
  outboundFramesDropped: number;
  backpressureDropCount: number;
  duplicateFramesDropped: number;
  idempotencyCacheEvictions: number;
  malformedFramesDropped: number;
  validationFramesDropped: number;
  sequenceGapCount: number;
  handshakeAcceptedCount: number;
  handshakeRejectedCount: number;
  disconnectCount: number;
  reconnectCount: number;
  heartbeatTimeoutCount: number;
  rejectedReason?: string;
}

export interface RuntimeTransportStats {
  nodeAddress: string;
  startedAt?: string;
  stoppedAt?: string;
  connectedPeerCount: number;
  framesSent: number;
  framesReceived: number;
  framesAcked: number;
  framesRetried: number;
  retryExhaustedCount: number;
  outboundQueueDepth: number;
  outboundQueueLimit: number;
  outboundFramesDropped: number;
  backpressureDropCount: number;
  duplicateFramesDropped: number;
  idempotencyCacheEvictions: number;
  malformedFramesDropped: number;
  validationFramesDropped: number;
  sequenceGapCount: number;
  handshakeAcceptedCount: number;
  handshakeRejectedCount: number;
  disconnectCount: number;
  reconnectCount: number;
  heartbeatTimeoutCount: number;
  lastEventAt?: string;
  peers: Record<string, RuntimeTransportPeerStats>;
}
