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
  | 'frame.sent'
  | 'frame.received'
  | 'frame.dropped'
  | 'sequence.gap'
  | 'heartbeat.timeout';

export interface RuntimeTransportTelemetryEvent {
  type: RuntimeTransportTelemetryEventType;
  nodeAddress: string;
  peerNodeAddress?: string;
  timestamp: string;
  messageType?: string;
  sequence?: number;
  expectedSequence?: number;
  reason?: string;
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
