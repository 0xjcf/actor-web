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

export interface RuntimeTransportTelemetrySink {
  write(event: RuntimeTransportTelemetryEvent): void | Promise<void>;
  flush?(): void | Promise<void>;
  close?(): void | Promise<void>;
}

export interface RuntimeTransportTelemetryExporter {
  readonly observe: RuntimeTransportTelemetryObserver;
  flush(): Promise<void>;
  close(): Promise<void>;
  getDroppedEventCount(): number;
}

export interface RuntimeTransportTelemetryExporterOptions {
  readonly sink: RuntimeTransportTelemetrySink;
  readonly onError?: (error: unknown, event: RuntimeTransportTelemetryEvent) => void;
}

export interface InMemoryRuntimeTransportTelemetrySink extends RuntimeTransportTelemetrySink {
  getEvents(): readonly RuntimeTransportTelemetryEvent[];
  clear(): void;
}

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

function cloneTelemetryEvent(
  event: RuntimeTransportTelemetryEvent
): RuntimeTransportTelemetryEvent {
  return { ...event };
}

export function serializeRuntimeTransportTelemetryEvent(
  event: RuntimeTransportTelemetryEvent
): string {
  return JSON.stringify(cloneTelemetryEvent(event));
}

export function createInMemoryRuntimeTransportTelemetrySink(
  initialEvents: readonly RuntimeTransportTelemetryEvent[] = []
): InMemoryRuntimeTransportTelemetrySink {
  const events = initialEvents.map(cloneTelemetryEvent);

  return {
    write(event): void {
      events.push(cloneTelemetryEvent(event));
    },
    getEvents(): readonly RuntimeTransportTelemetryEvent[] {
      return events.map(cloneTelemetryEvent);
    },
    clear(): void {
      events.length = 0;
    },
  };
}

export function createRuntimeTransportTelemetryExporter(
  options: RuntimeTransportTelemetryExporterOptions
): RuntimeTransportTelemetryExporter {
  let droppedEventCount = 0;
  let pending = Promise.resolve();
  let closed = false;

  const observe: RuntimeTransportTelemetryObserver = (event) => {
    if (closed) {
      droppedEventCount += 1;
      return;
    }

    const snapshot = cloneTelemetryEvent(event);
    pending = pending
      .then(async () => {
        await options.sink.write(snapshot);
      })
      .catch((error) => {
        droppedEventCount += 1;
        options.onError?.(error, snapshot);
      });
  };

  return {
    observe,
    async flush(): Promise<void> {
      await pending;
      await options.sink.flush?.();
    },
    async close(): Promise<void> {
      closed = true;
      await pending;
      await options.sink.flush?.();
      await options.sink.close?.();
    },
    getDroppedEventCount(): number {
      return droppedEventCount;
    },
  };
}
